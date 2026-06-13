import { Entity, Quaternion, type Player, type PlayerEntity, type Vector3Like, type World } from "hytopia";
import type { GehennaMapId } from "../mapConfig";
import { getLayoutForMap, saveLayoutEntry, deleteLayoutEntry, type LayoutEntry } from "./LayoutStore";

/**
 * LayoutEditor — in-game model layout tool for the dev test room.
 *
 * Workflow (chat commands, registered by the Director):
 *   /grab        grab the nearest editable prop (or the one you're aiming at)
 *   /rotate <deg> spin the held prop around Y (default 45)
 *   /scale <n>    multiply the held prop's scale (e.g. 1.1, 0.9), or set absolute with =n
 *   /up /down     nudge the held prop's height
 *   /drop         release the prop where it is
 *   /save         persist ALL editable props' transforms to dev-layout.json
 *   /reset <id?>  revert a prop (or all) to defaults and delete saved overrides
 *
 * A grabbed prop follows the player's aim each tick (walk + look to position it),
 * so you place it physically, then fine-tune rotation/scale/height via chat.
 *
 * Each prop registered here carries a stable `layoutId`. On spawn the Director
 * registers the default, and applyOverrides() stamps any saved transform on top.
 */

type EditableProp = {
  layoutId: string;
  entity: Entity;
  modelUri: string;
  scale: number;
  rotationDeg: number;        // yaw in degrees (we only rotate around Y)
  position: Vector3Like;
};

const GRAB_DISTANCE = 4.5;    // how far in front of the player a grabbed prop floats
const PICK_RADIUS   = 6.0;    // /grab search radius when not aiming directly

export class LayoutEditor {
  private _props = new Map<string, EditableProp>(); // layoutId -> prop
  private _heldId: string | null = null;
  private _mapId: GehennaMapId = "test_zone";

  /** Called when a map (re)loads so the editor tracks the right map's saved layout. */
  setMap(mapId: GehennaMapId): void {
    this._mapId = mapId;
    this._props.clear();
    this._heldId = null;
  }

  /**
   * Register a freshly spawned prop as editable AND apply any saved override.
   * Returns the transform that should be used (caller spawns/positions with it).
   */
  register(layoutId: string, entity: Entity, modelUri: string, defaultScale: number, defaultPos: Vector3Like, defaultYawDeg = 0): LayoutEntry {
    const saved = getLayoutForMap(this._mapId)[layoutId];
    const scale = saved?.scale ?? defaultScale;
    const position = saved?.position ?? { ...defaultPos };
    const rotation = saved?.rotation ?? Quaternion.fromEuler(0, defaultYawDeg, 0);
    const rotationDeg = saved ? quatToYawDeg(rotation) : defaultYawDeg;

    this._props.set(layoutId, { layoutId, entity, modelUri, scale, rotationDeg, position: { ...position } });

    return { modelUri, scale, position, rotation };
  }

  /** Drop tracking when props are despawned (map swap / teardown). */
  clear(): void {
    this._props.clear();
    this._heldId = null;
  }

  get isHolding(): boolean { return this._heldId !== null; }

  /** Per-tick: make the held prop float at the player's aim point. */
  tick(host: Player, pe: PlayerEntity): void {
    if (!this._heldId) return;
    const prop = this._props.get(this._heldId);
    if (!prop || !prop.entity.isSpawned) { this._heldId = null; return; }

    const { pitch, yaw } = host.camera.orientation;
    const cp = Math.cos(pitch);
    const dir = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
    const eye = pe.position;
    const pos = {
      x: eye.x + dir.x * GRAB_DISTANCE,
      y: eye.y + dir.y * GRAB_DISTANCE,
      z: eye.z + dir.z * GRAB_DISTANCE,
    };
    prop.position = pos;
    try { prop.entity.setPosition(pos); } catch {}
  }

  // ── Chat verbs (return a chat line to echo to the player) ────────────────────

  grab(host: Player, pe: PlayerEntity): string {
    if (this._heldId) return "Already holding a prop — /drop it first.";
    const target = this._pickProp(host, pe);
    if (!target) return "No editable prop nearby. Stand near one and look at it, then /grab.";
    this._heldId = target.layoutId;
    return `Grabbed "${target.layoutId}". Walk + look to move it. /rotate /scale /up /down to adjust, /drop to release, /save to persist.`;
  }

  drop(): string {
    if (!this._heldId) return "Nothing held.";
    const id = this._heldId;
    this._heldId = null;
    return `Dropped "${id}". /save to make it permanent.`;
  }

  rotate(deg: number): string {
    const prop = this._heldProp();
    if (!prop) return "Grab a prop first (/grab).";
    prop.rotationDeg = (prop.rotationDeg + deg) % 360;
    this._applyTransform(prop);
    return `Rotated to ${Math.round(prop.rotationDeg)}°.`;
  }

  /** arg like "1.1" multiplies; "=2.0" sets absolute. */
  scale(arg: string): string {
    const prop = this._heldProp();
    if (!prop) return "Grab a prop first (/grab).";
    let next: number;
    if (arg.startsWith("=")) {
      next = parseFloat(arg.slice(1));
    } else {
      const mul = parseFloat(arg);
      next = prop.scale * (isFinite(mul) ? mul : 1);
    }
    if (!isFinite(next) || next <= 0) return "Usage: /scale 1.1 (multiply) or /scale =2 (absolute).";
    prop.scale = Math.max(0.05, Math.min(20, next));
    this._applyTransform(prop);
    return `Scale set to ${prop.scale.toFixed(2)}.`;
  }

  nudgeHeight(dy: number): string {
    const prop = this._heldProp();
    if (!prop) return "Grab a prop first (/grab).";
    prop.position = { ...prop.position, y: prop.position.y + dy };
    try { prop.entity.setPosition(prop.position); } catch {}
    return `Height ${dy > 0 ? "+" : ""}${dy.toFixed(2)} → y=${prop.position.y.toFixed(2)}.`;
  }

  /** Persist every editable prop's current transform for this map. */
  saveAll(): string {
    let ok = 0;
    for (const prop of this._props.values()) {
      const entry: LayoutEntry = {
        modelUri: prop.modelUri,
        scale: prop.scale,
        position: prop.position,
        rotation: Quaternion.fromEuler(0, prop.rotationDeg, 0),
      };
      if (saveLayoutEntry(this._mapId, prop.layoutId, entry)) ok++;
    }
    return `Saved ${ok}/${this._props.size} prop layout(s) for ${this._mapId}. They'll persist across restarts.`;
  }

  /** Revert one prop (or all) to defaults by deleting saved overrides. */
  reset(layoutId?: string): string {
    if (layoutId) {
      deleteLayoutEntry(this._mapId, layoutId);
      return `Cleared saved layout for "${layoutId}". Restart/re-enter to see defaults.`;
    }
    let n = 0;
    for (const id of this._props.keys()) { if (deleteLayoutEntry(this._mapId, id)) n++; }
    return `Cleared ${n} saved layout(s) for ${this._mapId}. Restart/re-enter to see defaults.`;
  }

  list(): string {
    if (this._props.size === 0) return "No editable props on this map.";
    return "Editable props: " + [...this._props.keys()].join(", ");
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private _heldProp(): EditableProp | null {
    return this._heldId ? this._props.get(this._heldId) ?? null : null;
  }

  private _applyTransform(prop: EditableProp): void {
    try {
      prop.entity.setModelScale(prop.scale);
      prop.entity.setRotation(Quaternion.fromEuler(0, prop.rotationDeg, 0));
    } catch {}
  }

  /** Pick the prop the player is closest to looking at, within PICK_RADIUS. */
  private _pickProp(host: Player, pe: PlayerEntity): EditableProp | null {
    const eye = pe.position;
    const { pitch, yaw } = host.camera.orientation;
    const cp = Math.cos(pitch);
    const dir = { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };

    let best: EditableProp | null = null;
    let bestScore = -Infinity;
    for (const prop of this._props.values()) {
      if (!prop.entity.isSpawned) continue;
      const pp = prop.entity.position;
      const to = { x: pp.x - eye.x, y: pp.y - eye.y, z: pp.z - eye.z };
      const dist = Math.hypot(to.x, to.y, to.z);
      if (dist > PICK_RADIUS) continue;
      // Favour props in the crosshair: dot of aim and direction-to-prop.
      const inv = 1 / (dist || 1);
      const dot = to.x * dir.x * inv + to.y * dir.y * inv + to.z * dir.z * inv;
      const score = dot * 2 - dist * 0.1;
      if (score > bestScore) { bestScore = score; best = prop; }
    }
    return best;
  }
}

/** Extract yaw (degrees) from a Y-only quaternion. */
function quatToYawDeg(q: { x: number; y: number; z: number; w: number }): number {
  const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
  return (yaw * 180) / Math.PI;
}
