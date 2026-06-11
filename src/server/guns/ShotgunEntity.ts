import { Quaternion, PlayerEntity, type Vector3Like, type QuaternionLike } from "hytopia";
import GunEntity, { type GunEntityOptions } from "./GunEntity";

/** Official zombies-fps Shotgun — 7-pellet spread, pump action. */
export default class ShotgunEntity extends GunEntity {
  public constructor(options: Partial<GunEntityOptions> = {}) {
    super({
      ammo: options.ammo ?? 3,
      damage: options.damage ?? 40,            // official 4/pellet ×10 for our zombie HP curve
      fireRate: options.fireRate ?? 1.3,
      hand: options.hand ?? "right",
      iconImageUri: options.iconImageUri ?? "icons/shotgun.png",
      idleAnimation: options.idleAnimation ?? "idle_gun_both",
      name: options.name ?? "Shotgun",
      maxAmmo: options.maxAmmo ?? 3,
      modelUri: options.modelUri ?? "models/items/shotgun.glb",
      modelScale: options.modelScale ?? 1.2,
      parent: options.parent,
      range: options.range ?? 8,
      reloadAudioUri: options.reloadAudioUri ?? "audio/sfx/shotgun-reload.mp3",
      reloadTimeMs: options.reloadTimeMs ?? 1000,
      reserveAmmo: options.reserveAmmo ?? 30,
      shootAnimation: options.shootAnimation ?? "shoot_gun_both",
      shootAudioUri: options.shootAudioUri ?? "audio/sfx/shotgun-shoot.mp3",
      onShoot: options.onShoot,
      onHit: options.onHit,
      onAmmoChanged: options.onAmmoChanged,
    });
  }

  public override shoot(): void {
    if (!this.parent || !this.processShoot()) return;

    const parentPlayerEntity = this.parent as PlayerEntity;
    if (!parentPlayerEntity.world) return;

    super.shoot();

    // Pump action: fresh click per shell (official).
    parentPlayerEntity.player.input.ml = false;
  }

  public override getMuzzleFlashPositionRotation(): { position: Vector3Like; rotation: QuaternionLike } {
    return {
      position: { x: 0.03, y: 0.1, z: -1.5 },
      rotation: Quaternion.fromEuler(0, 90, 0),
    };
  }

  /** 7-pellet spread pattern (official). Each pellet is its own raycast. */
  public override shootRaycast(origin: Vector3Like, direction: Vector3Like, length: number): void {
    const spreadAngles = [
      { x: 0, y: 0 },          // Center
      { x: 0.035, y: 0.035 },  // Upper right
      { x: -0.035, y: 0.035 }, // Upper left
      { x: 0.05, y: 0 },       // Right
      { x: -0.05, y: 0 },      // Left
      { x: 0.035, y: -0.035 }, // Lower right
      { x: -0.035, y: -0.035 } // Lower left
    ];

    for (const angle of spreadAngles) {
      const spread = {
        x: direction.x + direction.z * angle.x,
        y: direction.y + angle.y,
        z: direction.z - direction.x * angle.x,
      };
      const mag = Math.sqrt(spread.x * spread.x + spread.y * spread.y + spread.z * spread.z) || 1;
      super.shootRaycast(origin, { x: spread.x / mag, y: spread.y / mag, z: spread.z / mag }, length);
    }
  }
}
