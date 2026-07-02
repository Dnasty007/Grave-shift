import type { Vector3Like } from "hytopia";

/** Maps the UI can select for deploy. Each id loads its own `assets/*.json` world. */
export type GehennaMapId = "industrial_yard" | "test_zone" | "high_bastion" | "the_sprawl" | "draculas_castle" | "ice_map";

export const DEFAULT_MAP_ID: GehennaMapId = "industrial_yard";

/** Asset paths passed to `world.loadMap(...)`. */
export const MAP_JSON_PATH: Record<GehennaMapId, string> = {
  industrial_yard: "assets/map.json",
  test_zone: "assets/test-map.json",
  high_bastion: "assets/high-bastion-map.json",
  the_sprawl: "assets/the-sprawl-map.json",
  draculas_castle: "assets/draculas-castle-map.json",
  ice_map: "assets/ice-map-map.json",
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

/** Inclusive bounds for `assets/test-map.json` (Full Combat Arena generator). */
export const TEST_ZONE_BOUNDS = {
  minX: -52,
  maxX: 52,
  minZ: -52,
  maxZ: 52
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

/** Inclusive bounds for Dracula's Castle (new custom map). Large for exploration. */
export const DRACULAS_CASTLE_BOUNDS = {
  minX: -150,
  maxX: 150,
  minZ: -150,
  maxZ: 150
} as const;

/** Inclusive bounds for Ice Map (Mineways centered export ~291×309 blocks). */
export const ICE_MAP_BOUNDS = {
  minX: -150,
  maxX: 150,
  minZ: -155,
  maxZ: 155
} as const;

/** Block type ids treated as foliage per map (skipped when finding walkable ground). */
export const MAP_FOLIAGE_BLOCK_IDS: Record<GehennaMapId, ReadonlySet<number>> = {
  industrial_yard: new Set([2, 10, 13]),
  test_zone:       new Set([3]), // oak-leaves in test-map.json
  high_bastion:    new Set([2, 10, 14]), // azalea leaves, glass, oak-leaves
  the_sprawl:      new Set([2, 13, 14, 15, 16, 17, 18, 19, 27, 33]), // leaves + glass variants
  draculas_castle: new Set([2, 10, 13, 14, 27]), // typical leaves, plants, etc for castle grounds
  ice_map:         new Set([2, 10, 13, 14, 27]),
};

/** Reject zombie/boss spawn candidates above this walk-surface Y per map. */
export const MAP_MAX_SPAWN_GROUND_Y: Record<GehennaMapId, number> = {
  industrial_yard: 4,
  test_zone:       8,
  high_bastion:    20,
  the_sprawl:      12,
  draculas_castle: 25,
  ice_map:         30,
};

/** Top Y scanned when snapping props/spawns to walkable ground per map. */
export const MAP_GROUND_SCAN_MAX_Y: Record<GehennaMapId, number> = {
  industrial_yard: 3,
  test_zone:       7,
  high_bastion:    30,
  the_sprawl:      25,
  draculas_castle: 35,
  ice_map:         40,
};

export const MAP_BOUNDS: Record<GehennaMapId, { minX: number; maxX: number; minZ: number; maxZ: number }> = {
  industrial_yard: MAP_WORLD_BOUNDS,
  test_zone: TEST_ZONE_BOUNDS,
  high_bastion: HIGH_BASTION_BOUNDS,
  the_sprawl: THE_SPRAWL_BOUNDS,
  draculas_castle: DRACULAS_CASTLE_BOUNDS,
  ice_map:         ICE_MAP_BOUNDS,
};

/** World-space spawn per zone (Y high enough to drop onto terrain). */
export const MAP_SPAWN: Record<GehennaMapId, Vector3Like> = {
  industrial_yard: { x: -22, y: 12, z: -4 },
  /** Center hub spawn (Full Combat Arena). */
  test_zone: { x: 0, y: 8, z: 0 },
  /** Central courtyard — editor spawn zones sit outside this build (z < 35). */
  high_bastion: { x: 0, y: 8, z: 120 },
  /** Central plaza — no editor spawn zones in export. */
  the_sprawl: { x: 0, y: 8, z: 0 },
  /** Dracula's Castle — fixed courtyard spawn (player-tested). */
  draculas_castle: { x: 15.68, y: -59.24, z: -74.77 },
  /** Ice Map — player-tested spawn on the ice surface. */
  ice_map:         { x: 12.96, y: -10.77, z: 2.06 },
};

/** Per-map sandbox flags. Test Zone grants unlimited lethal charges for mechanics QA. */
export const MAP_DEV_FLAGS: Record<GehennaMapId, { unlimitedLethals: boolean; hordesEnabled: boolean }> = {
  industrial_yard: { unlimitedLethals: false, hordesEnabled: true },
  test_zone:       { unlimitedLethals: true,  hordesEnabled: true },
  high_bastion:    { unlimitedLethals: false, hordesEnabled: false },
  the_sprawl:      { unlimitedLethals: false, hordesEnabled: true },
  draculas_castle: { unlimitedLethals: false, hordesEnabled: false }, // castle exploration map
  ice_map:         { unlimitedLethals: false, hordesEnabled: false },
};

export function hordesEnabledForMap(mapId: GehennaMapId): boolean {
  return MAP_DEV_FLAGS[mapId].hordesEnabled;
}

export function isSpawnInMapBounds(pos: Vector3Like, mapId: GehennaMapId = DEFAULT_MAP_ID): boolean {
  const { minX, maxX, minZ, maxZ } = MAP_BOUNDS[mapId];
  return pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ;
}

export function normalizeMapId(raw: unknown): GehennaMapId {
  if (raw === "test_zone" || raw === "industrial_yard" || raw === "high_bastion" || raw === "the_sprawl" || raw === "draculas_castle" || raw === "ice_map") return raw;
  return DEFAULT_MAP_ID;
}
