import { Quaternion, PlayerEntity, type Vector3Like, type QuaternionLike } from "hytopia";
import ShotgunEntity from "./ShotgunEntity";
import type { GunEntityOptions } from "./GunEntity";

/** Official zombies-fps Auto Shotgun — full-auto spread monster. */
export default class AutoShotgunEntity extends ShotgunEntity {
  public constructor(options: Partial<GunEntityOptions> = {}) {
    super({
      ammo: options.ammo ?? 6,
      fireRate: options.fireRate ?? 2,
      iconImageUri: options.iconImageUri ?? "icons/auto-shotgun.png",
      name: options.name ?? "Auto Shotgun",
      maxAmmo: options.maxAmmo ?? 6,
      modelUri: options.modelUri ?? "models/items/auto-shotgun.glb",
      reloadTimeMs: options.reloadTimeMs ?? 2500,
      reserveAmmo: options.reserveAmmo ?? 36,
      ...options,
    });
  }

  public override getMuzzleFlashPositionRotation(): { position: Vector3Like; rotation: QuaternionLike } {
    return {
      position: { x: 0.015, y: 0, z: -1 },
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
