import * as pc from "playcanvas";
import type { AnimTrack } from "playcanvas";
import { GAME_CONFIG } from "./config";
import type { CollisionWorld } from "./CollisionWorld";

export type ZombieStats = {
  health: number;
  speed: number;
};

/** Loaded glTF: fresh mesh instance + lookup for {@link AnimTrack}s by glTF clip name. */
export type EnemyModelKit = {
  instantiate: () => pc.Entity;
  getAnimTrack: (name: string) => AnimTrack | undefined;
};

let zombieId = 0;

/** Approximate XZ radius for arena collision nudges (humanoid scale). */
const ZOMBIE_RADIUS = 0.5;
const PROC_HEAD_RADIUS = 0.32;

function shortestAngleDeltaDeg(fromDeg: number, toDeg: number): number {
  let d = toDeg - fromDeg;
  d = ((((d + 180) % 360) + 360) % 360) - 180;
  return d;
}

/**
 * Enemy: either Blockbench / Hytopia glTF (`GAME_CONFIG.enemyVisual`) or legacy primitives.
 * glTF path: `AnimComponent` plays walk/run clips from the container asset.
 */
export class Zombie {
  readonly id = zombieId++;
  readonly root = new pc.Entity(`zombie-${this.id}`);
  alive = true;

  private readonly body = new pc.Entity("body");
  private readonly head = new pc.Entity("head");
  private readonly leftArm = new pc.Entity("left-arm");
  private readonly rightArm = new pc.Entity("right-arm");
  private readonly leftEye = new pc.Entity("left-eye");
  private readonly rightEye = new pc.Entity("right-eye");
  private readonly material = new pc.StandardMaterial();
  private readonly headMaterial = new pc.StandardMaterial();
  private readonly armMaterial = new pc.StandardMaterial();
  private readonly eyeMaterial = new pc.StandardMaterial();
  private readonly collision: CollisionWorld | null;
  private readonly maxHealth: number;
  private health: number;
  private readonly speed: number;
  private readonly useGltfModel: boolean;
  private readonly visualModel: pc.Entity | null;
  private readonly flashMaterials: Array<{ mat: pc.StandardMaterial; base: pc.Color }> = [];
  private readonly aimBodyY: number;
  private readonly headTargetY: number;
  private readonly headHitRadius: number;
  private animComponent: pc.AnimComponent | null = null;
  private resolveAnim: ((name: string) => AnimTrack | undefined) | null = null;
  /** "walk" | "run" — which locomotion clip is playing. */
  private locoMode: "walk" | "run" | null = null;
  private attackCooldown = 0;
  private hitFlashTimer = 0;
  private bobOffset = Math.random() * Math.PI * 2;
  private armSwingPhase = Math.random() * Math.PI * 2;
  private moaned = false;
  private spawnAlpha = 0;
  /** Smoothed world yaw (degrees); avoids instant snap toward the player. */
  private smoothYawDeg: number | null = null;
  /** Low-pass filtered chase direction on XZ (updated while moving toward player). */
  private readonly smoothedChaseDir = new pc.Vec3(0, 0, 0);

  constructor(
    position: pc.Vec3,
    stats: ZombieStats,
    collision: CollisionWorld | null = null,
    modelKit: EnemyModelKit | null = null
  ) {
    this.maxHealth = stats.health;
    this.health = stats.health;
    this.speed = stats.speed;
    this.collision = collision;

    const visCfg = GAME_CONFIG.enemyVisual;
    this.aimBodyY = visCfg.aimBodyY;
    this.headTargetY = visCfg.headTargetY;
    this.headHitRadius = visCfg.headRadius;

    let gltfEntity: pc.Entity | null = null;
    if (modelKit && GAME_CONFIG.enemyVisual.useGltf) {
      try {
        gltfEntity = modelKit.instantiate();
      } catch (e) {
        console.warn("[Zombie] glTF instantiate failed, using primitives.", e);
      }
    }
    this.useGltfModel = gltfEntity != null;
    this.visualModel = gltfEntity;

    this.material.diffuse = new pc.Color(0.28, 0.32, 0.22);
    this.material.emissive = new pc.Color(0.04, 0.05, 0.025);
    this.material.update();

    this.headMaterial.diffuse = new pc.Color(0.34, 0.38, 0.26);
    this.headMaterial.emissive = new pc.Color(0.05, 0.07, 0.03);
    this.headMaterial.update();

    this.armMaterial.diffuse = new pc.Color(0.22, 0.24, 0.18);
    this.armMaterial.emissive = new pc.Color(0.025, 0.03, 0.015);
    this.armMaterial.update();

    this.eyeMaterial.diffuse = new pc.Color(0, 0, 0);
    this.eyeMaterial.emissive = new pc.Color(2.2, 0.9, 0.1);
    this.eyeMaterial.useLighting = false;
    this.eyeMaterial.update();

    this.root.setPosition(position);

    if (this.useGltfModel && gltfEntity && modelKit) {
      gltfEntity.name = "enemy-gltf";
      const av = GAME_CONFIG.voxelAvatar;
      const s = av.modelScale;
      gltfEntity.setLocalScale(s, s, s);
      gltfEntity.setLocalPosition(0, av.yOffset, 0);
      gltfEntity.setLocalEulerAngles(0, av.yawOffsetDeg, 0);
      this.root.addChild(gltfEntity);
      this.collectImportedFlashMaterials(gltfEntity);
      this.resolveAnim = modelKit.getAnimTrack.bind(modelKit);
      this.attachGltfLocomotion(gltfEntity, modelKit);
    } else {
      this.body.addComponent("render", { type: "box", material: this.material });
      this.body.setLocalScale(0.86, 1.3, 0.5);
      this.body.setLocalPosition(0, 0.95, 0);

      this.head.addComponent("render", { type: "sphere", material: this.headMaterial });
      this.head.setLocalScale(PROC_HEAD_RADIUS * 2, PROC_HEAD_RADIUS * 2, PROC_HEAD_RADIUS * 2);
      this.head.setLocalPosition(0, 1.95, 0);

      this.leftArm.addComponent("render", { type: "box", material: this.armMaterial });
      this.leftArm.setLocalScale(0.18, 0.72, 0.18);
      this.leftArm.setLocalPosition(-0.5, 1.1, 0.16);
      this.leftArm.setLocalEulerAngles(-72, 0, -10);

      this.rightArm.addComponent("render", { type: "box", material: this.armMaterial });
      this.rightArm.setLocalScale(0.18, 0.72, 0.18);
      this.rightArm.setLocalPosition(0.5, 1.1, 0.16);
      this.rightArm.setLocalEulerAngles(-72, 0, 10);

      this.leftEye.addComponent("render", { type: "sphere", material: this.eyeMaterial });
      this.leftEye.setLocalScale(0.085, 0.085, 0.085);
      this.leftEye.setLocalPosition(-0.12, 1.98, 0.27);

      this.rightEye.addComponent("render", { type: "sphere", material: this.eyeMaterial });
      this.rightEye.setLocalScale(0.085, 0.085, 0.085);
      this.rightEye.setLocalPosition(0.12, 1.98, 0.27);

      this.root.addChild(this.body);
      this.root.addChild(this.head);
      this.root.addChild(this.leftArm);
      this.root.addChild(this.rightArm);
      this.root.addChild(this.leftEye);
      this.root.addChild(this.rightEye);
    }

    this.root.setLocalScale(0, 0, 0);
  }

  private attachGltfLocomotion(visual: pc.Entity, kit: EnemyModelKit): void {
    visual.addComponent("anim");
    this.animComponent = visual.anim ?? null;
    if (!this.animComponent) {
      return;
    }

    const ev = GAME_CONFIG.enemyVisual;
    const walk = kit.getAnimTrack(ev.animWalkName);
    const run = kit.getAnimTrack(ev.animRunName);
    const fallback = kit.getAnimTrack(ev.animFallbackName);
    const track = walk ?? run ?? fallback;
    if (!track) {
      console.warn("[Zombie] No glTF clips matched animWalkName / animRunName / animFallbackName.");
      return;
    }

    this.animComponent.activate = true;
    this.animComponent.playing = true;
    this.animComponent.assignAnimation("Locomotion", track, undefined, 1, true);
    this.locoMode = walk ? "walk" : run ? "run" : "walk";
  }

  private collectImportedFlashMaterials(root: pc.Entity): void {
    const renders = root.findComponents("render") as pc.RenderComponent[];
    for (const r of renders) {
      const list = r.meshInstances;
      for (let i = 0; i < list.length; i++) {
        const mat = list[i].material;
        if (mat instanceof pc.StandardMaterial) {
          this.flashMaterials.push({ mat, base: mat.emissive.clone() });
        }
      }
    }
  }

  getPosition(): pc.Vec3 {
    return this.root.getPosition();
  }

  getAimTarget(): pc.Vec3 {
    return this.root.getPosition().clone().add(new pc.Vec3(0, this.aimBodyY, 0));
  }

  getHeadTarget(): pc.Vec3 {
    return this.root.getPosition().clone().add(new pc.Vec3(0, this.headTargetY, 0));
  }

  getHeadRadius(): number {
    return this.headHitRadius;
  }

  getHitRadius(): number {
    return GAME_CONFIG.weapon.hitRadius;
  }

  getHealthRatio(): number {
    return this.health / this.maxHealth;
  }

  shouldMoan(): boolean {
    if (this.moaned) return false;
    if (Math.random() > 0.012) return false;
    this.moaned = true;
    window.setTimeout(() => {
      this.moaned = false;
    }, 1200 + Math.random() * 1200);
    return true;
  }

  private setEmissiveDamage(active: boolean): void {
    if (this.useGltfModel) {
      for (const { mat, base } of this.flashMaterials) {
        mat.emissive = active ? new pc.Color(0.75, 0.07, 0.07) : base.clone();
        mat.update();
      }
      return;
    }
    if (active) {
      this.material.emissive = new pc.Color(0.6, 0.05, 0.05);
      this.headMaterial.emissive = new pc.Color(0.78, 0.08, 0.08);
    } else {
      this.material.emissive = new pc.Color(0.04, 0.05, 0.025);
      this.headMaterial.emissive = new pc.Color(0.05, 0.07, 0.03);
    }
    this.material.update();
    this.headMaterial.update();
  }

  private updateGltfLocomotion(chasing: boolean): void {
    if (!this.animComponent || !this.resolveAnim) {
      return;
    }
    const ev = GAME_CONFIG.enemyVisual;
    const runTrack = this.resolveAnim(ev.animRunName);
    const wantRun = chasing && this.speed >= ev.animRunMinSpeed && !!runTrack;
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
    const mul = chasing
      ? pc.math.clamp(this.speed / ref, ev.animSpeedMin, ev.animSpeedMax)
      : ev.animIdleShuffle;
    this.animComponent.speed = mul * ev.animBaseSpeed;
  }

  update(
    dt: number,
    playerPosition: pc.Vec3,
    zombies: Zombie[],
    onPlayerHit: (damage: number, sourcePosition: pc.Vec3) => void,
    frozen = false
  ): void {
    if (!this.alive) {
      return;
    }

    if (this.spawnAlpha < 1) {
      this.spawnAlpha = Math.min(1, this.spawnAlpha + dt * 1.6);
      const s = this.spawnAlpha;
      this.root.setLocalScale(s, s, s);
    }

    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.hitFlashTimer = Math.max(0, this.hitFlashTimer - dt);

    if (frozen) {
      if (this.animComponent) {
        this.animComponent.speed = 0;
      }
      this.setEmissiveDamage(this.hitFlashTimer > 0);
      return;
    }

    this.bobOffset += dt * 4.6;
    this.armSwingPhase += dt * 6;

    const position = this.root.getPosition().clone();
    const toPlayer = playerPosition.clone().sub(position);
    const flatToPlayer = new pc.Vec3(toPlayer.x, 0, toPlayer.z);
    const distance = flatToPlayer.length();

    if (distance > 0.001) {
      flatToPlayer.normalize();
    }

    if (distance <= GAME_CONFIG.zombie.attackRange) {
      if (this.attackCooldown <= 0) {
        this.attackCooldown = GAME_CONFIG.zombie.attackCooldownSeconds;
        onPlayerHit(GAME_CONFIG.zombie.attackDamage, position);
      }
    } else {
      const separation = new pc.Vec3();

      for (const other of zombies) {
        if (!other.alive || other.id === this.id) continue;
        const away = position.clone().sub(other.getPosition());
        const gap = away.length();
        if (gap > 0 && gap < 1.25) {
          away.normalize().mulScalar((1.25 - gap) * 0.85);
          separation.add(away);
        }
      }

      const blended = flatToPlayer.clone().add(separation.clone().mulScalar(0.55));
      if (blended.length() > 0.0001) {
        blended.normalize();
        const hz = GAME_CONFIG.zombie.trackDirectionSmoothHz;
        const alpha = 1 - Math.exp(-hz * dt);
        if (this.smoothedChaseDir.lengthSq() < 1e-12) {
          this.smoothedChaseDir.copy(blended);
        } else {
          this.smoothedChaseDir.lerp(this.smoothedChaseDir, blended, alpha);
          if (this.smoothedChaseDir.lengthSq() > 1e-12) {
            this.smoothedChaseDir.normalize();
          }
        }
        position.add(this.smoothedChaseDir.clone().mulScalar(this.speed * dt));
        if (this.collision) {
          this.collision.resolveZombiePosition(position, ZOMBIE_RADIUS);
        }
        this.root.setPosition(position);
      }
    }

    const heading = Math.atan2(playerPosition.x - position.x, playerPosition.z - position.z);
    const targetYawDeg = 180 - heading * pc.math.RAD_TO_DEG;
    const turnRate = GAME_CONFIG.zombie.trackYawDegPerSecond;
    if (this.smoothYawDeg == null) {
      this.smoothYawDeg = targetYawDeg;
    } else {
      const delta = shortestAngleDeltaDeg(this.smoothYawDeg, targetYawDeg);
      const maxStep = turnRate * dt;
      this.smoothYawDeg += pc.math.clamp(delta, -maxStep, maxStep);
    }
    this.root.setEulerAngles(0, this.smoothYawDeg, 0);

    const bobY = Math.sin(this.bobOffset) * 0.06;
    const lurch = Math.sin(this.bobOffset * 0.5) * 0.05;

    if (this.useGltfModel && this.visualModel) {
      const yBase = GAME_CONFIG.voxelAvatar.yOffset;
      this.visualModel.setLocalPosition(0, yBase + bobY * 0.06, lurch * 0.02);
      const chasing = distance > GAME_CONFIG.zombie.attackRange;
      this.updateGltfLocomotion(chasing);
    } else {
      this.body.setLocalPosition(lurch * 0.4, 0.95 + bobY, 0);
      this.head.setLocalPosition(Math.sin(this.bobOffset * 0.6) * 0.04, 1.95 + bobY, 0);

      const swingLeft = Math.sin(this.armSwingPhase) * 8;
      const swingRight = Math.sin(this.armSwingPhase + Math.PI) * 8;
      this.leftArm.setLocalEulerAngles(-72 + swingLeft, 0, -10);
      this.rightArm.setLocalEulerAngles(-72 + swingRight, 0, 10);
    }

    this.setEmissiveDamage(this.hitFlashTimer > 0);
  }

  applyDamage(amount: number): boolean {
    if (!this.alive) {
      return false;
    }

    this.health -= amount;
    this.hitFlashTimer = 0.1;

    if (this.health > 0) {
      return false;
    }

    this.alive = false;
    this.root.destroy();
    return true;
  }
}