import * as pc from "playcanvas";
import { GAME_CONFIG } from "./config";
import type { CollisionWorld } from "./CollisionWorld";

export type ZombieStats = {
  health: number;
  speed: number;
};

let zombieId = 0;

const HEAD_RADIUS = 0.32;
const ZOMBIE_RADIUS = 0.5;

/**
 * One enemy actor: procedurally scaled box/capsule mesh, simple seek + melee vs player.
 * `CollisionWorld` nudges XZ out of arena props; Y comes from GameApp open-world snaps.
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
  private attackCooldown = 0;
  private hitFlashTimer = 0;
  private bobOffset = Math.random() * Math.PI * 2;
  private armSwingPhase = Math.random() * Math.PI * 2;
  private moaned = false;
  private spawnAlpha = 0;

  // --- Visual assembly + materials (PlayCanvas primitives) ---

  constructor(position: pc.Vec3, stats: ZombieStats, collision: CollisionWorld | null = null) {
    this.maxHealth = stats.health;
    this.health = stats.health;
    this.speed = stats.speed;
    this.collision = collision;

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

    this.body.addComponent("render", { type: "box", material: this.material });
    this.body.setLocalScale(0.86, 1.3, 0.5);
    this.body.setLocalPosition(0, 0.95, 0);

    this.head.addComponent("render", { type: "sphere", material: this.headMaterial });
    this.head.setLocalScale(HEAD_RADIUS * 2, HEAD_RADIUS * 2, HEAD_RADIUS * 2);
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

    this.root.setLocalScale(0, 0, 0);
  }

  getPosition(): pc.Vec3 {
    return this.root.getPosition();
  }

  getAimTarget(): pc.Vec3 {
    return this.root.getPosition().clone().add(new pc.Vec3(0, 1.0, 0));
  }

  getHeadTarget(): pc.Vec3 {
    return this.root.getPosition().clone().add(new pc.Vec3(0, 1.95, 0));
  }

  getHeadRadius(): number {
    return HEAD_RADIUS;
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

  // --- AI tick: spawn scale-in, chase player XZ, attack cadence, bob animation ---

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
      if (this.hitFlashTimer > 0) {
        this.material.emissive = new pc.Color(0.6, 0.05, 0.05);
        this.headMaterial.emissive = new pc.Color(0.78, 0.08, 0.08);
      } else {
        this.material.emissive = new pc.Color(0.04, 0.05, 0.025);
        this.headMaterial.emissive = new pc.Color(0.05, 0.07, 0.03);
      }
      this.material.update();
      this.headMaterial.update();
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

      const moveDirection = flatToPlayer.add(separation.mulScalar(0.55));
      if (moveDirection.length() > 0.0001) {
        moveDirection.normalize().mulScalar(this.speed * dt);
        position.add(moveDirection);
        if (this.collision) {
          this.collision.resolveZombiePosition(position, ZOMBIE_RADIUS);
        }
        this.root.setPosition(position);
      }
    }

    const heading = Math.atan2(playerPosition.x - position.x, playerPosition.z - position.z);
    this.root.setEulerAngles(0, 180 - heading * pc.math.RAD_TO_DEG, 0);

    const bobY = Math.sin(this.bobOffset) * 0.06;
    const lurch = Math.sin(this.bobOffset * 0.5) * 0.05;
    this.body.setLocalPosition(lurch * 0.4, 0.95 + bobY, 0);
    this.head.setLocalPosition(Math.sin(this.bobOffset * 0.6) * 0.04, 1.95 + bobY, 0);

    const swingLeft = Math.sin(this.armSwingPhase) * 8;
    const swingRight = Math.sin(this.armSwingPhase + Math.PI) * 8;
    this.leftArm.setLocalEulerAngles(-72 + swingLeft, 0, -10);
    this.rightArm.setLocalEulerAngles(-72 + swingRight, 0, 10);

    if (this.hitFlashTimer > 0) {
      this.material.emissive = new pc.Color(0.6, 0.05, 0.05);
      this.headMaterial.emissive = new pc.Color(0.78, 0.08, 0.08);
    } else {
      this.material.emissive = new pc.Color(0.04, 0.05, 0.025);
      this.headMaterial.emissive = new pc.Color(0.05, 0.07, 0.03);
    }

    this.material.update();
    this.headMaterial.update();
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
