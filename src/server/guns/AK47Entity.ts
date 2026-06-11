import { Quaternion, PlayerEntity, type Vector3Like, type QuaternionLike } from "hytopia";
import PistolEntity from "./PistolEntity";
import type { GunEntityOptions } from "./GunEntity";

/** Official zombies-fps AK-47 — full-auto rifle, two-handed hold. */
export default class AK47Entity extends PistolEntity {
  public constructor(options: Partial<GunEntityOptions> = {}) {
    super({
      ammo: options.ammo ?? 30,
      damage: options.damage ?? 30,            // official 3 ×10 for our zombie HP curve
      fireRate: options.fireRate ?? 10,
      iconImageUri: options.iconImageUri ?? "icons/ak-47.png",
      idleAnimation: options.idleAnimation ?? "idle_gun_both",
      name: options.name ?? "AK-47",
      maxAmmo: options.maxAmmo ?? 30,
      modelUri: options.modelUri ?? "models/items/ak-47.glb",
      reloadAudioUri: options.reloadAudioUri ?? "audio/sfx/rifle-reload.mp3",
      reloadTimeMs: options.reloadTimeMs ?? 1500,
      reserveAmmo: options.reserveAmmo ?? 150,
      shootAnimation: options.shootAnimation ?? "shoot_gun_both",
      shootAudioUri: options.shootAudioUri ?? "audio/sfx/rifle-shoot.mp3",
      ...options,
    });
  }

  public override getMuzzleFlashPositionRotation(): { position: Vector3Like; rotation: QuaternionLike } {
    return {
      position: { x: 0, y: 0.01, z: -1.25 },
      rotation: Quaternion.fromEuler(0, 90, 0),
    };
  }

  public override shoot(): void {
    if (!this.parent) return;

    super.shoot();

    // Full-auto: keep the trigger held (official).
    (this.parent as PlayerEntity).player.input.ml = true;
  }
}
