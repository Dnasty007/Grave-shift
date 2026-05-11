import * as pc from "playcanvas";
import type { AnimTrack } from "playcanvas";
import { GAME_CONFIG, MAP_CONFIG } from "./config";
import type { CollisionWorld } from "./CollisionWorld";
import type { Map as ZoneMap } from "./Map";
import type { Zombie } from "./Zombie";
import type { EnemyModelKit } from "./Zombie";

export type PetFoxFireResult = {
  fired: boolean;
  hit: boolean;
  zombie: Zombie | null;
  killed: boolean;
  muzzlePos: pc.Vec3;
  aimDir: pc.Vec3;
  impactPoint: pc.Vec3;
};

export type PetBombHit = {
  killed: boolean;
  impactPoint: pc.Vec3;
};

export type PetCombatTick = {
  foxFire: PetFoxFireResult;
  bomb: {
    fired: boolean;
    impactPoint: pc.Vec3;
    hits: PetBombHit[];
  };
};

function horizontalDist2(a: pc.Vec3, b: pc.Vec3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

/** Heuristic scores for choosing glTF clips on non-zombie rigs (e.g. Kurama). */
function scoreClipName(name: string): { idle: number; move: number } {
  const n = name.toLowerCase();
  let idle = 0;
  let move = 0;
  if (n.includes("idle") || n.includes("wait") || n.includes("stand")) idle += 14;
  if (n.includes("walk") || n.includes("jog")) move += 14;
  if (n.includes("run") || n.includes("sprint") || n.includes("charge")) move += 9;
  if (n.includes("fly") || n.includes("hover") || n.includes("float")) {
    idle += 7;
    move += 7;
  }
  if (n.includes("tail") || n.includes("kurama") || n.includes("fox")) {
    idle += 5;
    move += 3;
  }
  if (n.includes("mixamo") || n.includes("armature|")) {
    idle += 2;
    move += 3;
  }
  if (n.includes("action") || n.startsWith("anim") || n.includes("scene")) {
    idle += 3;
    move += 4;
  }
  return { idle, move };
}

function pickPetTracks(kit: EnemyModelKit): { idle: AnimTrack | null; move: AnimTrack | null } {
  const names = kit.listAnimClipNames?.() ?? [];
  let bestIdleName: string | null = null;
  let bestIdleScore = -1;
  let bestMoveName: string | null = null;
  let bestMoveScore = -1;
  for (const name of names) {
    const s = scoreClipName(name);
    if (s.idle > bestIdleScore) {
      bestIdleScore = s.idle;
      bestIdleName = name;
    }
    if (s.move > bestMoveScore) {
      bestMoveScore = s.move;
      bestMoveName = name;
    }
  }

  let idleTrack: AnimTrack | null =
    bestIdleName && bestIdleScore > 0 ? kit.getAnimTrack(bestIdleName) ?? null : null;
  let moveTrack: AnimTrack | null =
    bestMoveName && bestMoveScore > 0 ? kit.getAnimTrack(bestMoveName) ?? null : null;

  const ev = GAME_CONFIG.enemyVisual;
  if (!moveTrack) {
    moveTrack =
      kit.getAnimTrack(ev.animWalkName) ??
      kit.getAnimTrack(ev.animRunName) ??
      kit.getAnimTrack(ev.animFallbackName) ??
      null;
  }
  if (!idleTrack) {
    idleTrack = kit.getAnimTrack(ev.animFallbackName) ?? kit.getAnimTrack(ev.animWalkName) ?? null;
  }

  if (!idleTrack && !moveTrack && names.length > 0) {
    const t = kit.getAnimTrack(names[0]!) ?? null;
    return { idle: t, move: t };
  }
  if (!idleTrack && moveTrack) idleTrack = moveTrack;
  if (!moveTrack && idleTrack) moveTrack = idleTrack;

  return { idle: idleTrack, move: moveTrack };
}

/**
 * Kurama-style companion: roams on a leash around the player; fox-fire + periodic chakra nova.
 */
export class NineTailsPet {
  readonly root: pc.Entity;

  private readonly collision: CollisionWorld | null;
  private readonly cfg = GAME_CONFIG.nineTailsPet;
  private readonly kit: EnemyModelKit;
  private visual: pc.Entity | null = null;
  private animComponent: pc.AnimComponent | null = null;
  private idleTrack: AnimTrack | null = null;
  private moveTrack: AnimTrack | null = null;
  private petLoco: "idle" | "move" | null = null;

  private foxCooldown = 0;
  private bombCooldown = 0;
  /** Shared lockout so bomb + fox-fire don’t dump in the same instant. */
  private attackGcd = 0;

  private bobOffset = Math.random() * Math.PI * 2;
  private readonly toward = new pc.Vec3();
  private readonly faceQuat = new pc.Quat();
  private readonly scratchMove = new pc.Vec3();
  /** World-space wander waypoint (XZ around player; Y filled from terrain when needed). */
  private readonly roamTarget = new pc.Vec3();
  private roamRetargetTimer = 0;

  constructor(start: pc.Vec3, collision: CollisionWorld | null, kit: EnemyModelKit) {
    this.collision = collision;
    this.kit = kit;
    this.root = new pc.Entity("nine-tails-pet");
    this.root.setPosition(start);

    this.foxCooldown = this.cfg.spawnFoxDelaySeconds;
    this.bombCooldown = this.cfg.spawnBombDelaySeconds;
    this.attackGcd = Math.min(1.2, this.cfg.spawnFoxDelaySeconds);

    let gltfEntity: pc.Entity | null = null;
    try {
      gltfEntity = kit.instantiate();
    } catch (e) {
      console.warn("[NineTailsPet] glTF instantiate failed", e);
    }
    if (gltfEntity) {
      gltfEntity.name = "kurama-gltf";
      const s = this.cfg.modelScale;
      gltfEntity.setLocalScale(s, s, s);
      gltfEntity.setLocalPosition(0, this.cfg.yOffset, 0);
      gltfEntity.setLocalEulerAngles(0, this.cfg.yawOffsetDeg, 0);
      this.root.addChild(gltfEntity);
      this.visual = gltfEntity;
      this.attachLocomotion(gltfEntity);
    }

    this.roamTarget.copy(start);
    this.roamRetargetTimer = 0;

    const clipNames = kit.listAnimClipNames?.();
    if (clipNames && clipNames.length > 0) {
      console.info("[NineTailsPet] glTF clips:", clipNames.join(", "));
    }
  }

  private attachLocomotion(visual: pc.Entity): void {
    const { idle, move } = pickPetTracks(this.kit);
    this.idleTrack = idle;
    this.moveTrack = move;
    const first = move ?? idle;
    if (!first) {
      console.warn("[NineTailsPet] No animation clips in model — tails / walk won’t play.");
      return;
    }
    visual.addComponent("anim");
    this.animComponent = visual.anim ?? null;
    if (!this.animComponent) return;
    this.animComponent.activate = true;
    this.animComponent.playing = true;
    this.animComponent.assignAnimation("Locomotion", first, undefined, 1, true);
    this.petLoco = move ? "move" : "idle";
  }

  private updatePetLocoAnim(moving: boolean, horizSpeed: number): void {
    if (!this.animComponent) return;
    const wantMove = moving && horizSpeed > 0.12;
    const mode: "idle" | "move" = wantMove ? "move" : "idle";
    const track = mode === "move" ? this.moveTrack : this.idleTrack;
    if (!track) return;

    const sameClip = this.idleTrack === this.moveTrack;
    if (!sameClip && this.petLoco !== mode) {
      this.animComponent.assignAnimation("Locomotion", track, undefined, 1, true);
      this.petLoco = mode;
    }

    if (mode === "move") {
      const ref = Math.max(0.25, this.cfg.animRefHorizSpeed);
      const mul = pc.math.clamp(
        (horizSpeed / ref) * this.cfg.animWalkPlaybackMul,
        0.32,
        2.4
      );
      this.animComponent.speed = mul;
    } else {
      this.animComponent.speed = this.cfg.animIdlePlayback;
    }
  }

  destroy(): void {
    this.root.destroy();
  }

  getMuzzleWorld(out: pc.Vec3): pc.Vec3 {
    const p = this.root.getPosition();
    out.set(p.x, p.y + this.cfg.eyeHeight, p.z);
    return out;
  }

  private pickRoamTarget(playerPos: pc.Vec3, map: ZoneMap): void {
    const lo = this.cfg.roamMinDistance;
    const hi = this.cfg.roamMaxDistance;
    const span = Math.max(0.15, hi - lo);
    const r = lo + Math.random() * span;
    const theta = Math.random() * Math.PI * 2;
    const tx = playerPos.x + Math.cos(theta) * r;
    const tz = playerPos.z + Math.sin(theta) * r;
    let ty = playerPos.y;
    if (
      MAP_CONFIG.importVisual.enabled &&
      MAP_CONFIG.importVisual.replacesArena &&
      MAP_CONFIG.importVisual.snapFeetToGround
    ) {
      const g = map.sampleImportedTerrainYNearFeet(tx, tz, playerPos.y + 2);
      if (g != null) ty = g;
    }
    this.roamTarget.set(tx, ty, tz);
  }

  /** Keep horizontal distance to player at or below {@link GAME_CONFIG.nineTailsPet.roamMaxDistance}. */
  private clampLeash(nx: number, ny: number, nz: number, playerPos: pc.Vec3): void {
    const dx = nx - playerPos.x;
    const dz = nz - playerPos.z;
    const d2 = dx * dx + dz * dz;
    const maxR = this.cfg.roamMaxDistance;
    const max2 = maxR * maxR;
    if (d2 <= max2 || d2 < 1e-8) {
      this.scratchMove.set(nx, ny, nz);
      return;
    }
    const inv = maxR / Math.sqrt(d2);
    this.scratchMove.set(playerPos.x + dx * inv, ny, playerPos.z + dz * inv);
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

    const playerPos = playerEntity.getPosition();
    const pos = this.root.getPosition();
    const prevX = pos.x;
    const prevZ = pos.z;

    this.roamRetargetTimer -= dt;
    const dxRt = this.roamTarget.x - pos.x;
    const dzRt = this.roamTarget.z - pos.z;
    const distToTargetSq = dxRt * dxRt + dzRt * dzRt;
    const reach = this.cfg.roamReachDistance;
    if (this.roamRetargetTimer <= 0 || distToTargetSq < reach * reach) {
      this.pickRoamTarget(playerPos, map);
      this.roamRetargetTimer = this.cfg.roamRetargetSeconds;
    }

    const dx = this.roamTarget.x - pos.x;
    const dz = this.roamTarget.z - pos.z;
    const distSq = dx * dx + dz * dz;
    const moveThresh = 0.07;
    const intentMoving = distSq > moveThresh * moveThresh;
    let nx = pos.x;
    let nz = pos.z;
    if (intentMoving) {
      const dist = Math.sqrt(distSq);
      const step = this.cfg.moveSpeed * dt;
      const t = Math.min(1, step / Math.max(dist, 1e-4));
      nx = pos.x + dx * t;
      nz = pos.z + dz * t;
    }

    let ny = playerPos.y;
    if (
      MAP_CONFIG.importVisual.enabled &&
      MAP_CONFIG.importVisual.replacesArena &&
      MAP_CONFIG.importVisual.snapFeetToGround
    ) {
      const g = map.sampleImportedTerrainYNearFeet(nx, nz, playerPos.y + 2);
      if (g != null) ny = g;
    }

    this.clampLeash(nx, ny, nz, playerPos);

    if (this.collision) {
      this.collision.resolveZombiePosition(this.scratchMove, this.cfg.radius);
    }
    this.clampLeash(
      this.scratchMove.x,
      this.scratchMove.y,
      this.scratchMove.z,
      playerPos
    );

    const ddx = this.scratchMove.x - prevX;
    const ddz = this.scratchMove.z - prevZ;
    const horizSpeed = Math.sqrt(ddx * ddx + ddz * ddz) / Math.max(dt, 1e-4);
    const moving = intentMoving || horizSpeed > 0.08;

    this.root.setPosition(this.scratchMove);

    if (moving && (ddx * ddx + ddz * ddz > 1e-8)) {
      this.toward.set(ddx, 0, ddz).normalize();
      this.faceQuat.setFromDirections(pc.Vec3.FORWARD, this.toward);
      this.root.setLocalRotation(this.faceQuat);
    }

    this.bobOffset += dt * 3.6;
    if (this.visual) {
      const bobY = Math.sin(this.bobOffset) * 0.015;
      this.visual.setLocalPosition(0, this.cfg.yOffset + bobY, 0);
    }

    this.updatePetLocoAnim(moving, horizSpeed);
  }

  tickCombat(dt: number, zombies: Zombie[]): PetCombatTick {
    this.foxCooldown = Math.max(0, this.foxCooldown - dt);
    this.bombCooldown = Math.max(0, this.bombCooldown - dt);
    this.attackGcd = Math.max(0, this.attackGcd - dt);

    const bomb: PetCombatTick["bomb"] = {
      fired: false,
      impactPoint: this.root.getPosition().clone(),
      hits: []
    };

    const petPos = this.root.getPosition();
    const rBomb = this.cfg.tailedBeastRadius;
    const r2 = rBomb * rBomb;
    const gcd = this.cfg.petAttackGlobalCooldownSeconds;

    if (this.bombCooldown <= 0 && this.attackGcd <= 0) {
      let anyInRange = false;
      for (const z of zombies) {
        if (!z.alive) continue;
        if (horizontalDist2(petPos, z.getPosition()) <= r2) {
          anyInRange = true;
          break;
        }
      }
      if (anyInRange) {
        this.bombCooldown = this.cfg.tailedBeastIntervalSeconds;
        this.attackGcd = gcd;
        bomb.fired = true;
        bomb.impactPoint.copy(petPos);
        for (const z of zombies) {
          if (!z.alive) continue;
          if (horizontalDist2(petPos, z.getPosition()) > r2) continue;
          const ip = z.getAimTarget().clone();
          const killed = z.applyDamage(this.cfg.tailedBeastDamage);
          bomb.hits.push({ killed, impactPoint: ip });
        }
      }
    }

    const eye = this.getMuzzleWorld(new pc.Vec3());
    let best: Zombie | null = null;
    let bestDistSq = this.cfg.foxFireRange * this.cfg.foxFireRange;

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

    const foxFire: PetFoxFireResult = {
      fired: false,
      hit: false,
      zombie: null,
      killed: false,
      muzzlePos: eye.clone(),
      aimDir: new pc.Vec3(0, 0, -1),
      impactPoint: eye.clone()
    };

    if (best && best.alive && this.foxCooldown <= 0 && this.attackGcd <= 0) {
      const aim = best.getAimTarget();
      foxFire.aimDir.set(aim.x - eye.x, aim.y - eye.y, aim.z - eye.z);
      const len = foxFire.aimDir.length();
      if (len > 1e-4) {
        foxFire.aimDir.mulScalar(1 / len);
        this.foxCooldown = this.cfg.foxFireIntervalSeconds;
        this.attackGcd = gcd;
        foxFire.fired = true;
        foxFire.hit = true;
        foxFire.zombie = best;
        foxFire.impactPoint.copy(aim);
        foxFire.killed = best.applyDamage(this.cfg.foxFireDamage);
      }
    }

    return { foxFire, bomb };
  }
}
