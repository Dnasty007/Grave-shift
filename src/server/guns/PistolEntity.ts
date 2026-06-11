import { Quaternion, PlayerEntity, type Vector3Like, type QuaternionLike } from "hytopia";
import GunEntity, { type GunEntityOptions } from "./GunEntity";

/** Official zombies-fps Pistol — semi-auto (click per shot). */
export default class PistolEntity extends GunEntity {
  public constructor(options: Partial<GunEntityOptions> = {}) {
    super({
      ammo: options.ammo ?? 10,
      damage: options.damage ?? 30,            // official 3 ×10 for our zombie HP curve
      fireRate: options.fireRate ?? 9,
      hand: options.hand ?? "right",
      iconImageUri: options.iconImageUri ?? "icons/pistol.png",
      idleAnimation: options.idleAnimation ?? "idle_gun_right",
      name: options.name ?? "Pistol",
      maxAmmo: options.maxAmmo ?? 10,
      modelUri: options.modelUri ?? "models/items/pistol.glb",
      modelScale: options.modelScale ?? 1.3,
      parent: options.parent,
      range: options.range ?? 50,
      reloadAudioUri: options.reloadAudioUri ?? "audio/sfx/pistol-reload.mp3",
      reloadTimeMs: options.reloadTimeMs ?? 1250,
      reserveAmmo: options.reserveAmmo ?? 60,
      shootAnimation: options.shootAnimation ?? "shoot_gun_right",
      shootAudioUri: options.shootAudioUri ?? "audio/sfx/pistol-shoot.mp3",
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

    // Semi-auto: cancel the held input so each shot needs a fresh click (official).
    parentPlayerEntity.player.input.ml = false;
  }

  public override getMuzzleFlashPositionRotation(): { position: Vector3Like; rotation: QuaternionLike } {
    return {
      position: { x: 0.03, y: 0.1, z: -0.5 },
      rotation: Quaternion.fromEuler(0, 90, 0),
    };
  }
}
