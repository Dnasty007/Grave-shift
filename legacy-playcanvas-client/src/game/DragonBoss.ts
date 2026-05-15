/**
 * DragonBoss — Skyrim-style Ice Dragon encounter.
 *
 * State machine:
 *   descend  → Spawns at Y+22, flies down in a sweeping arc; plays "fly" / "flyidle" anim
 *   land     → Near ground; landing impact + brief idle pose; screen-shake callback fired
 *   ground   → Chases player on XZ; head bone tracks player continuously; uses Claw / Stomp /
 *              IceBreath attacks at individual cooldowns; after groundTimeLimit → liftoff
 *   liftoff  → Rises skyward while "fly" anim plays; after reaching target altitude → fly
 *   fly      → Orbits arena at ~18 m altitude; drops ice bombs toward player; head tracking
 *              disabled so the dragon banks naturally; after flyDuration → descend
 *
 * Public interface mirrors Zombie so DragonBoss can live in the zombies[] array and benefit
 * from PlayerController hit detection and GameApp kill/reward/tracking logic.
 */

import * as pc from "playcanvas";
import type { AnimTrack } from "playcanvas";
import { GAME_CONFIG } from "./config";
import type { Zombie } from "./Zombie";
import type { EnemyModelKit } from "./Zombie";

/* ── Tunables ─────────────────────────────────────────────────────────────── */

const DESCEND_START_Y      = 22;   // world Y to spawn at
const DESCEND_SPEED        = 5.5;  // m/s downward
const DESCEND_ORBIT_SPEED  = 1.2;  // rad/s XZ orbit while descending
const DESCEND_RADIUS       = 10;   // XZ orbital radius while descending

const LAND_DURATION        = 1.1;  // seconds in landing pose before entering ground state
const GROUND_TIME_LIMIT    = 28;   // seconds on ground before lifting off again

const FLY_ALTITUDE         = 18;   // target Y during fly phase
const FLY_ORBIT_SPEED      = 0.55; // rad/s orbit around player
const FLY_ORBIT_RADIUS     = 14;   // XZ orbit radius while flying
const FLY_DURATION         = 12;   // seconds airborne before descending again
const FLY_BOMB_INTERVAL    = 2.8;  // seconds between ice-bomb bursts while flying

const CHASE_SPEED          = 3.8;  // m/s ground chase
const HEAD_TRACK_LERP      = 5.0;  // slerp speed for head bone tracking

const ATTACK_CLAW_RANGE    = 10;   // m
const ATTACK_BREATH_RANGE  = 15;   // m
const ATTACK_CLAW_CD       = 3.8;  // s
const ATTACK_STOMP_CD      = 6.0;  // s
const ATTACK_BREATH_CD     = 9.0;  // s
const ATTACK_CLAW_DAMAGE   = GAME_CONFIG.bossWave.attackDamage;
const ATTACK_BREATH_DAMAGE = GAME_CONFIG.bossWave.attackDamage * 0.6;
const FLY_BOMB_DAMAGE      = GAME_CONFIG.bossWave.attackDamage * 1.4;
const FLY_BOMB_RADIUS      = 5;    // m ground-hit radius for ice bombs

const HIT_FLASH_DURATION   = 0.12;
const HEAD_BONE_NAMES      = ["head", "Head", "Bone_Head", "neck", "Neck"];

/** Dragon GLTF clip names (from the IceDragonSkills.yml state references). */
const ANIM_FLY      = "fly";
const ANIM_FLY_IDLE = "flyidle";
const ANIM_WALK     = "walk";
const ANIM_IDLE     = "idle";
const ANIM_ATTACK2  = "attack2";   // stomp / IceDragonAttack3
const ANIM_ATTACK3  = "attack3";   // claw / Claw
const ANIM_ATTACKE  = "attacke";   // ice breath / IceDragonFire2

type DragonState = "descend" | "land" | "ground" | "liftoff" | "fly";
type OnPlayerHit = (damage: number, sourcePosition: pc.Vec3) => void;
type OnLand      = () => void;
type OnIceBomb   = (pos: pc.Vec3) => void;

let dragonId = 0;

export class DragonBoss {
  readonly id = dragonId++;
  readonly root = new pc.Entity(`dragon-${this.id}`);
  alive = true;

  private maxHealth: number;
  private health: number;

  /* state machine */
  private state: DragonState = "descend";
  private stateTimer   = 0;
  private orbitAngle   = 0;
  private spawnXZ      = new pc.Vec3();

  /* attack cooldowns */
  private clawCooldown    = 1.0;
  private stompCooldown   = ATTACK_STOMP_CD * 0.5;
  private breathCooldown  = ATTACK_BREATH_CD;
  private flyBombTimer    = 0;

  /* active animation layer name + current clip */
  private readonly ANIM_LAYER = "Dragon";
  private currentClip: string | null = null;

  /* visual */
  private readonly visualModel: pc.Entity | null = null;
  private animComponent: pc.AnimComponent | null = null;
  private resolveAnim: ((name: string) => AnimTrack | undefined) | null = null;
  private headBone: pc.Entity | null = null;
  private hitFlashTimer = 0;
  private readonly flashMaterials: Array<{ mat: pc.StandardMaterial; base: pc.Color }> = [];

  /* scratch */
  private readonly faceQuat = new pc.Quat();

  /* callbacks */
  private readonly onLand:    OnLand;
  private readonly onIceBomb: OnIceBomb;

  /* config shortcuts */
  private readonly aimBodyY   = GAME_CONFIG.bossWave.aimBodyY;
  private readonly headY      = GAME_CONFIG.bossWave.headTargetY;
  private readonly headRadius = GAME_CONFIG.bossWave.headRadius;

  constructor(
    spawnPosition: pc.Vec3,
    health: number,
    modelKit: EnemyModelKit | null,
    onLand: OnLand,
    onIceBomb: OnIceBomb
  ) {
    this.maxHealth = health;
    this.health    = health;
    this.onLand    = onLand;
    this.onIceBomb = onIceBomb;

    /* landing XZ target */
    this.spawnXZ.set(spawnPosition.x, 0, spawnPosition.z);

    /* start position — high up, orbiting the spawn point */
    const startAngle = Math.random() * Math.PI * 2;
    this.orbitAngle = startAngle;
    const sx = spawnPosition.x + Math.cos(startAngle) * DESCEND_RADIUS;
    const sz = spawnPosition.z + Math.sin(startAngle) * DESCEND_RADIUS;
    this.root.setPosition(sx, DESCEND_START_Y, sz);

    /* scale */
    const s = GAME_CONFIG.bossWave.modelScaleMultiplier;
    this.root.setLocalScale(s, s, s);

    /* load visual */
    if (modelKit) {
      try {
        const visual = modelKit.instantiate();
        this.visualModel = visual;
        this.root.addChild(visual);

        /* attach anim component — same pattern as Zombie.attachGltfLocomotion */
        visual.addComponent("anim");
        const anim = visual.anim ?? null;
        if (anim) {
          this.animComponent = anim;
          this.resolveAnim   = modelKit.getAnimTrack.bind(modelKit);
          anim.activate  = true;
          anim.playing   = true;
          /* Start with fly clip */
          this.assignClip(ANIM_FLY, true);
        }

        /* collect flash materials */
        this.collectFlashMaterials(visual);

        /* find head bone */
        for (const name of HEAD_BONE_NAMES) {
          const bone = visual.findByName(name);
          if (bone) { this.headBone = bone as pc.Entity; break; }
        }
      } catch (e) {
        console.warn("[DragonBoss] visual instantiate error:", e);
      }
    }
  }

  /* ── Zombie-compatible interface ─────────────────────────────────────────── */

  getPosition(): pc.Vec3 {
    return this.root.getPosition();
  }

  getAimTarget(): pc.Vec3 {
    const pos = this.root.getPosition();
    return new pc.Vec3(pos.x, pos.y + this.aimBodyY, pos.z);
  }

  getHeadTarget(): pc.Vec3 {
    const pos = this.root.getPosition();
    return new pc.Vec3(pos.x, pos.y + this.headY, pos.z);
  }

  getHeadRadius(): number { return this.headRadius; }
  getHitRadius():  number { return GAME_CONFIG.bossWave.collisionRadius; }

  get healthFraction(): number { return this.health / this.maxHealth; }

  /** Returns true if the hit killed the dragon. */
  applyDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.health       -= amount;
    this.hitFlashTimer = HIT_FLASH_DURATION;
    if (this.health <= 0) {
      this.health = 0;
      this.die();
      return true;
    }
    return false;
  }

  /** Compat stub — dragons don't moan. */
  shouldMoan(): boolean { return false; }

  /* ── Main update ─────────────────────────────────────────────────────────── */

  update(
    dt: number,
    playerPosition: pc.Vec3,
    _zombies: Zombie[],
    onPlayerHit: OnPlayerHit,
    frozen = false
  ): void {
    if (!this.alive) return;

    this.stateTimer    += dt;
    this.hitFlashTimer  = Math.max(0, this.hitFlashTimer - dt);
    this.clawCooldown   = Math.max(0, this.clawCooldown  - dt);
    this.stompCooldown  = Math.max(0, this.stompCooldown - dt);
    this.breathCooldown = Math.max(0, this.breathCooldown - dt);
    this.flyBombTimer   = Math.max(0, this.flyBombTimer  - dt);

    this.updateHitFlash();
    if (frozen) return;

    switch (this.state) {
      case "descend": this.tickDescend(dt, playerPosition); break;
      case "land":    this.tickLand(dt, playerPosition); break;
      case "ground":  this.tickGround(dt, playerPosition, onPlayerHit); break;
      case "liftoff": this.tickLiftoff(dt, playerPosition); break;
      case "fly":     this.tickFly(dt, playerPosition, onPlayerHit); break;
    }
  }

  /* ── DESCEND ─────────────────────────────────────────────────────────────── */

  private tickDescend(dt: number, _p: pc.Vec3): void {
    this.orbitAngle += DESCEND_ORBIT_SPEED * dt;
    const pos = this.root.getPosition();
    const tx  = this.spawnXZ.x + Math.cos(this.orbitAngle) * DESCEND_RADIUS;
    const tz  = this.spawnXZ.z + Math.sin(this.orbitAngle) * DESCEND_RADIUS;
    const ny  = pos.y - DESCEND_SPEED * dt;
    this.root.setPosition(tx, ny, tz);
    /* face direction of travel */
    const vx = -Math.sin(this.orbitAngle);
    const vz =  Math.cos(this.orbitAngle);
    this.faceQuat.setFromDirections(pc.Vec3.FORWARD, new pc.Vec3(vx, 0, vz));
    this.root.setLocalRotation(this.faceQuat);

    if (ny <= 1.2) {
      this.root.setPosition(this.spawnXZ.x, 0, this.spawnXZ.z);
      this.enterLand();
    }
  }

  /* ── LAND ────────────────────────────────────────────────────────────────── */

  private enterLand(): void {
    this.state = "land"; this.stateTimer = 0;
    this.assignClip(ANIM_IDLE, false);
    this.onLand();
  }

  private tickLand(_dt: number, playerPos: pc.Vec3): void {
    this.facePlayer(playerPos);
    if (this.stateTimer >= LAND_DURATION) this.enterGround();
  }

  /* ── GROUND ──────────────────────────────────────────────────────────────── */

  private enterGround(): void {
    this.state = "ground"; this.stateTimer = 0;
    this.assignClip(ANIM_WALK, true);
  }

  private tickGround(dt: number, playerPos: pc.Vec3, onHit: OnPlayerHit): void {
    const pos    = this.root.getPosition();
    const dx     = playerPos.x - pos.x;
    const dz     = playerPos.z - pos.z;
    const distXZ = Math.sqrt(dx * dx + dz * dz);

    /* chase */
    if (distXZ > GAME_CONFIG.bossWave.attackRange) {
      const inv  = 1 / (distXZ + 1e-6);
      const move = CHASE_SPEED * dt;
      this.root.setPosition(pos.x + dx * inv * move, 0, pos.z + dz * inv * move);
    }

    this.facePlayer(playerPos);
    this.trackHeadToPlayer(playerPos, dt);

    /* attacks */
    if (distXZ <= ATTACK_CLAW_RANGE) {
      if (this.clawCooldown <= 0) {
        this.doClaw(pos.clone(), playerPos, onHit);
      } else if (this.stompCooldown <= 0) {
        this.doStomp(pos.clone(), playerPos, onHit);
      }
    }
    if (distXZ <= ATTACK_BREATH_RANGE && this.breathCooldown <= 0) {
      this.doBreath(pos.clone(), playerPos, onHit);
    }

    if (this.stateTimer >= GROUND_TIME_LIMIT) this.enterLiftoff();
  }

  /* ── Ground attacks ─────────────────────────────────────────────────────── */

  private doClaw(bossPos: pc.Vec3, playerPos: pc.Vec3, onHit: OnPlayerHit): void {
    this.clawCooldown = ATTACK_CLAW_CD;
    this.assignClip(ANIM_ATTACK3, false);
    setTimeout(() => {
      if (!this.alive) return;
      const dx = playerPos.x - bossPos.x;
      const dz = playerPos.z - bossPos.z;
      if (Math.sqrt(dx * dx + dz * dz) <= ATTACK_CLAW_RANGE + 2) {
        onHit(ATTACK_CLAW_DAMAGE, bossPos);
      }
      if (this.state === "ground") this.assignClip(ANIM_WALK, true);
    }, 650);
  }

  private doStomp(bossPos: pc.Vec3, playerPos: pc.Vec3, onHit: OnPlayerHit): void {
    this.stompCooldown = ATTACK_STOMP_CD;
    this.assignClip(ANIM_ATTACK2, false);
    setTimeout(() => {
      if (!this.alive) return;
      const dx = playerPos.x - bossPos.x;
      const dz = playerPos.z - bossPos.z;
      if (Math.sqrt(dx * dx + dz * dz) <= ATTACK_CLAW_RANGE + 3) {
        onHit(ATTACK_CLAW_DAMAGE * 1.15, bossPos);
      }
      if (this.state === "ground") this.assignClip(ANIM_WALK, true);
    }, 700);
  }

  private doBreath(bossPos: pc.Vec3, playerPos: pc.Vec3, onHit: OnPlayerHit): void {
    this.breathCooldown = ATTACK_BREATH_CD;
    this.assignClip(ANIM_ATTACKE, false);
    for (let i = 0; i < 3; i++) {
      setTimeout(() => {
        if (!this.alive) return;
        const dx = playerPos.x - bossPos.x;
        const dz = playerPos.z - bossPos.z;
        if (Math.sqrt(dx * dx + dz * dz) <= ATTACK_BREATH_RANGE + 2) {
          onHit(ATTACK_BREATH_DAMAGE, bossPos);
        }
      }, 400 + i * 500);
    }
    setTimeout(() => {
      if (this.state === "ground") this.assignClip(ANIM_WALK, true);
    }, 2200);
  }

  /* ── LIFTOFF ─────────────────────────────────────────────────────────────── */

  private enterLiftoff(): void {
    this.state = "liftoff"; this.stateTimer = 0;
    this.assignClip(ANIM_FLY, true);
    const pos = this.root.getPosition();
    this.orbitAngle = Math.atan2(pos.z - this.spawnXZ.z, pos.x - this.spawnXZ.x);
  }

  private tickLiftoff(dt: number, playerPos: pc.Vec3): void {
    const pos = this.root.getPosition();
    this.root.setPosition(pos.x, pos.y + DESCEND_SPEED * dt, pos.z);
    if (pos.y >= FLY_ALTITUDE) this.enterFly(playerPos);
  }

  /* ── FLY ─────────────────────────────────────────────────────────────────── */

  private enterFly(playerPos: pc.Vec3): void {
    this.state = "fly"; this.stateTimer = 0;
    this.flyBombTimer = FLY_BOMB_INTERVAL * 0.4;
    this.assignClip(ANIM_FLY_IDLE, true);
    const pos = this.root.getPosition();
    this.orbitAngle = Math.atan2(pos.z - playerPos.z, pos.x - playerPos.x);
  }

  private tickFly(dt: number, playerPos: pc.Vec3, onHit: OnPlayerHit): void {
    this.orbitAngle += FLY_ORBIT_SPEED * dt;
    const cx = playerPos.x + Math.cos(this.orbitAngle) * FLY_ORBIT_RADIUS;
    const cz = playerPos.z + Math.sin(this.orbitAngle) * FLY_ORBIT_RADIUS;
    const pos = this.root.getPosition();
    const ny  = pos.y + (FLY_ALTITUDE - pos.y) * Math.min(1, dt * 2.5);
    this.root.setPosition(cx, ny, cz);

    /* face direction of travel */
    const vx = -Math.sin(this.orbitAngle);
    const vz =  Math.cos(this.orbitAngle);
    this.faceQuat.setFromDirections(pc.Vec3.FORWARD, new pc.Vec3(vx, 0, vz));
    this.root.setLocalRotation(this.faceQuat);

    /* ice bombs */
    if (this.flyBombTimer <= 0) {
      this.flyBombTimer = FLY_BOMB_INTERVAL;
      this.dropIceBomb(playerPos, onHit);
    }

    if (this.stateTimer >= FLY_DURATION) this.enterDescend(playerPos);
  }

  private dropIceBomb(playerPos: pc.Vec3, onHit: OnPlayerHit): void {
    const scatter = 3;
    const bx = playerPos.x + (Math.random() - 0.5) * scatter;
    const bz = playerPos.z + (Math.random() - 0.5) * scatter;
    const bombPos = new pc.Vec3(bx, 0, bz);
    this.onIceBomb(bombPos);
    setTimeout(() => {
      if (!this.alive) return;
      const dx = playerPos.x - bx;
      const dz = playerPos.z - bz;
      if (Math.sqrt(dx * dx + dz * dz) <= FLY_BOMB_RADIUS) {
        onHit(FLY_BOMB_DAMAGE, bombPos);
      }
    }, 600);
  }

  private enterDescend(playerPos: pc.Vec3): void {
    this.state = "descend"; this.stateTimer = 0;
    const angle = Math.random() * Math.PI * 2;
    const dist  = 8 + Math.random() * 6;
    this.spawnXZ.set(
      playerPos.x + Math.cos(angle) * dist,
      0,
      playerPos.z + Math.sin(angle) * dist
    );
    const pos = this.root.getPosition();
    this.orbitAngle = Math.atan2(pos.z - this.spawnXZ.z, pos.x - this.spawnXZ.x);
    this.assignClip(ANIM_FLY, true);
  }

  /* ── Helpers ─────────────────────────────────────────────────────────────── */

  private facePlayer(playerPos: pc.Vec3): void {
    const pos = this.root.getPosition();
    const dx  = playerPos.x - pos.x;
    const dz  = playerPos.z - pos.z;
    if (Math.abs(dx) + Math.abs(dz) < 1e-6) return;
    this.faceQuat.setFromDirections(pc.Vec3.FORWARD, new pc.Vec3(dx, 0, dz).normalize());
    this.root.setLocalRotation(this.faceQuat);
  }

  private trackHeadToPlayer(playerPos: pc.Vec3, dt: number): void {
    if (!this.headBone) return;
    const hpos = this.headBone.getPosition();
    const dx   = playerPos.x - hpos.x;
    const dy   = playerPos.y - hpos.y;
    const dz   = playerPos.z - hpos.z;
    const len  = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.01) return;
    const dir = new pc.Vec3(dx / len, dy / len, dz / len);
    const targetQ  = new pc.Quat().setFromDirections(pc.Vec3.FORWARD, dir);
    const currentQ = this.headBone.getLocalRotation().clone();
    currentQ.slerp(currentQ, targetQ, Math.min(1, HEAD_TRACK_LERP * dt));
    this.headBone.setLocalRotation(currentQ);
  }

  /**
   * Swap the current animation clip on the "Dragon" layer.
   * Mirrors the Zombie pattern: `assignAnimation(layer, track, blendType, speed, loop)`.
   */
  private assignClip(clipName: string, loop: boolean): void {
    if (!this.animComponent || !this.resolveAnim) return;
    if (this.currentClip === clipName) return; // already playing
    const track = this.resolveAnim(clipName);
    if (!track) {
      console.warn(`[DragonBoss] No anim track for clip "${clipName}"`);
      return;
    }
    try {
      this.animComponent.assignAnimation(this.ANIM_LAYER, track, undefined, 1, loop);
      this.currentClip = clipName;
    } catch (e) {
      console.warn(`[DragonBoss] assignAnimation "${clipName}" failed:`, e);
    }
  }

  private collectFlashMaterials(visual: pc.Entity): void {
    const renders = visual.findComponents("render") as pc.RenderComponent[];
    for (const r of renders) {
      for (const mi of r.meshInstances) {
        if (mi.material instanceof pc.StandardMaterial) {
          this.flashMaterials.push({ mat: mi.material, base: mi.material.emissive.clone() });
        }
      }
    }
  }

  private updateHitFlash(): void {
    const flash = this.hitFlashTimer > 0;
    const red   = new pc.Color(1, 0.2, 0.2);
    for (const { mat, base } of this.flashMaterials) {
      mat.emissive.copy(flash ? red : base);
      mat.update();
    }
  }

  private die(): void {
    this.alive = false;
    /* Sink below ground — GameApp destroys the entity once alive === false */
    const pos = this.root.getPosition();
    this.root.setPosition(pos.x, -1000, pos.z);
  }
}
