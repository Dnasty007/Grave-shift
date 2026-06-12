import {
  ColliderShape,
  Entity,
  EntityModelAnimationLoopMode,
  RigidBodyType,
  World,
  type Vector3Like,
} from "hytopia";
import { VFX } from "../VFX";

/**
 * IceDragonBoss — ported from the Minecraft (MythicMobs) Ice Dragon boss kit.
 *
 * Source definitions: IceDragon.yml + IceDragonSkills.yml (OCD GAME/models/BOSS).
 * The model (ice-dragon.glb) ships the full animation set the YAML drives:
 *   walk · idle · fly · flyidle · attacke (breath) · attack2 (slam) · attack3 (claw) · death
 *
 * Skill translation to the Hytopia Neo engine:
 *  - Claw            ← `Claw` (attack3 + throw + damage in melee range)
 *  - Ground Slam     ← `IceDragonAttack3` (attack2 + AoE explosion + knockback)
 *  - Ice Breath      ← `IceDragonFire2` (attacke + per-tick projectile stream at target)
 *  - Flight Bombard  ← `IceFlyFire`/`breathefire` (take off, circle, rain projectiles,
 *                       descend with an AoE landing slam)
 *  - Proximity Push  ← `IceDragonPush` (shove players hugging the hitbox)
 *  - Numbers rescaled from Minecraft values (HP 500, dmg 2-10) to this game's
 *    economy (gun DPS ~300-600, player HP 100).
 */

// ── Tuning ───────────────────────────────────────────────────────────────────
const MODEL_SCALE   = 0.4;    // raw model ~13u long → ~5.4u long, ~4.2u tall in-world
/**
 * ice-dragon.glb TRUE rest-pose bounds relative to the model origin, computed by
 * walking the node hierarchy with transforms applied (not raw accessor bounds):
 *   x: -6.251 .. +6.276   y: +0.875 .. +15.297   z: -12.474 .. +9.579
 * The dragon is LONG (22u along Z: tail behind, head in front) — which is why the
 * old thin vertical capsule only registered hits on the lower center ("bottom area"):
 * a vertical column can't cover a horizontal dragon.
 */
const MODEL_BBOX_MIN_Y = 0.875;
const MODEL_BBOX_MAX_Y = 15.297;
// Scaled, origin-relative hit-volume box covering the whole visible body (+ small pad
// for animation sway). Rotates with the entity's yaw, so the long axis tracks facing.
const HIT_BOX_HALF = {
  x: 6.3  * MODEL_SCALE + 0.1,                              // ±2.6
  y: ((MODEL_BBOX_MAX_Y - MODEL_BBOX_MIN_Y) / 2) * MODEL_SCALE + 0.15, // ±3.03
  z: (22.05 / 2) * MODEL_SCALE + 0.2,                       // ±4.6
};
const HIT_BOX_CENTER = {
  x: 0,
  y: ((MODEL_BBOX_MIN_Y + MODEL_BBOX_MAX_Y) / 2) * MODEL_SCALE, // +3.23
  z: ((-12.474 + 9.579) / 2) * MODEL_SCALE,                     // -0.58 (tail-heavy)
};
/** Forgiving fallback hit-sphere: rotation-invariant, covers body + head + tail. */
const HIT_SPHERE_CENTER_Y = HIT_BOX_CENTER.y;
const HIT_SPHERE_RADIUS   = 5.5;
/** Rig origin sits near bbox centre — raise entity so feet rest on the floor. */
const MODEL_HALF_HEIGHT = ((MODEL_BBOX_MAX_Y - MODEL_BBOX_MIN_Y) * 0.5) * MODEL_SCALE;
/** Small lift so belly/legs clear the grass voxel surface (matches how players stand on y+1). */
const GROUND_SURFACE_LIFT = 0.55;

/** World Y for entity.position so the dragon walks on top of groundTop blocks. */
export function iceDragonSpawnY(groundTop: number, playerFloorOffset = 0): number {
  const fromBbox = groundTop + MODEL_HALF_HEIGHT + GROUND_SURFACE_LIFT;
  const fromPlayer = groundTop + playerFloorOffset;
  return Math.max(fromBbox, fromPlayer);
}
const BASE_HP       = 6000;
const WALK_SPEED    = 2.3;

const CLAW_RANGE    = 4.6;
const CLAW_WINDUP_S = 0.5;
const CLAW_DMG      = 25;
const CLAW_CD_S     = 2.5;

const SLAM_RANGE    = 9;
const SLAM_WINDUP_S = 0.7;
const SLAM_DMG      = 35;
const SLAM_RADIUS   = 7;
const SLAM_CD_S     = 14;

const BREATH_MIN_R  = 5;
const BREATH_MAX_R  = 22;
const BREATH_CD_S   = 16;
const BREATH_DUR_S  = 3.0;
const BREATH_BOLT_INTERVAL_S = 0.18;
const BOLT_SPEED    = 16;
const BOLT_DMG      = 7;
const BOLT_HIT_R    = 1.4;
const BOLT_LIFE_S   = 2.5;

const FLIGHT_CD_S       = 40;   // first flight happens sooner (see _flightCdS init)
const FLIGHT_ALT        = 9;    // hover height above ground
const TAKEOFF_S         = 1.6;
const CIRCLE_S          = 9;
const CIRCLE_RADIUS     = 11;
const CIRCLE_ANG_SPEED  = 0.7;  // rad/s
const BOMB_INTERVAL_S   = 0.8;
const BOMB_DMG          = 15;
const BOMB_RADIUS       = 3;
const LAND_S            = 1.2;
const LAND_DMG          = 30;
const LAND_RADIUS       = 8;

const PUSH_RANGE    = 2.8;
const PUSH_CD_S     = 3;
const PUSH_DMG      = 4;

const DEATH_S       = 2.2;

const ICE_SPHERE = "models/particles/ice-sphere.glb";

// ── Types ────────────────────────────────────────────────────────────────────

export type IceDragonHooks = {
  /** Current player (PlayerEntity) position, or null if unavailable. */
  getPlayerPos: () => Vector3Like | null;
  /** Apply damage to the player (red flash / shake / death handled by Director). */
  damagePlayer: (amount: number, isHeavy: boolean) => void;
  /** Shove the player away from a position (Director sets velocity on the PlayerEntity). */
  knockbackPlayer: (fromPos: Vector3Like, horizontal: number, vertical: number) => void;
  /** Boss died — Director awards points and clears the wave. */
  onDeath: () => void;
  /** Chat announcement helper. */
  announce: (msg: string, color?: string) => void;
};

type BossState =
  | "ground"    // chase + basic skills
  | "claw"      // attack3 windup
  | "slam"      // attack2 windup
  | "breath"    // attacke channel
  | "takeoff"   // rising
  | "circle"    // airborne bombardment
  | "land"      // descending → landing slam
  | "dying";

type IceProjectile = {
  entity: Entity;
  vel: Vector3Like;
  kind: "bolt" | "bomb";
  ageS: number;
};

// ── Boss ─────────────────────────────────────────────────────────────────────

export class IceDragonBoss {
  readonly entity: Entity;
  readonly maxHp: number;
  private _hp: number;
  private _state: BossState = "ground";
  private _stateT = 0;            // seconds in current state
  private _groundY: number;       // capsule-centre Y when on the ground

  // Cooldowns (seconds remaining)
  private _clawCdS   = 1.5;
  private _slamCdS   = 6;
  private _breathCdS = 8;
  private _flightCdS = 14;        // first flight ~14s into the fight
  private _pushCdS   = 0;

  // Sub-timers
  private _boltAccS  = 0;
  private _bombAccS  = 0;
  private _circleAng = 0;
  private _milestones = new Set<number>(); // announced HP % marks

  private _currentLoop: string | null = null;
  private _projectiles: IceProjectile[] = [];
  private _world: World;
  private _hooks: IceDragonHooks;
  private _dead = false;

  constructor(world: World, spawnPos: Vector3Like, hooks: IceDragonHooks, hpBonus = 0) {
    this._world = world;
    this._hooks = hooks;
    this.maxHp = BASE_HP + hpBonus;
    this._hp = this.maxHp;
    this._groundY = spawnPos.y;

    this.entity = new Entity({
      name: "IceDragon",
      tag: "gehenna-boss",
      modelUri: "models/bosses/ice-dragon.glb",
      modelScale: MODEL_SCALE,
      rigidBodyOptions: {
        type: RigidBodyType.KINEMATIC_VELOCITY,
        colliders: [
          {
            // One body-sized box covering the WHOLE visible dragon (head, neck,
            // torso, tail). Rotates with the entity's yaw so the long axis always
            // matches the model. Replaces the old thin vertical capsule that only
            // caught shots at the lower center.
            shape: ColliderShape.BLOCK,
            halfExtents: { ...HIT_BOX_HALF },
            relativePosition: { ...HIT_BOX_CENTER },
            tag: "body",
          },
        ],
      },
    });

    this.entity.spawn(world, spawnPos);
    this._loop("walk");
  }

  get isAlive(): boolean { return !this._dead; }
  get hp(): number { return this._hp; }
  get hpFraction(): number { return this.maxHp > 0 ? this._hp / this.maxHp : 0; }

  /**
   * Forgiving ray test when the physics ray misses or hits terrain first.
   * Ray-vs-sphere around the body centre — rotation-invariant, so it covers the
   * dragon regardless of facing (the old capsule test also had a sign bug that
   * made it only register point-blank).
   */
  raycastHitPoint(origin: Vector3Like, direction: Vector3Like, maxDist: number): Vector3Like | null {
    if (this._dead || !this.entity.isSpawned) return null;

    const bp = this.entity.position;
    const t = raySphereDistance(
      origin,
      direction,
      maxDist,
      { x: bp.x, y: bp.y + HIT_SPHERE_CENTER_Y, z: bp.z },
      HIT_SPHERE_RADIUS
    );
    if (t === null) return null;

    return {
      x: origin.x + direction.x * t,
      y: origin.y + direction.y * t,
      z: origin.z + direction.z * t,
    };
  }

  /** Damage from guns / lethals. Returns true if this hit killed the boss. */
  takeDamage(amount: number): boolean {
    if (this._dead) return false;
    this._hp = Math.max(0, this._hp - amount);

    // Boss-bar substitute: announce HP milestones once each
    for (const mark of [75, 50, 25]) {
      const pct = (this._hp / this.maxHp) * 100;
      if (pct <= mark && !this._milestones.has(mark)) {
        this._milestones.add(mark);
        this._hooks.announce(`ICE DRAGON — ${mark}% remaining!`, "66CCFF");
      }
    }

    if (this._hp <= 0) {
      this._die();
      return true;
    }
    return false;
  }

  /** Full teardown (run end / map change). Safe to call repeatedly. */
  destroy(): void {
    this._dead = true;
    this._clearProjectiles();
    try { if (this.entity.isSpawned) this.entity.despawn(); } catch {}
  }

  // ── Main tick ──────────────────────────────────────────────────────────────

  tick(dtS: number): void {
    if (this._dead && this._state !== "dying") return;

    this._stateT += dtS;
    this._clawCdS   = Math.max(0, this._clawCdS - dtS);
    this._slamCdS   = Math.max(0, this._slamCdS - dtS);
    this._breathCdS = Math.max(0, this._breathCdS - dtS);
    this._flightCdS = Math.max(0, this._flightCdS - dtS);
    this._pushCdS   = Math.max(0, this._pushCdS - dtS);

    this._tickProjectiles(dtS);

    const playerPos = this._hooks.getPlayerPos();
    if (!playerPos) { this._halt(); return; }

    switch (this._state) {
      case "ground":  this._tickGround(playerPos); break;
      case "claw":    this._tickClaw(playerPos); break;
      case "slam":    this._tickSlam(playerPos); break;
      case "breath":  this._tickBreath(dtS, playerPos); break;
      case "takeoff": this._tickTakeoff(); break;
      case "circle":  this._tickCircle(dtS, playerPos); break;
      case "land":    this._tickLand(playerPos); break;
      case "dying":   this._tickDying(); break;
    }
  }

  // ── States ─────────────────────────────────────────────────────────────────

  private _tickGround(p: Vector3Like): void {
    const bp = this.entity.position;
    // Kinematic chase can sink the model into voxel blocks — lock Y to the floor.
    if (Math.abs(bp.y - this._groundY) > 0.02) {
      try { this.entity.setPosition({ x: bp.x, y: this._groundY, z: bp.z }); } catch {}
    }
    const dx = p.x - bp.x, dz = p.z - bp.z;
    const dist = Math.hypot(dx, dz);

    // Skill priority (mirrors the YAML timer/condition gates)
    if (this._flightCdS === 0) { this._enter("takeoff"); this._loop("fly"); return; }
    if (this._breathCdS === 0 && dist >= BREATH_MIN_R && dist <= BREATH_MAX_R) {
      this._enter("breath");
      this._halt();
      this._oneshot("attacke");
      return;
    }
    if (this._slamCdS === 0 && dist <= SLAM_RANGE) {
      this._enter("slam");
      this._halt();
      this._oneshot("attack2");
      return;
    }
    if (this._clawCdS === 0 && dist <= CLAW_RANGE) {
      this._enter("claw");
      this._halt();
      this._oneshot("attack3");
      return;
    }

    // IceDragonPush — shove players hugging the hitbox
    if (dist < PUSH_RANGE && this._pushCdS === 0) {
      this._pushCdS = PUSH_CD_S;
      this._hooks.knockbackPlayer(bp, 10, 3.5);
      this._hooks.damagePlayer(PUSH_DMG, false);
    }

    // Chase (KINEMATIC_VELOCITY, same convention as the zombie AI)
    if (dist > CLAW_RANGE * 0.8) {
      const inv = 1 / (dist || 1);
      this.entity.setLinearVelocity({ x: dx * inv * WALK_SPEED, y: 0, z: dz * inv * WALK_SPEED });
      this._faceToward(p);
      this._loop("walk");
    } else {
      this._halt();
      this._loop("idle");
    }
  }

  private _tickClaw(p: Vector3Like): void {
    if (this._stateT < CLAW_WINDUP_S) return;

    const bp = this.entity.position;
    if (Math.hypot(p.x - bp.x, p.z - bp.z) <= CLAW_RANGE + 1.2) {
      this._hooks.damagePlayer(CLAW_DMG, true);
      this._hooks.knockbackPlayer(bp, 12, 4);
    }
    this._clawCdS = CLAW_CD_S;
    this._enter("ground");
  }

  private _tickSlam(p: Vector3Like): void {
    if (this._stateT < SLAM_WINDUP_S) return;

    const bp = this.entity.position;
    VFX.lethalExplosion(this._world, { x: bp.x, y: this._groundY, z: bp.z }, 1.3);
    if (Math.hypot(p.x - bp.x, p.z - bp.z) <= SLAM_RADIUS) {
      this._hooks.damagePlayer(SLAM_DMG, true);
      this._hooks.knockbackPlayer(bp, 16, 8);
    }
    this._slamCdS = SLAM_CD_S;
    this._enter("ground");
  }

  private _tickBreath(dtS: number, p: Vector3Like): void {
    this._faceToward(p);
    this._halt();

    this._boltAccS += dtS;
    while (this._boltAccS >= BREATH_BOLT_INTERVAL_S) {
      this._boltAccS -= BREATH_BOLT_INTERVAL_S;
      this._spawnBolt(p);
    }

    if (this._stateT >= BREATH_DUR_S) {
      this._breathCdS = BREATH_CD_S;
      this._enter("ground");
    }
  }

  private _tickTakeoff(): void {
    const bp = this.entity.position;
    const targetY = this._groundY + FLIGHT_ALT;
    if (this._stateT >= TAKEOFF_S || bp.y >= targetY) {
      this.entity.setLinearVelocity({ x: 0, y: 0, z: 0 });
      this._circleAng = Math.atan2(bp.x, bp.z);
      this._enter("circle");
      return;
    }
    this.entity.setLinearVelocity({ x: 0, y: (FLIGHT_ALT / TAKEOFF_S), z: 0 });
  }

  private _tickCircle(dtS: number, p: Vector3Like): void {
    // Orbit the player while raining ice bombs (IceFlyFire pattern)
    this._circleAng += CIRCLE_ANG_SPEED * dtS;
    const targetX = p.x + Math.sin(this._circleAng) * CIRCLE_RADIUS;
    const targetZ = p.z + Math.cos(this._circleAng) * CIRCLE_RADIUS;
    const targetY = this._groundY + FLIGHT_ALT;

    const bp = this.entity.position;
    const k = 2.2; // approach gain — smooth pursuit of the orbit point
    this.entity.setLinearVelocity({
      x: (targetX - bp.x) * k,
      y: (targetY - bp.y) * k,
      z: (targetZ - bp.z) * k,
    });
    this._faceToward(p);
    this._loop("fly");

    this._bombAccS += dtS;
    if (this._bombAccS >= BOMB_INTERVAL_S) {
      this._bombAccS = 0;
      this._spawnBomb(p);
    }

    if (this._stateT >= CIRCLE_S) {
      this._enter("land");
    }
  }

  private _tickLand(p: Vector3Like): void {
    const bp = this.entity.position;
    if (this._stateT < LAND_S && bp.y > this._groundY + 0.2) {
      this.entity.setLinearVelocity({ x: 0, y: -(FLIGHT_ALT / LAND_S), z: 0 });
      return;
    }

    // Landing slam (blockwave in the YAML → AoE + knockback here)
    this.entity.setLinearVelocity({ x: 0, y: 0, z: 0 });
    try { this.entity.setPosition({ x: bp.x, y: this._groundY, z: bp.z }); } catch {}
    VFX.c4Detonation(this._world, { x: bp.x, y: this._groundY, z: bp.z }, true);
    if (Math.hypot(p.x - bp.x, p.z - bp.z) <= LAND_RADIUS) {
      this._hooks.damagePlayer(LAND_DMG, true);
      this._hooks.knockbackPlayer(bp, 14, 7);
    }
    this._oneshot("attack2");
    this._flightCdS = FLIGHT_CD_S;
    this._loop("walk");
    this._enter("ground");
  }

  private _tickDying(): void {
    if (this._stateT >= DEATH_S) {
      const bp = this.entity.position;
      VFX.deathExplosion(this._world, bp);
      VFX.lethalExplosion(this._world, { x: bp.x + 1.5, y: bp.y, z: bp.z }, 1.2);
      VFX.lethalExplosion(this._world, { x: bp.x - 1.5, y: bp.y, z: bp.z - 1 }, 1.2);
      this.destroy();
      this._hooks.onDeath();
    }
  }

  private _die(): void {
    this._dead = true;
    this._halt();
    this._clearProjectiles();
    this._stopLoop();
    this._oneshot("death");
    this._enter("dying");
    this._hooks.announce("THE ICE DRAGON FALLS!", "66CCFF");
  }

  // ── Projectiles (ice breath bolts + flight bombs) ──────────────────────────

  private _spawnBolt(target: Vector3Like): void {
    const bp = this.entity.position;
    // Mouth-height origin, slight forward offset toward the target
    const origin = { x: bp.x, y: bp.y + 1.2, z: bp.z };
    const dx = target.x - origin.x;
    const dy = (target.y + 0.4) - origin.y;
    const dz = target.z - origin.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    // Small spread so the stream sweeps like the YAML projectile aura
    const spread = 0.06;
    const vel = {
      x: (dx / len + (Math.random() - 0.5) * spread) * BOLT_SPEED,
      y: (dy / len + (Math.random() - 0.5) * spread) * BOLT_SPEED,
      z: (dz / len + (Math.random() - 0.5) * spread) * BOLT_SPEED,
    };
    this._spawnProjectile("bolt", origin, vel, 0.9);
  }

  private _spawnBomb(target: Vector3Like): void {
    const bp = this.entity.position;
    const origin = { x: bp.x, y: bp.y - 0.5, z: bp.z };
    // Lob toward the player's current position; manual gravity pulls it down
    const dx = target.x - origin.x;
    const dz = target.z - origin.z;
    const t = 1.1; // seconds to target (approx)
    const vel = { x: dx / t, y: 2.5, z: dz / t };
    this._spawnProjectile("bomb", origin, vel, 1.4);
  }

  private _spawnProjectile(kind: "bolt" | "bomb", origin: Vector3Like, vel: Vector3Like, scale: number): void {
    const ent = new Entity({
      name: `ice-${kind}`,
      modelUri: ICE_SPHERE,
      modelScale: scale,
      rigidBodyOptions: { type: RigidBodyType.KINEMATIC_VELOCITY },
    });
    ent.spawn(this._world, origin);
    ent.setLinearVelocity(vel);
    this._projectiles.push({ entity: ent, vel: { ...vel }, kind, ageS: 0 });
  }

  private _tickProjectiles(dtS: number): void {
    if (this._projectiles.length === 0) return;
    const playerPos = this._hooks.getPlayerPos();
    const remaining: IceProjectile[] = [];

    for (const pr of this._projectiles) {
      pr.ageS += dtS;
      const pos = pr.entity.isSpawned ? pr.entity.position : null;
      if (!pos) continue;

      // Bombs fall under manual gravity (KINEMATIC_VELOCITY ignores world gravity)
      if (pr.kind === "bomb") {
        pr.vel.y -= 14 * dtS;
        try { pr.entity.setLinearVelocity(pr.vel); } catch {}
      }

      let detonate = false;
      let hitPlayer = false;

      if (playerPos) {
        const d = Math.hypot(playerPos.x - pos.x, playerPos.y - pos.y, playerPos.z - pos.z);
        if (d <= (pr.kind === "bolt" ? BOLT_HIT_R : 1.2)) {
          detonate = true;
          hitPlayer = true;
        }
      }
      // Ground impact / lifetime expiry
      if (pos.y <= this._groundY + 0.25) detonate = true;
      if (pr.ageS >= (pr.kind === "bolt" ? BOLT_LIFE_S : 6)) detonate = true;

      if (!detonate) { remaining.push(pr); continue; }

      if (pr.kind === "bomb") {
        VFX.lethalExplosion(this._world, pos, 0.8);
        if (playerPos && Math.hypot(playerPos.x - pos.x, playerPos.z - pos.z) <= BOMB_RADIUS) {
          this._hooks.damagePlayer(BOMB_DMG, false);
        }
      } else if (hitPlayer) {
        this._hooks.damagePlayer(BOLT_DMG, false);
      }
      try { if (pr.entity.isSpawned) pr.entity.despawn(); } catch {}
    }

    this._projectiles = remaining;
  }

  private _clearProjectiles(): void {
    for (const pr of this._projectiles) {
      try { if (pr.entity.isSpawned) pr.entity.despawn(); } catch {}
    }
    this._projectiles = [];
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private _enter(state: BossState): void {
    this._state = state;
    this._stateT = 0;
  }

  private _halt(): void {
    try { this.entity.setLinearVelocity({ x: 0, y: 0, z: 0 }); } catch {}
  }

  /** Face the target on the XZ plane (same yaw convention as the zombie AI). */
  private _faceToward(p: Vector3Like): void {
    const bp = this.entity.position;
    const angle = Math.atan2(p.x - bp.x, p.z - bp.z) + Math.PI;
    const hs = Math.sin(angle / 2);
    const hc = Math.cos(angle / 2);
    try { this.entity.setRotation({ x: 0, y: hs, z: 0, w: hc }); } catch {}
  }

  /** Switch the looping animation (walk/idle/fly/flyidle), stopping the previous loop. */
  private _loop(name: string): void {
    if (this._currentLoop === name) return;
    this._stopLoop();
    const anim = this.entity.getModelAnimation(name);
    if (anim) {
      anim.setLoopMode(EntityModelAnimationLoopMode.LOOP);
      anim.play();
      this._currentLoop = name;
    }
  }

  private _stopLoop(): void {
    if (this._currentLoop) {
      try { this.entity.getModelAnimation(this._currentLoop)?.stop(); } catch {}
      this._currentLoop = null;
    }
  }

  /** Play a one-shot attack/death clip on top of the current loop. */
  private _oneshot(name: string): void {
    try { this.entity.getModelAnimation(name)?.restart(); } catch {}
  }
}

/** Ray vs sphere — returns entry distance along the (normalised) ray, or null on miss. */
function raySphereDistance(
  origin: Vector3Like,
  direction: Vector3Like,
  maxDist: number,
  center: Vector3Like,
  radius: number
): number | null {
  const dLen = Math.hypot(direction.x, direction.y, direction.z) || 1;
  const dx = direction.x / dLen;
  const dy = direction.y / dLen;
  const dz = direction.z / dLen;

  const fx = origin.x - center.x;
  const fy = origin.y - center.y;
  const fz = origin.z - center.z;

  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const c = fx * fx + fy * fy + fz * fz - radius * radius;
  const disc = b * b - 4 * c; // a = 1 (unit direction)
  if (disc < 0) return null;

  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) * 0.5;
  const t2 = (-b + sq) * 0.5;
  // Entry point if outside; clamp to 0 if the origin is inside the sphere.
  const t = t1 >= 0 ? t1 : (t2 >= 0 ? 0 : null);
  if (t === null || t > maxDist) return null;
  return t;
}
