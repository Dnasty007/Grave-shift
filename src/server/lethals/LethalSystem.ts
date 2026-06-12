import {
  ColliderShape,
  Entity,
  RigidBodyType,
  World,
  type Vector3Like,
} from "hytopia";
import { VFX } from "../VFX";
import type { LethalId } from "../loadoutConfig";

// Visual model paths
const GOLD_BLOCK    = "models/particles/.optimized/gold-block/gold-block.glb";
const RED_BLOCK     = "models/particles/.optimized/red-block/red-block.glb";
const STICKY_BOMB   = "models/particles/sticky-bomb.glb";  // custom: olive sphere + wooden handle (No. 74 ST)
const C4_BLOCK      = "models/particles/c4-block.glb";     // custom: flat cream M112 demolition block
const SMINE_MODEL   = "models/particles/smine.glb";         // custom: olive cylinder + 3 steel trigger prongs

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type LethalDamageFn = (
  world: World,
  host: any, // Player
  center: Vector3Like,
  radius: number,
  damageMultiplier: number
) => void;

interface BaseLethal {
  id: string;
  lethalKind: LethalId;
  entity: Entity;
  fuseRemaining: number;
  blastRadius: number;
  damageMultiplier: number;
  armed: boolean;
  cleanup(): void;
}

interface FlyingLethal extends BaseLethal {
  kind: "flying";
  velocity: Vector3Like;
  stuck: boolean;
  stuckTo?: Entity; // zombie or world prop
}

interface C4Charge extends BaseLethal {
  kind: "c4";
  armed: true; // always "armed" once planted
}

interface Smine extends BaseLethal {
  kind: "smine";
  state: "arming" | "armed" | "popping";
  armT: number;
  groundY: number;
  x: number;
  z: number;
  popT?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tuning (mirrors legacy LETHAL_PHYSICS + LETHAL_PARAMS for faithful behavior)
// ─────────────────────────────────────────────────────────────────────────────

const PHYS = {
  gravity: 32,
  arcUpBias: 0.38,
  groundRestitution: 0.42,
  groundFriction: 0.68,
  colliderRadius: 0.29,   // matched to the much larger single-ball grenade visual (0.58+ scale) so bounces feel correct
  spawnForward: 0.65,
  spawnDown: 0.08,
  fuseWarningWindow: 0.55,
  glowPulseHz: 4.0,
} as const;

const SPEC = {
  // M67 frag: metal egg-shaped body, ~1-2 bounces on hard ground then settles, 1.8 s cook-off fuse
  frag:    { radius: 6,   fuse: 1.8, dmgMul: 1.0,  throwSpeed: 22, bounciness: 0.22, colliderR: 0.28 },
  // N74 ST sticky: tennis-ball-sized sphere coated in adhesive; sticks to first non-player surface it hits
  n74st:   { radius: 5,   fuse: 2.0, dmgMul: 1.0,  throwSpeed: 30, bounciness: 0.05, colliderR: 0.24, sticky: true },
  // C4 (M112): flat clay-like brick; barely bounces; remote-detonated by holding G
  satchel: { radius: 15,  fuse: 0,   dmgMul: 1.7,  throwSpeed: 9,  bounciness: 0.04, c4: true },
  // S-Mine 44 (Bouncing Betty): planted stake; proximity-triggered by ENEMIES; pops ~1.9 m then shrapnel
  smine44: { radius: 5.5, fuse: 0,   dmgMul: 1.12, place: true, armSeconds: 2.9, triggerR: 2.35, popH: 1.9, popDur: 0.36, shrapnel: 14 },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// LethalSystem - owns all live lethal Entities + their sim
// ─────────────────────────────────────────────────────────────────────────────

export class LethalSystem {
  private _active: (FlyingLethal | C4Charge | Smine)[] = [];
  private _c4HoldSeconds = 0;
  private _c4HoldFired = false;
  private _pulseAcc = 0;

  constructor(private _damageFn: LethalDamageFn) {}

  /** Called when round resets / session ends */
  reset(): void {
    for (const l of this._active) {
      try { l.cleanup(); } catch {}
    }
    this._active = [];
    this._c4HoldSeconds = 0;
    this._c4HoldFired = false;
  }

  getActiveC4Count(): number {
    return this._active.filter((a) => a.lethalKind === "satchel").length;
  }

  getActiveSmineCount(): number {
    return this._active.filter((a) => a.lethalKind === "smine44").length;
  }

  /** Per-frame simulation for all live lethals (bounces, fuse, sticky, proximity, pop, shrapnel) */
  tick(dt: number, world: World, host: any, zombiePositions?: readonly Vector3Like[]): void {
    if (this._active.length === 0) return;

    this._pulseAcc += dt;
    const remaining: any[] = [];

    for (const l of this._active) {
      if (l.kind === "flying") {
        this._tickFlying(l as FlyingLethal, dt, world, host, remaining);
      } else if (l.kind === "c4") {
        // C4 uses real DYNAMIC physics; detect when it settles and lock it down
        if (!(l as any)._landed) {
          try {
            const v = l.entity.linearVelocity || { x: 0, y: 0, z: 0 };
            const speed = Math.hypot(v.x, v.y, v.z);
            if (speed < 0.4) {
              (l as any)._settleT = ((l as any)._settleT || 0) + dt;
              if ((l as any)._settleT > 0.3) {
                (l as any)._landed = true;
                l.entity.setType(RigidBodyType.FIXED); // lock to surface — it's now an armed charge
              }
            } else {
              (l as any)._settleT = 0;
            }
          } catch {}
        }
        remaining.push(l);
      } else if (l.kind === "smine") {
        this._tickSmine(l as Smine, dt, world, host, zombiePositions, remaining);
      }
    }

    this._active = remaining;
  }

  /** Main entry from Director (G tap or UI lethal use) */
  useLethal(
    world: World,
    pe: any,
    lethalId: LethalId,
    origin: Vector3Like,
    forward: Vector3Like
  ): { ok: boolean; reason?: string; chargesLeft?: number } {
    const spec = SPEC[lethalId];
    if (!spec) return { ok: false, reason: "Unknown lethal" };

    if (lethalId === "satchel") {
      if (this.getActiveC4Count() >= 4) return { ok: false, reason: "Max 4 C4 active" };
      return this._throwC4(world, origin, forward);
    }

    if (lethalId === "smine44") {
      if (this.getActiveSmineCount() >= 3) return { ok: false, reason: "Too many S-Mines" };
      return this._placeSmine(world, pe, origin, forward);
    }

    // frag + n74st: real thrown physics objects
    return this._throwFlying(world, lethalId, origin, forward);
  }

  /** Hold-G logic for satchel (call every tick with nHeld state) */
  tickC4Hold(dt: number, world: World, host: any): void {
    const hasC4 = this.getActiveC4Count() > 0;
    const holding = (host.input as any)?.n === true;

    if (!holding || !hasC4) {
      this._c4HoldSeconds = 0;
      this._c4HoldFired = false;
      return;
    }

    this._c4HoldSeconds += dt;
    if (this._c4HoldSeconds >= 0.65 && !this._c4HoldFired) {
      this._c4HoldFired = true;
      this._detonateAllC4(world, host);
    }
  }

  /** Detonate the single closest armed C4 to the player (for "one at a time" play) */
  detonateNearestC4(world: World, host: any, playerPos?: Vector3Like): boolean {
    const armed = this._active.filter((a: any) => a.lethalKind === "satchel");
    if (armed.length === 0) return false;

    const hp = playerPos || { x: 0, y: 0, z: 0 };
    let closest: any = null;
    let bestD = Infinity;

    for (const c of armed) {
      const p = c.entity?.position || (c as any)._pos;
      if (!p) continue;
      const d = Math.hypot(p.x - hp.x, p.z - hp.z);
      if (d < bestD) { bestD = d; closest = c; }
    }
    if (!closest) return false;

    const pos = closest.entity?.position || (closest as any)._pos || hp;
    VFX.c4Detonation(world, pos, true);
    try { this._damageFn(world, host, pos, closest.blastRadius, closest.damageMultiplier); } catch {}
    try { closest.cleanup(); } catch {}
    this._active = this._active.filter((a) => a !== closest);
    return true;
  }

  // ── Private throwers ────────────────────────────────────────────────────────

  private _throwFlying(
    world: World,
    kind: "frag" | "n74st",
    origin: Vector3Like,
    forward: Vector3Like
  ) {
    const s = SPEC[kind];
    const phys = PHYS;
    const isSticky = kind === "n74st";

    // Arc lob
    const dir = { ...forward };
    dir.y = (dir.y || 0) + phys.arcUpBias;
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    dir.x /= len; dir.y /= len; dir.z /= len;

    const spawnPos: Vector3Like = {
      x: origin.x + dir.x * phys.spawnForward,
      y: origin.y + dir.y * phys.spawnForward - phys.spawnDown,
      z: origin.z + dir.z * phys.spawnForward,
    };

    const speed = s.throwSpeed;
    const vel: Vector3Like = { x: dir.x * speed, y: dir.y * speed, z: dir.z * speed };

    // ── Visual model ──────────────────────────────────────────────────────────
    // Frag (M67): small solid metal egg — use gold-block cube at tiny scale (game-style blocky grenade)
    // Sticky (N74 ST): tennis-ball-sized sphere coated in adhesive — single clean fireball ball
    const modelUri  = isSticky ? STICKY_BOMB : GOLD_BLOCK;
    const mainScale = isSticky ? 0.5         : 1.7;   // sticky: hand-sized; frag: visible mid-air
    const colliderR = (s as any).colliderR ?? 0.28;

    // One-shot flag — the onCollision callback can fire many times per frame;
    // we only want the FIRST contact to trigger the stick so it doesn't jitter.
    let hasStuck = false;

    const ball = new Entity({
      name: `lethal-${kind}-${Date.now()}`,
      modelUri,
      modelScale: mainScale,
      rigidBodyOptions: {
        type: RigidBodyType.DYNAMIC,
        linearDamping:  0.6,
        angularDamping: 6.0,
        colliders: [
          {
            shape: ColliderShape.BALL,
            radius: colliderR,
            bounciness: s.bounciness,
            friction: isSticky ? 0.95 : 0.90,
            onCollision: isSticky ? (other: any, started: boolean) => {
              // Stick to ANYTHING on first contact — walls, blocks, props, zombies — except the thrower
              if (started && !hasStuck && !this._isPlayer(other)) {
                hasStuck = true;
                this._stickN74stTo(ball, other);
              }
            } : undefined,
          },
        ],
      },
    });
    ball.spawn(world, spawnPos);
    ball.setLinearVelocity(vel);

    // Brief tumble in the air — heavy grenade, not a lot of spin
    const spinMax = isSticky ? 2 : 1.5;
    ball.setAngularVelocity({
      x: (Math.random() - 0.5) * spinMax,
      y: spinMax * (0.4 + Math.random() * 0.4),
      z: (Math.random() - 0.5) * spinMax,
    });

    const fl: FlyingLethal = {
      id: String(ball.id ?? Date.now()),
      kind: "flying",
      lethalKind: kind,
      entity: ball,
      fuseRemaining: s.fuse,
      blastRadius: s.radius,
      damageMultiplier: s.dmgMul,
      armed: false,
      velocity: vel,
      stuck: false,
      cleanup: () => {
        try { if (ball.isSpawned) ball.despawn(); } catch {}
      },
    };

    this._active.push(fl);
    return { ok: true };
  }

  private _throwC4(world: World, origin: Vector3Like, forward: Vector3Like) {
    const phys = PHYS;
    const dir = { ...forward };
    // Shallow arc — C4 is heavy clay, not a light grenade
    dir.y = (dir.y || 0) + phys.arcUpBias * 0.55;
    const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
    dir.x /= len; dir.y /= len; dir.z /= len;

    const spawnPos: Vector3Like = {
      x: origin.x + dir.x * (phys.spawnForward * 0.7),
      y: origin.y - 0.1,
      z: origin.z + dir.z * (phys.spawnForward * 0.7),
    };

    const speed = SPEC.satchel.throwSpeed;
    const vel: Vector3Like = { x: dir.x * speed, y: dir.y * speed * 0.6, z: dir.z * speed };

    // One-shot stick flag — arms after 300 ms so the brick clears the thrower's collider first.
    // ColliderShape.BALL is used for the physics collider because onCollision fires reliably
    // on BALL in Hytopia. The visual is still the flat C4_BLOCK model — shape only affects physics.
    let hasStuck = false;
    const throwTime = performance.now();

    const root = new Entity({
      name: `c4-${Date.now()}`,
      modelUri: C4_BLOCK,
      modelScale: 0.55,
      rigidBodyOptions: {
        type: RigidBodyType.DYNAMIC,
        linearDamping:  0.4,
        angularDamping: 5.0,
        colliders: [{
          shape: ColliderShape.BALL,
          radius: 0.13,                          // tight sphere around the flat brick visual
          bounciness: SPEC.satchel.bounciness,   // 0.04 — barely bounces
          friction: 0.95,
          onCollision: (other: any, started: boolean) => {
            if (!started || hasStuck) return;
            if ((performance.now() - throwTime) < 300) return; // arm delay
            hasStuck = true;

            // Weld to world at the exact contact point
            try { root.setLinearVelocity({ x: 0, y: 0, z: 0 }); } catch {}
            try { root.setAngularVelocity({ x: 0, y: 0, z: 0 }); } catch {}
            try { root.setType(RigidBodyType.FIXED); } catch {}

            // If it hit a living entity (zombie, player model), ride with it
            if (other && other instanceof Entity && other.isSpawned) {
              try { root.setParent(other); root.setPosition({ x: 0, y: 0.18, z: 0 }); } catch {}
              const rec = this._active.find((a: any) => a.entity?.id === root.id);
              if (rec) (rec as any)._stuckToEntity = other;
            }

            // Mark as landed so the tick() velocity-settling loop exits
            const rec = this._active.find((a: any) => a.entity?.id === root.id);
            if (rec) (rec as any)._landed = true;
          },
        }],
      },
    });
    root.spawn(world, spawnPos);
    root.setLinearVelocity(vel);
    root.setAngularVelocity({
      x: (Math.random() - 0.5) * 3,
      y: (Math.random() - 0.5) * 5,
      z: (Math.random() - 0.5) * 3,
    });

    // Red danger stripe across the top face — classic M112 marking
    const stripe = new Entity({
      name: "c4-stripe",
      modelUri: RED_BLOCK,
      modelScale: 0.58,
      parent: root,
    });
    stripe.spawn(world, { x: 0, y: 0.10, z: 0.0 });

    const c4: C4Charge = {
      id: String(root.id ?? Date.now()),
      kind: "c4",
      lethalKind: "satchel",
      entity: root,
      fuseRemaining: 999,
      blastRadius: SPEC.satchel.radius,
      damageMultiplier: SPEC.satchel.dmgMul,
      armed: true,
      cleanup: () => {
        try { if (stripe.isSpawned) stripe.despawn(); } catch {}
        try { if (root.isSpawned) root.despawn(); } catch {}
      },
    };

    this._active.push(c4 as any);
    return { ok: true };
  }

  private _placeSmine(world: World, pe: any, origin: Vector3Like, forward: Vector3Like) {
    const s = SPEC.smine44;
    const p = pe.position || origin;

    // Plant ~0.9 m in front of the player, flush with the ground
    const fwd = { x: forward.x, y: 0, z: forward.z };
    const flen = Math.hypot(fwd.x, fwd.z) || 1;
    fwd.x /= flen; fwd.z /= flen;

    const x = p.x + fwd.x * 0.95;
    const z = p.z + fwd.z * 0.95;
    // Spawn with model origin (y=0) AT ground level — body is half-buried, prongs stick up
    const groundY = (p.y || 0) - 0.85;

    const visual = new Entity({
      name:      `smine-${Date.now()}`,
      modelUri:  SMINE_MODEL,
      modelScale: 0.75,   // ~40 cm total height: body flush, prongs ~17 cm above ground
      rigidBodyOptions: { type: RigidBodyType.KINEMATIC_POSITION },
    });
    visual.spawn(world, { x, y: groundY, z });

    const sm: Smine = {
      id:              String(visual.id ?? Date.now()),
      kind:            "smine",
      lethalKind:      "smine44",
      entity:          visual,
      fuseRemaining:   999,
      blastRadius:     s.radius,
      damageMultiplier: s.dmgMul,
      armed:           false,
      state:           "arming",
      armT:            s.armSeconds,
      groundY,
      x,
      z,
      cleanup: () => {
        try { if (visual.isSpawned) visual.despawn(); } catch {}
      },
    };

    this._active.push(sm);
    return { ok: true };
  }

  // ── Tickers ─────────────────────────────────────────────────────────────────

  private _tickFlying(l: FlyingLethal, dt: number, world: World, host: any, remaining: any[]) {
    // We now let the real HYTOPIA DYNAMIC rigidbody + world colliders drive the motion.
    // This is the key to getting proper "throw the ball → it hits the floor and bounces" behavior
    // like you had before. We only observe and react (fuse + VFX).

    if (l.stuck) {
      l.fuseRemaining -= dt;
      if (l.fuseRemaining <= 0) {
        this._detonate(l, world, host);
        return;
      }
      this._emitWarningPulseIfNeeded(l, dt, world);
      remaining.push(l);
      return;
    }

    // The entity.position is now the real physics-driven position.
    // We intentionally do NOT call setPosition or manually integrate velocity here anymore.

    // Gentle "come to rest" detection so grenades don't roll forever on flat ground
    try {
      const v = l.entity.linearVelocity || { x: 0, y: 0, z: 0 };
      const speed = Math.hypot(v.x, v.y, v.z);
      if (speed < 0.5 && l.entity.position.y < 1.1) {
        (l as any)._settleTimer = ((l as any)._settleTimer || 0) + dt;
        if ((l as any)._settleTimer > 0.2) {  // freeze quickly — heavy grenade doesn't creep
          l.stuck = true;
          try { l.entity.setLinearVelocity({ x: 0, y: 0, z: 0 }); } catch {}
          try { l.entity.setAngularVelocity({ x: 0, y: 0, z: 0 }); } catch {}
        }
      } else {
        (l as any)._settleTimer = 0; // reset if it picks up speed again (e.g. second bounce)
      }
    } catch {}

    l.fuseRemaining -= dt;
    if (l.fuseRemaining <= 0) {
      this._detonate(l, world, host);
      return;
    }

    this._emitWarningPulseIfNeeded(l, dt, world);
    remaining.push(l);
  }

  private _stickN74stTo(ent: Entity, other: any) {
    // 1. Kill all motion immediately — works for ANY surface (wall, block, ground, prop, zombie)
    try { ent.setLinearVelocity({ x: 0, y: 0, z: 0 }); } catch {}
    try { ent.setAngularVelocity({ x: 0, y: 0, z: 0 }); } catch {}
    try { ent.setType(RigidBodyType.FIXED); } catch {} // weld to world at current position

    // 2. If the surface is a moving Entity (zombie, dog, prop), parent so it rides along with it
    if (other && other instanceof Entity && other.isSpawned) {
      try {
        ent.setParent(other);
        ent.setPosition({ x: 0, y: 0.35, z: 0.18 }); // offset so it shows on the surface, not inside
      } catch {}
    }
    // If other is null / world geometry / a block — FIXED type is enough; it stays glued to that spot.

    // 3. Mark the lethal record as stuck so the fuse countdown begins
    const rec = this._active.find((a: any) => a.entity?.id === ent.id) as FlyingLethal | undefined;
    if (rec && rec.kind === "flying") {
      rec.stuck = true;
      if (other && typeof other === "object" && "position" in other) {
        rec.stuckTo = other;
      }
    }
  }

  private _isPlayer(o: any): boolean {
    return !!(o && (o.name?.includes("Player") || o.tag === "player"));
  }

  private _emitWarningPulseIfNeeded(l: any, dt: number, world: World) {
    const warnT = Math.min(l.fuseRemaining, PHYS.fuseWarningWindow);
    if (l.fuseRemaining < warnT * 1.05) {
      (l as any)._pulseAcc = ((l as any)._pulseAcc || 0) + dt;
      if ((l as any)._pulseAcc > 0.09) {
        (l as any)._pulseAcc = 0;
        const pos = l.entity.position;
        if (pos) VFX.lethalArmingPulse(world, pos, 0.7 + (1 - l.fuseRemaining / warnT) * 0.9);
      }
    }
  }

  private _tickSmine(s: Smine, dt: number, world: World, host: any, zombiePositions: readonly Vector3Like[] | undefined, remaining: any[]) {
    const spec = SPEC.smine44;

    if (s.state === "arming") {
      s.armT -= dt;
      // Subtle slow Y-rotation while arming — prongs spin gently to signal it's priming
      const ang = (performance.now() / 1200) % (Math.PI * 2);
      try {
        s.entity.setRotation({ x: 0, y: Math.sin(ang / 2), z: 0, w: Math.cos(ang / 2) });
      } catch {}

      if (s.armT <= 0) {
        // Lock upright when armed — prongs stand perfectly still, ready to trigger
        try { s.entity.setRotation({ x: 0, y: 0, z: 0, w: 1 }); } catch {}
        s.state = "armed";
        s.armed = true;
      }
      remaining.push(s);
      return;
    }

    if (s.state === "armed") {
      // Proximity check — trigger if ANY enemy zombie walks within triggerR.
      // Never triggered by the player (real S-mine is an anti-personnel mine for enemies).
      let triggered = false;
      if (zombiePositions && zombiePositions.length > 0) {
        for (const zp of zombiePositions) {
          if (Math.hypot(zp.x - s.x, zp.z - s.z) < spec.triggerR) {
            triggered = true;
            break;
          }
        }
      }
      if (triggered) {
        s.state = "popping";
        s.popT = 0;
      }
      remaining.push(s);
      return;
    }

    if (s.state === "popping") {
      s.popT = (s.popT || 0) + dt;
      const prog = Math.min(1, s.popT / spec.popDur);
      // Eased upward arc — fast launch, slows at apex
      const h = spec.popH * Math.sin(prog * Math.PI * 0.5);
      // Very slight tilt during flight (valid quaternion: small tilt around Z)
      const tilt = prog * 0.18;
      try {
        s.entity.setPosition({ x: s.x, y: s.groundY + h, z: s.z });
        s.entity.setRotation({ x: 0, y: 0, z: Math.sin(tilt / 2), w: Math.cos(tilt / 2) });
      } catch {}

      if (s.popT >= spec.popDur) {
        const burstPos = { x: s.x, y: s.groundY + spec.popH, z: s.z };
        this._detonate(s, world, host, burstPos);
        this._spawnSmineShrapnel(world, burstPos, spec);
        return; // not pushed back — it's gone
      }
      remaining.push(s);
    }
  }

  private _spawnSmineShrapnel(world: World, center: Vector3Like, spec: any) {
    const n = spec.shrapnel ?? 14;
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.4;
      const pitch = 0.12 + Math.random() * 0.32;
      const c = Math.cos(pitch);
      const vx = Math.cos(ang) * c * 23;
      const vz = Math.sin(ang) * c * 23;
      const vy = Math.sin(pitch) * 23 + 1.8;

      const sh = new Entity({
        name: `shrap-${i}`,
        modelUri: "models/projectiles/fireball.gltf",
        modelScale: 0.04 + Math.random() * 0.035,
      });
      sh.spawn(world, center);

      // Manual fly + short life
      const life = 0.38 + Math.random() * 0.08;
      const vel = { x: vx, y: vy, z: vz };
      let t = 0;
      const iv = setInterval(() => {
        t += 0.016;
        if (t > life || !sh.isSpawned) {
          clearInterval(iv);
          try { if (sh.isSpawned) sh.despawn(); } catch {}
          return;
        }
        vel.y -= 28 * 0.016;
        try {
          const cp = sh.position;
          sh.setPosition({ x: cp.x + vel.x * 0.016, y: cp.y + vel.y * 0.016, z: cp.z + vel.z * 0.016 });
        } catch {}
      }, 16);

      // Despawn safety
      setTimeout(() => { try { if (sh.isSpawned) sh.despawn(); } catch {} }, 900);
    }
  }

  private _detonate(l: any, world: World, host: any, overridePos?: Vector3Like) {
    // When parented to a moving entity (zombie, player), entity.position is LOCAL.
    // Resolve the correct world-space blast centre from the parent if one exists.
    const stuckTo: Entity | undefined = (l as FlyingLethal).stuckTo ?? l._stuckToEntity;
    const pos: Vector3Like = overridePos
      ?? (stuckTo instanceof Entity && stuckTo.isSpawned ? stuckTo.position : null)
      ?? l.entity.position
      ?? { x: 0, y: 0, z: 0 };

    // Different VFX for big C4
    if (l.lethalKind === "satchel") {
      VFX.c4Detonation(world, pos, false);
    } else {
      VFX.lethalExplosion(world, pos, l.lethalKind === "smine44" ? 0.95 : 1.15);
    }

    // Damage via injected callback (Director owns zombie list + scoring)
    try {
      this._damageFn(world, host, pos, l.blastRadius, l.damageMultiplier);
    } catch (e) {
      console.warn("[LethalSystem] damageFn failed", e);
    }

    // Remove
    try { l.cleanup(); } catch {}
    this._active = this._active.filter((a) => a !== l);
  }

  private _detonateAllC4(world: World, host: any) {
    const toBoom = this._active.filter((a) => a.lethalKind === "satchel");
    if (toBoom.length === 0) return;

    for (const c of toBoom) {
      const p = c.entity.position || { x: 0, y: 0, z: 0 };
      VFX.c4Detonation(world, p, true); // soften multi
      try {
        this._damageFn(world, host, p, c.blastRadius, c.damageMultiplier);
      } catch {}
      try { c.cleanup(); } catch {}
    }
    this._active = this._active.filter((a) => a.lethalKind !== "satchel");
    this._c4HoldSeconds = 0;
    this._c4HoldFired = false;
  }
}
