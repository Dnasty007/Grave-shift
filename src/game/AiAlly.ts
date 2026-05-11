import * as pc from "playcanvas";
import type { AnimTrack } from "playcanvas";
import { GAME_CONFIG, MAP_CONFIG } from "./config";
import type { CollisionWorld } from "./CollisionWorld";
import type { Map as ZoneMap } from "./Map";
import type { Zombie } from "./Zombie";
import type { EnemyModelKit } from "./Zombie";
import { WEAPON_DEFINITIONS } from "./Weapon";

/** One engagement tick from the AI squadmate (for FX + scoring in {@link GameApp}). */
export type AllyShotOutcome = {
  fired: boolean;
  hit: boolean;
  zombie: Zombie | null;
  killed: boolean;
  headshot: boolean;
  muzzlePos: pc.Vec3;
  aimDir: pc.Vec3;
  impactPoint: pc.Vec3;
};

const REF_WEAPON = WEAPON_DEFINITIONS.pistol;

/** Tint zombie glTF toward a “friendly” palette so reads as ally, not horde. */
function tintAllyMaterials(root: pc.Entity): void {
  const renders = root.findComponents("render") as pc.RenderComponent[];
  for (const r of renders) {
    for (let i = 0; i < r.meshInstances.length; i++) {
      const mat = r.meshInstances[i].material;
      if (mat instanceof pc.StandardMaterial) {
        const d = mat.diffuse;
        mat.diffuse = new pc.Color(
          Math.min(1, d.r * 0.5 + 0.22),
          Math.min(1, d.g * 0.7 + 0.32),
          Math.min(1, d.b * 0.95 + 0.18)
        );
        mat.update();
      }
    }
  }
}

/**
 * Lightweight co-op bot: stays near the player on XZ, snaps Y to terrain like imports,
 * and periodically hitscans the nearest zombie. Not an LLM — inspired by Hytopia’s follow
 * behavior, implemented for this client.
 */
export class AiAlly {
  readonly root: pc.Entity;

  private readonly collision: CollisionWorld | null;
  private readonly cfg = GAME_CONFIG.aiAlly;
  private visual: pc.Entity | null = null;
  private animComponent: pc.AnimComponent | null = null;
  private resolveAnim: ((name: string) => AnimTrack | undefined) | null = null;
  private locoMode: "walk" | "run" | null = null;
  private fireCooldown = 0;
  private bobOffset = Math.random() * Math.PI * 2;
  private readonly toward = new pc.Vec3();
  private readonly faceQuat = new pc.Quat();
  private readonly scratchMove = new pc.Vec3();

  constructor(
    start: pc.Vec3,
    collision: CollisionWorld | null,
    modelKit: EnemyModelKit | null
  ) {
    this.collision = collision;
    this.root = new pc.Entity("ai-ally");
    this.root.setPosition(start);

    if (modelKit && GAME_CONFIG.enemyVisual.useGltf) {
      let gltfEntity: pc.Entity | null = null;
      try {
        gltfEntity = modelKit.instantiate();
      } catch (e) {
        console.warn("[AiAlly] glTF instantiate failed", e);
      }
      if (gltfEntity) {
        gltfEntity.name = "ally-gltf";
        const av = GAME_CONFIG.voxelAvatar;
        const s = av.modelScale;
        gltfEntity.setLocalScale(s, s, s);
        gltfEntity.setLocalPosition(0, av.yOffset, 0);
        gltfEntity.setLocalEulerAngles(0, av.yawOffsetDeg, 0);
        this.root.addChild(gltfEntity);
        tintAllyMaterials(gltfEntity);
        this.visual = gltfEntity;
        this.resolveAnim = modelKit.getAnimTrack.bind(modelKit);
        this.attachLocomotion(gltfEntity, modelKit);
      }
    }
  }

  private attachLocomotion(visual: pc.Entity, kit: EnemyModelKit): void {
    visual.addComponent("anim");
    this.animComponent = visual.anim ?? null;
    if (!this.animComponent) return;
    const ev = GAME_CONFIG.enemyVisual;
    const walk = kit.getAnimTrack(ev.animWalkName);
    const run = kit.getAnimTrack(ev.animRunName);
    const fallback = kit.getAnimTrack(ev.animFallbackName);
    const track = walk ?? run ?? fallback;
    if (!track) return;
    this.animComponent.activate = true;
    this.animComponent.playing = true;
    this.animComponent.assignAnimation("Locomotion", track, undefined, 1, true);
    this.locoMode = walk ? "walk" : run ? "run" : "walk";
  }

  private updateLocomotionAnim(moving: boolean, run: boolean): void {
    if (!this.animComponent || !this.resolveAnim) return;
    const ev = GAME_CONFIG.enemyVisual;
    const runTrack = this.resolveAnim(ev.animRunName);
    const wantRun = moving && run && !!runTrack;
    const mode: "walk" | "run" = wantRun ? "run" : "walk";
    const clipName = mode === "run" ? ev.animRunName : ev.animWalkName;
    let track = this.resolveAnim(clipName);
    if (!track) {
      track =
        this.resolveAnim(ev.animWalkName) ??
        this.resolveAnim(ev.animRunName) ??
        this.resolveAnim(ev.animFallbackName);
    }
    if (track && this.locoMode !== mode) {
      this.animComponent.assignAnimation("Locomotion", track, undefined, 1, true);
      this.locoMode = mode;
    }
    const ref = GAME_CONFIG.zombie.baseSpeed;
    const spd = this.cfg.moveSpeed;
    const mul = moving
      ? pc.math.clamp(spd / ref, ev.animSpeedMin, ev.animSpeedMax)
      : ev.animIdleShuffle;
    this.animComponent.speed = mul * ev.animBaseSpeed;
  }

  destroy(): void {
    this.root.destroy();
  }

  getEyeWorldPosition(out: pc.Vec3): pc.Vec3 {
    const p = this.root.getPosition();
    out.set(p.x, p.y + this.cfg.eyeHeight, p.z);
    return out;
  }

  update(
    dt: number,
    playerEntity: pc.Entity,
    map: ZoneMap,
    frozen: boolean
  ): void {
    if (frozen) {
      if (this.animComponent) this.animComponent.speed = 0;
      return;
    }

    const cfg = this.cfg;
    const playerPos = playerEntity.getPosition();
    const right = playerEntity.right.clone();
    right.y = 0;
    if (right.lengthSq() > 1e-8) right.normalize();
    const forward = playerEntity.forward.clone();
    forward.y = 0;
    if (forward.lengthSq() > 1e-8) forward.normalize();

    const slot = playerPos
      .clone()
      .add(right.mulScalar(cfg.followRight))
      .add(forward.mulScalar(-cfg.followBack));

    const pos = this.root.getPosition();
    let slotY = playerPos.y;
    if (
      MAP_CONFIG.importVisual.enabled &&
      MAP_CONFIG.importVisual.replacesArena &&
      MAP_CONFIG.importVisual.snapFeetToGround
    ) {
      const g = map.sampleImportedTerrainYNearFeet(slot.x, slot.z, playerPos.y + 2);
      if (g != null) slotY = g;
    }
    slot.y = slotY;

    const dx = slot.x - pos.x;
    const dz = slot.z - pos.z;
    const distSq = dx * dx + dz * dz;
    const moveThresh = 0.06;
    const moving = distSq > moveThresh * moveThresh;
    let nx = pos.x;
    let nz = pos.z;
    if (moving) {
      const dist = Math.sqrt(distSq);
      const step = cfg.moveSpeed * dt;
      const t = Math.min(1, step / Math.max(dist, 1e-4));
      nx = pos.x + dx * t;
      nz = pos.z + dz * t;
    }

    let ny = slotY;
    if (
      MAP_CONFIG.importVisual.enabled &&
      MAP_CONFIG.importVisual.replacesArena &&
      MAP_CONFIG.importVisual.snapFeetToGround
    ) {
      const g = map.sampleImportedTerrainYNearFeet(nx, nz, playerPos.y + 2);
      if (g != null) ny = g;
    }

    this.scratchMove.set(nx, ny, nz);
    if (this.collision) {
      this.collision.resolveZombiePosition(this.scratchMove, cfg.radius);
    }
    this.root.setPosition(this.scratchMove);

    if (moving && distSq > 1e-8) {
      this.toward.set(dx, 0, dz).normalize();
      this.faceQuat.setFromDirections(pc.Vec3.FORWARD, this.toward);
      this.root.setLocalRotation(this.faceQuat);
    }

    this.bobOffset += dt * 4.2;
    if (this.visual) {
      const bobY = Math.sin(this.bobOffset) * 0.05;
      const y0 = GAME_CONFIG.voxelAvatar.yOffset;
      this.visual.setLocalPosition(0, y0 + bobY * 0.08, 0);
    }

    const run = distSq > 3.5 * 3.5;
    this.updateLocomotionAnim(moving, run);
  }

  /**
   * Cooldown-based hitscan using pistol ballistics as baseline; damage scaled by {@link GAME_CONFIG.aiAlly}.
   */
  tryEngage(dt: number, zombies: Zombie[]): AllyShotOutcome {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);

    const eye = this.getEyeWorldPosition(new pc.Vec3());
    let best: Zombie | null = null;
    let bestDistSq = this.cfg.engageRange * this.cfg.engageRange;

    for (const z of zombies) {
      if (!z.alive) continue;
      const aim = z.getAimTarget();
      const ddx = aim.x - eye.x;
      const ddy = aim.y - eye.y;
      const ddz = aim.z - eye.z;
      const dSq = ddx * ddx + ddy * ddy + ddz * ddz;
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        best = z;
      }
    }

    const out: AllyShotOutcome = {
      fired: false,
      hit: false,
      zombie: null,
      killed: false,
      headshot: false,
      muzzlePos: eye.clone(),
      aimDir: new pc.Vec3(0, 0, -1),
      impactPoint: eye.clone()
    };

    if (!best || this.fireCooldown > 0) {
      return out;
    }

    const aim = best.getAimTarget();
    out.aimDir.set(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z);
    const len = out.aimDir.length();
    if (len < 1e-4) return out;
    out.aimDir.mulScalar(1 / len);

    this.fireCooldown = this.cfg.fireIntervalSeconds;

    out.fired = true;
    const useHead = Math.random() < this.cfg.headshotProbability;
    const head = best.getHeadTarget();
    const impact = useHead ? head : aim;
    out.impactPoint.copy(impact);
    out.hit = true;
    out.zombie = best;
    out.headshot = useHead;

    const mult = this.cfg.damageMultiplier;
    const dmg = useHead
      ? REF_WEAPON.damage * REF_WEAPON.headshotMultiplier * mult
      : REF_WEAPON.damage * mult;
    out.killed = best.applyDamage(dmg);

    return out;
  }
}
