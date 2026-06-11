import type { Vector3Like } from "hytopia";

/** Maps the UI can select for deploy. Each id loads its own `assets/*.json` world. */
export type GehennaMapId = "industrial_yard" | "test_zone";

export const DEFAULT_MAP_ID: GehennaMapId = "industrial_yard";

/** Asset paths passed to `world.loadMap(...)`. */
export const MAP_JSON_PATH: Record<GehennaMapId, string> = {
  industrial_yard: "assets/map.json",
  test_zone: "assets/test-map.json",
};

/**
 * Inclusive block bounds for `assets/map.json` (Topia_Map_V1 export).
 * World X/Z align 1:1 with block coords.
 */
export const MAP_WORLD_BOUNDS = {
  minX: -51,
  maxX: 1,
  minZ: -27,
  maxZ: 23
} as const;

/** Inclusive bounds for the flat `assets/test-map.json` QA arena. */
export const TEST_ZONE_BOUNDS = {
  minX: -40,
  maxX: 40,
  minZ: -40,
  maxZ: 40
} as const;

export const MAP_BOUNDS: Record<GehennaMapId, { minX: number; maxX: number; minZ: number; maxZ: number }> = {
  industrial_yard: MAP_WORLD_BOUNDS,
  test_zone: TEST_ZONE_BOUNDS,
};

/** World-space spawn per zone (Y high enough to drop onto terrain). */
export const MAP_SPAWN: Record<GehennaMapId, Vector3Like> = {
  industrial_yard: { x: -22, y: 12, z: -4 },
  /** Flat 81×81 grass arena — center spawn for weapons/lethals QA. */
  test_zone: { x: 0, y: 6, z: 0 }
};

/** Per-map sandbox flags. Test Zone grants unlimited lethal charges for mechanics QA. */
export const MAP_DEV_FLAGS: Record<GehennaMapId, { unlimitedLethals: boolean }> = {
  industrial_yard: { unlimitedLethals: false },
  test_zone:       { unlimitedLethals: true }
};

export function isSpawnInMapBounds(pos: Vector3Like, mapId: GehennaMapId = DEFAULT_MAP_ID): boolean {
  const { minX, maxX, minZ, maxZ } = MAP_BOUNDS[mapId];
  return pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ;
}

export function normalizeMapId(raw: unknown): GehennaMapId {
  if (raw === "test_zone" || raw === "industrial_yard") return raw;
  return DEFAULT_MAP_ID;
}
