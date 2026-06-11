import { Quaternion, type Vector3Like, type QuaternionLike } from "hytopia";
import PistolEntity from "./PistolEntity";
import type { GunEntityOptions } from "./GunEntity";

/** Official zombies-fps AR-15 — fast semi-auto rifle, two-handed hold. */
export default class AR15Entity extends PistolEntity {
  public constructor(options: Partial<GunEntityOptions> = {}) {
    super({
      ammo: options.ammo ?? 30,
      damage: options.damage ?? 40,            // official 4 ×10 for our zombie HP curve
      fireRate: options.fireRate ?? 15,
      iconImageUri: options.iconImageUri ?? "icons/ar-15.png",
      idleAnimation: options.idleAnimation ?? "idle_gun_both",
      name: options.name ?? "AR-15",
      maxAmmo: options.maxAmmo ?? 30,
      modelUri: options.modelUri ?? "models/items/ar-15.glb",
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
      position: { x: 0.01, y: 0.03, z: -1.42 },
      rotation: Quaternion.fromEuler(0, 90, 0),
    };
  }
}
