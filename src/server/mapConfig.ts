import type { Vector3Like } from "hytopia";

/** Maps the UI can select for deploy. Each id loads its own `assets/*.json` world. */
export type GehennaMapId = "industrial_yard" | "test_zone" | "high_bastion" | "the_sprawl";

export const DEFAULT_MAP_ID: GehennaMapId = "industrial_yard";

/** Asset paths passed to `world.loadMap(...)`. */
export const MAP_JSON_PATH: Record<GehennaMapId, string> = {
  industrial_yard: "assets/map.json",
  test_zone: "assets/test-map.json",
  high_bastion: "assets/high-bastion-map.json",
  the_sprawl: "assets/the-sprawl-map.json",
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

/** Inclusive bounds for `assets/test-map.json` (World Editor export). */
export const TEST_ZONE_BOUNDS = {
  minX: -55,
  maxX: 46,
  minZ: -57,
  maxZ: 44
} as const;

/** Inclusive bounds for `assets/high-bastion-map.json` (Castle_Map World Editor export). */
export const HIGH_BASTION_BOUNDS = {
  minX: -109,
  maxX: 114,
  minZ: 35,
  maxZ: 198
} as const;

/** Inclusive bounds for `assets/the-sprawl-map.json` (map_export World Editor export). */
export const THE_SPRAWL_BOUNDS = {
  minX: -115,
  maxX: 124,
  minZ: -105,
  maxZ: 101
} as const;

/** Block type ids treated as foliage per map (skipped when finding walkable ground). */
export const MAP_FOLIAGE_BLOCK_IDS: Record<GehennaMapId, ReadonlySet<number>> = {
  industrial_yard: new Set([2, 10, 13]),
  test_zone:       new Set([3]), // oak-leaves in test-map.json
  high_bastion:    new Set([2, 10, 14]), // azalea leaves, glass, oak-leaves
  the_sprawl:      new Set([2, 13, 14, 15, 16, 17, 18, 19, 27, 33]), // leaves + glass variants
};

/** Reject zombie/boss spawn candidates above this walk-surface Y per map. */
export const MAP_MAX_SPAWN_GROUND_Y: Record<GehennaMapId, number> = {
  industrial_yard: 4,
  test_zone:       8,
  high_bastion:    20,
  the_sprawl:      12,
};

/** Top Y scanned when snapping props/spawns to walkable ground per map. */
export const MAP_GROUND_SCAN_MAX_Y: Record<GehennaMapId, number> = {
  industrial_yard: 3,
  test_zone:       7,
  high_bastion:    30,
  the_sprawl:      25,
};

export const MAP_BOUNDS: Record<GehennaMapId, { minX: number; maxX: number; minZ: number; maxZ: number }> = {
  industrial_yard: MAP_WORLD_BOUNDS,
  test_zone: TEST_ZONE_BOUNDS,
  high_bastion: HIGH_BASTION_BOUNDS,
  the_sprawl: THE_SPRAWL_BOUNDS,
};

/** World-space spawn per zone (Y high enough to drop onto terrain). */
export const MAP_SPAWN: Record<GehennaMapId, Vector3Like> = {
  industrial_yard: { x: -22, y: 12, z: -4 },
  /** World Editor `spawn_point` zone (drops onto terrain). */
  test_zone: { x: -25, y: 8, z: 15 },
  /** Central courtyard — editor spawn zones sit outside this build (z < 35). */
  high_bastion: { x: 0, y: 8, z: 120 },
  /** Central plaza — no editor spawn zones in export. */
  the_sprawl: { x: 0, y: 8, z: 0 }
};

/** Per-map sandbox flags. Test Zone grants unlimited lethal charges for mechanics QA. */
export const MAP_DEV_FLAGS: Record<GehennaMapId, { unlimitedLethals: boolean; hordesEnabled: boolean }> = {
  industrial_yard: { unlimitedLethals: false, hordesEnabled: true },
  test_zone:       { unlimitedLethals: true,  hordesEnabled: true },
  high_bastion:    { unlimitedLethals: false, hordesEnabled: false },
  the_sprawl:      { unlimitedLethals: false, hordesEnabled: true },
};

export function hordesEnabledForMap(mapId: GehennaMapId): boolean {
  return MAP_DEV_FLAGS[mapId].hordesEnabled;
}

export function isSpawnInMapBounds(pos: Vector3Like, mapId: GehennaMapId = DEFAULT_MAP_ID): boolean {
  const { minX, maxX, minZ, maxZ } = MAP_BOUNDS[mapId];
  return pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ;
}

export function normalizeMapId(raw: unknown): GehennaMapId {
  if (raw === "test_zone" || raw === "industrial_yard" || raw === "high_bastion" || raw === "the_sprawl") return raw;
  return DEFAULT_MAP_ID;
}
