import type { PlayerEntity } from "hytopia";
import GunEntity, { type GunEntityOptions } from "./GunEntity";
import PistolEntity from "./PistolEntity";
import AutoPistolEntity from "./AutoPistolEntity";
import ShotgunEntity from "./ShotgunEntity";
import AutoShotgunEntity from "./AutoShotgunEntity";
import AR15Entity from "./AR15Entity";
import AK47Entity from "./AK47Entity";
import ImportedGunEntity from "./ImportedGunEntity";
import {
  buildImportedGunPickups,
  IMPORTED_GUN_BY_ID,
  IMPORTED_GUN_DEFS,
  IMPORTED_GUN_IDS,
  isImportedGunId,
  type ImportedGunId,
} from "./importedGunCatalog";

export { default as GunEntity } from "./GunEntity";
export type { GunEntityOptions, GunHand } from "./GunEntity";
export { default as PistolEntity } from "./PistolEntity";
export { default as AutoPistolEntity } from "./AutoPistolEntity";
export { default as ShotgunEntity } from "./ShotgunEntity";
export { default as AutoShotgunEntity } from "./AutoShotgunEntity";
export { default as AR15Entity } from "./AR15Entity";
export { default as AK47Entity } from "./AK47Entity";
export { IMPORTED_GUN_DEFS, IMPORTED_GUN_IDS, buildImportedGunPickups, isImportedGunId };
export type { ImportedGunId };

const LEGACY_GUN_IDS = ["pistol", "auto-pistol", "shotgun", "auto-shotgun", "ar15", "ak47"] as const;
export type LegacyGunId = (typeof LEGACY_GUN_IDS)[number];

/** All gun ids — official Hytopia pack + Blockbench import pack. */
export const GUN_IDS = [...LEGACY_GUN_IDS, ...IMPORTED_GUN_IDS] as const;
export type GunId = (typeof GUN_IDS)[number];

const LEGACY_GUN_CLASSES: Record<
  LegacyGunId,
  new (options?: Partial<GunEntityOptions>) => GunEntity
> = {
  "pistol":       PistolEntity,
  "auto-pistol":  AutoPistolEntity,
  "shotgun":      ShotgunEntity,
  "auto-shotgun": AutoShotgunEntity,
  "ar15":         AR15Entity,
  "ak47":         AK47Entity,
};

export const GUN_DISPLAY_NAME: Record<GunId, string> = {
  "pistol":       "Pistol",
  "auto-pistol":  "Auto Pistol",
  "shotgun":      "Shotgun",
  "auto-shotgun": "Auto Shotgun",
  "ar15":         "AR-15",
  "ak47":         "AK-47",
  ...Object.fromEntries(IMPORTED_GUN_DEFS.map((d) => [d.id, d.name])) as Record<ImportedGunId, string>,
};

export function isGunId(raw: unknown): raw is GunId {
  return typeof raw === "string" && (GUN_IDS as readonly string[]).includes(raw);
}

/** Factory: construct (NOT spawn) a gun already parented to the player's hand. */
export function createGun(
  id: GunId,
  parent: PlayerEntity,
  hooks: Pick<GunEntityOptions, "onShoot" | "onHit" | "onAmmoChanged">
): GunEntity {
  if (isImportedGunId(id)) {
    return new ImportedGunEntity(IMPORTED_GUN_BY_ID[id], { parent, ...hooks });
  }
  const Ctor = LEGACY_GUN_CLASSES[id];
  return new Ctor({ parent, ...hooks });
}
