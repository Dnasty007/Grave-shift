import { Quaternion, PlayerEntity, type Vector3Like, type QuaternionLike } from "hytopia";
import GunEntity, { type GunEntityOptions } from "./GunEntity";
import type { ImportedGunDef } from "./importedGunCatalog";

/** Blockbench GLTF gun — same hand anchor transform as official `models/items/*.glb`. */
export default class ImportedGunEntity extends GunEntity {
  private readonly _fullAuto: boolean;

  public constructor(def: ImportedGunDef, options: Partial<GunEntityOptions> = {}) {
    const twoHanded = def.twoHanded ?? true;
    super({
      ammo: options.ammo ?? def.maxAmmo,
      damage: options.damage ?? def.damage,
      fireRate: options.fireRate ?? def.fireRate,
      hand: options.hand ?? (twoHanded ? "both" : "right"),
      iconImageUri: options.iconImageUri ?? "icons/pistol.png",
      idleAnimation: options.idleAnimation ?? (twoHanded ? "idle_gun_both" : "idle_gun_right"),
      name: options.name ?? def.name,
      maxAmmo: options.maxAmmo ?? def.maxAmmo,
      modelUri: options.modelUri ?? def.modelUri,
      modelScale: options.modelScale ?? def.modelScale ?? 1.8,
      parent: options.parent,
      range: options.range ?? def.range ?? 50,
      reloadAudioUri: options.reloadAudioUri ?? "audio/sfx/rifle-reload.mp3",
      reloadTimeMs: options.reloadTimeMs ?? def.reloadTimeMs ?? 1500,
      reserveAmmo: options.reserveAmmo ?? def.reserveAmmo,
      shootAnimation: options.shootAnimation ?? (twoHanded ? "shoot_gun_both" : "shoot_gun_right"),
      shootAudioUri: options.shootAudioUri ?? "audio/sfx/rifle-shoot.mp3",
      onShoot: options.onShoot,
      onHit: options.onHit,
      onAmmoChanged: options.onAmmoChanged,
    });
    this._fullAuto = def.fullAuto ?? false;
  }

  public override shoot(): void {
    if (!this.parent || !this.processShoot()) return;

    const parentPlayerEntity = this.parent as PlayerEntity;
    if (!parentPlayerEntity.world) return;

    super.shoot();

    if (this._fullAuto) {
      parentPlayerEntity.player.input.ml = true;
    } else {
      parentPlayerEntity.player.input.ml = false;
    }
  }

  public override getMuzzleFlashPositionRotation(): { position: Vector3Like; rotation: QuaternionLike } {
    return {
      position: { x: 0.02, y: 0.05, z: -0.9 },
      rotation: Quaternion.fromEuler(0, 90, 0),
    };
  }
}
