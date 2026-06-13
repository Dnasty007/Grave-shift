export const IMPORTED_GUN_IDS = [
  "ak47_gltf",
  "ak47_fun",
  "asval",
  "asval_fun",
  "awp",
  "awp_fun",
  "desert_eagle",
  "desert_eagle_gold",
  "glock_19",
  "glock_19_blue",
  "glock_19_green",
  "glock_19_pink",
  "m4a4",
  "m4a4_fun",
  "mp7",
] as const;

export type ImportedGunId = (typeof IMPORTED_GUN_IDS)[number];

export type ImportedGunDef = {
  id: ImportedGunId;
  name: string;
  modelUri: string;
  /** Equipped hand scale — Blockbench GLTFs are authored ~4× larger than official `models/items/*.glb`. */
  modelScale: number;
  /** World pickup scale — tuned to match official gun pickups (@ 0.8). */
  pickupScale: number;
  damage: number;
  fireRate: number;
  maxAmmo: number;
  reserveAmmo: number;
  range?: number;
  fullAuto?: boolean;
  twoHanded?: boolean;
  reloadTimeMs?: number;
};

const IMPORTED_MODEL = "models/items/imported";

/**
 * Blockbench gun pack scales — matched to official Hytopia guns (pistol @ 1.3, pickup @ 0.8).
 * Same tuning as legacy `hytopiaWeaponDefs.ts` viewmodel scales for these meshes.
 */
const S = {
  pistol:       { equipped: 0.34, pickup: 0.75 },
  heavyPistol:  { equipped: 0.33, pickup: 0.50 },
  smg:          { equipped: 0.32, pickup: 0.22 },
  rifle:        { equipped: 0.29, pickup: 0.18 },
  sniper:       { equipped: 0.28, pickup: 0.15 },
} as const;

function gunScales(tier: keyof typeof S): Pick<ImportedGunDef, "modelScale" | "pickupScale"> {
  return { modelScale: S[tier].equipped, pickupScale: S[tier].pickup };
}

/** Blockbench gun pack — stats tuned for the zombie HP curve. */
export const IMPORTED_GUN_DEFS: ImportedGunDef[] = [
  { id: "ak47_gltf",        name: "AK-47 (Import)",     modelUri: `${IMPORTED_MODEL}/ak47.gltf`,              ...gunScales("rifle"),       damage: 32, fireRate: 10, maxAmmo: 30, reserveAmmo: 150, fullAuto: true },
  { id: "ak47_fun",         name: "AK-47 Fun",          modelUri: `${IMPORTED_MODEL}/ak47-fun.gltf`,          ...gunScales("rifle"),       damage: 32, fireRate: 10, maxAmmo: 30, reserveAmmo: 150, fullAuto: true },
  { id: "asval",            name: "AS VAL",             modelUri: `${IMPORTED_MODEL}/asval.gltf`,             ...gunScales("rifle"),       damage: 34, fireRate: 11, maxAmmo: 20, reserveAmmo: 120, fullAuto: true },
  { id: "asval_fun",        name: "AS VAL Fun",         modelUri: `${IMPORTED_MODEL}/asval-fun.gltf`,         ...gunScales("rifle"),       damage: 34, fireRate: 11, maxAmmo: 20, reserveAmmo: 120, fullAuto: true },
  { id: "awp",              name: "AWP",                modelUri: `${IMPORTED_MODEL}/awp.gltf`,               ...gunScales("sniper"),      damage: 120, fireRate: 0.7, maxAmmo: 5, reserveAmmo: 25, range: 80, fullAuto: false, reloadTimeMs: 2200 },
  { id: "awp_fun",          name: "AWP Fun",            modelUri: `${IMPORTED_MODEL}/awp-fun.gltf`,           ...gunScales("sniper"),      damage: 120, fireRate: 0.7, maxAmmo: 5, reserveAmmo: 25, range: 80, fullAuto: false, reloadTimeMs: 2200 },
  { id: "desert_eagle",     name: "Desert Eagle",       modelUri: `${IMPORTED_MODEL}/desert-eagle.gltf`,      ...gunScales("heavyPistol"), damage: 55, fireRate: 4, maxAmmo: 7, reserveAmmo: 42, fullAuto: false, twoHanded: false },
  { id: "desert_eagle_gold",name: "Desert Eagle Gold",  modelUri: `${IMPORTED_MODEL}/desert-eagle-gold.gltf`, ...gunScales("heavyPistol"), damage: 58, fireRate: 4, maxAmmo: 7, reserveAmmo: 42, fullAuto: false, twoHanded: false },
  { id: "glock_19",         name: "Glock 19",           modelUri: `${IMPORTED_MODEL}/glock-19.gltf`,          ...gunScales("pistol"),      damage: 28, fireRate: 9, maxAmmo: 15, reserveAmmo: 90, fullAuto: false, twoHanded: false },
  { id: "glock_19_blue",    name: "Glock 19 Blue",      modelUri: `${IMPORTED_MODEL}/glock-19-blue.gltf`,     ...gunScales("pistol"),      damage: 28, fireRate: 9, maxAmmo: 15, reserveAmmo: 90, fullAuto: false, twoHanded: false },
  { id: "glock_19_green",   name: "Glock 19 Green",     modelUri: `${IMPORTED_MODEL}/glock-19-green.gltf`,    ...gunScales("pistol"),      damage: 28, fireRate: 9, maxAmmo: 15, reserveAmmo: 90, fullAuto: false, twoHanded: false },
  { id: "glock_19_pink",    name: "Glock 19 Pink",      modelUri: `${IMPORTED_MODEL}/glock-19-pink.gltf`,     ...gunScales("pistol"),      damage: 28, fireRate: 9, maxAmmo: 15, reserveAmmo: 90, fullAuto: false, twoHanded: false },
  { id: "m4a4",             name: "M4A4",               modelUri: `${IMPORTED_MODEL}/m4a4.gltf`,              ...gunScales("rifle"),       damage: 38, fireRate: 12, maxAmmo: 30, reserveAmmo: 150, fullAuto: true },
  { id: "m4a4_fun",         name: "M4A4 Fun",           modelUri: `${IMPORTED_MODEL}/m4a4-fun.gltf`,           ...gunScales("rifle"),       damage: 38, fireRate: 12, maxAmmo: 30, reserveAmmo: 150, fullAuto: true },
  { id: "mp7",              name: "MP7",                modelUri: `${IMPORTED_MODEL}/mp7.gltf`,               ...gunScales("smg"),         damage: 24, fireRate: 14, maxAmmo: 30, reserveAmmo: 150, fullAuto: true },
];

export const IMPORTED_GUN_BY_ID: Record<ImportedGunId, ImportedGunDef> = Object.fromEntries(
  IMPORTED_GUN_DEFS.map((d) => [d.id, d])
) as Record<ImportedGunId, ImportedGunDef>;

export function isImportedGunId(raw: unknown): raw is ImportedGunId {
  return typeof raw === "string" && (IMPORTED_GUN_IDS as readonly string[]).includes(raw);
}

/** Test Map import grid — far north of hub, above the official gun row (z≈30). */
export function buildImportedGunPickups(): {
  x: number;
  z: number;
  weaponKey: ImportedGunId;
  label: string;
  model: string;
  scale: number;
}[] {
  const rows = [42, 48, 54] as const;
  const cols = 5;
  const startX = -32;
  const stepX = 8;

  return IMPORTED_GUN_DEFS.map((def, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    return {
      x: startX + col * stepX,
      z: rows[row] ?? rows[rows.length - 1],
      weaponKey: def.id,
      label: def.name,
      model: def.modelUri,
      scale: def.pickupScale,
    };
  });
}
