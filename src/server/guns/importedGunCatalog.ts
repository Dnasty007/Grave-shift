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
  modelScale?: number;
  pickupScale?: number;
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

/** Blockbench gun pack — stats tuned for the zombie HP curve. */
export const IMPORTED_GUN_DEFS: ImportedGunDef[] = [
  { id: "ak47_gltf",        name: "AK-47 (Import)",     modelUri: `${IMPORTED_MODEL}/ak47.gltf`,              damage: 32, fireRate: 10, maxAmmo: 30, reserveAmmo: 150, fullAuto: true },
  { id: "ak47_fun",         name: "AK-47 Fun",          modelUri: `${IMPORTED_MODEL}/ak47-fun.gltf`,          damage: 32, fireRate: 10, maxAmmo: 30, reserveAmmo: 150, fullAuto: true },
  { id: "asval",            name: "AS VAL",             modelUri: `${IMPORTED_MODEL}/asval.gltf`,             damage: 34, fireRate: 11, maxAmmo: 20, reserveAmmo: 120, fullAuto: true },
  { id: "asval_fun",        name: "AS VAL Fun",         modelUri: `${IMPORTED_MODEL}/asval-fun.gltf`,         damage: 34, fireRate: 11, maxAmmo: 20, reserveAmmo: 120, fullAuto: true },
  { id: "awp",              name: "AWP",                modelUri: `${IMPORTED_MODEL}/awp.gltf`,               damage: 120, fireRate: 0.7, maxAmmo: 5, reserveAmmo: 25, range: 80, fullAuto: false, reloadTimeMs: 2200 },
  { id: "awp_fun",          name: "AWP Fun",            modelUri: `${IMPORTED_MODEL}/awp-fun.gltf`,           damage: 120, fireRate: 0.7, maxAmmo: 5, reserveAmmo: 25, range: 80, fullAuto: false, reloadTimeMs: 2200 },
  { id: "desert_eagle",     name: "Desert Eagle",       modelUri: `${IMPORTED_MODEL}/desert-eagle.gltf`,      damage: 55, fireRate: 4, maxAmmo: 7, reserveAmmo: 42, fullAuto: false, twoHanded: false },
  { id: "desert_eagle_gold",name: "Desert Eagle Gold",  modelUri: `${IMPORTED_MODEL}/desert-eagle-gold.gltf`, damage: 58, fireRate: 4, maxAmmo: 7, reserveAmmo: 42, fullAuto: false, twoHanded: false },
  { id: "glock_19",         name: "Glock 19",           modelUri: `${IMPORTED_MODEL}/glock-19.gltf`,          damage: 28, fireRate: 9, maxAmmo: 15, reserveAmmo: 90, fullAuto: false, twoHanded: false },
  { id: "glock_19_blue",    name: "Glock 19 Blue",      modelUri: `${IMPORTED_MODEL}/glock-19-blue.gltf`,     damage: 28, fireRate: 9, maxAmmo: 15, reserveAmmo: 90, fullAuto: false, twoHanded: false },
  { id: "glock_19_green",   name: "Glock 19 Green",     modelUri: `${IMPORTED_MODEL}/glock-19-green.gltf`,    damage: 28, fireRate: 9, maxAmmo: 15, reserveAmmo: 90, fullAuto: false, twoHanded: false },
  { id: "glock_19_pink",    name: "Glock 19 Pink",      modelUri: `${IMPORTED_MODEL}/glock-19-pink.gltf`,     damage: 28, fireRate: 9, maxAmmo: 15, reserveAmmo: 90, fullAuto: false, twoHanded: false },
  { id: "m4a4",             name: "M4A4",               modelUri: `${IMPORTED_MODEL}/m4a4.gltf`,              damage: 38, fireRate: 12, maxAmmo: 30, reserveAmmo: 150, fullAuto: true },
  { id: "m4a4_fun",         name: "M4A4 Fun",           modelUri: `${IMPORTED_MODEL}/m4a4-fun.gltf`,           damage: 38, fireRate: 12, maxAmmo: 30, reserveAmmo: 150, fullAuto: true },
  { id: "mp7",              name: "MP7",                modelUri: `${IMPORTED_MODEL}/mp7.gltf`,               damage: 24, fireRate: 14, maxAmmo: 30, reserveAmmo: 150, fullAuto: true },
];

export const IMPORTED_GUN_BY_ID: Record<ImportedGunId, ImportedGunDef> = Object.fromEntries(
  IMPORTED_GUN_DEFS.map((d) => [d.id, d])
) as Record<ImportedGunId, ImportedGunDef>;

export function isImportedGunId(raw: unknown): raw is ImportedGunId {
  return typeof raw === "string" && (IMPORTED_GUN_IDS as readonly string[]).includes(raw);
}

/** Test Map pickup rows south of the official gun lane (z=32) and north of swords (z=40). */
export function buildImportedGunPickups(): {
  x: number;
  z: number;
  kind: "gun";
  weaponKey: ImportedGunId;
  label: string;
  model: string;
  scale: number;
}[] {
  const rows = [18, 22, 26] as const;
  const cols = 5;
  const startX = -45;
  const stepX = 9;
  const pickupScale = 1.2;

  return IMPORTED_GUN_DEFS.map((def, i) => {
    const row = Math.floor(i / cols);
    const col = i % cols;
    return {
      x: startX + col * stepX,
      z: rows[row] ?? rows[rows.length - 1],
      kind: "gun" as const,
      weaponKey: def.id,
      label: def.name,
      model: def.modelUri,
      scale: def.pickupScale ?? pickupScale,
    };
  });
}
