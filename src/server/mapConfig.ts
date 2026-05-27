import type { Vector3Like } from "hytopia";

/** Maps the UI can select for deploy (same `map.json` world until a second export exists). */
export type GehennaMapId = "industrial_yard" | "test_zone";

export const DEFAULT_MAP_ID: GehennaMapId = "industrial_yard";

/**
 * Inclusive block bounds for `assets/map.json` (Topia_Map_V1 export).
 * Used to keep spawn points on solid terrain — world X/Z align 1:1 with block coords.
 */
export const MAP_WORLD_BOUNDS = {
  minX: -51,
  maxX: 1,
  minZ: -27,
  maxZ: 23
} as const;

/** World-space spawn per zone (Y≈12 drops onto y≈0 terrain after deploy). */
export const MAP_SPAWN: Record<GehennaMapId, Vector3Like> = {
  industrial_yard: { x: -22, y: 12, z: -4 },
  /** North-east lane on the same island — away from yard spawn, still on-grid. */
  test_zone: { x: -10, y: 12, z: 18 }
};

/** Per-map sandbox flags. Test Zone grants unlimited lethal charges for mechanics QA. */
export const MAP_DEV_FLAGS: Record<GehennaMapId, { unlimitedLethals: boolean }> = {
  industrial_yard: { unlimitedLethals: false },
  test_zone:       { unlimitedLethals: true }
};

export function isSpawnInMapBounds(pos: Vector3Like): boolean {
  const { minX, maxX, minZ, maxZ } = MAP_WORLD_BOUNDS;
  return pos.x >= minX && pos.x <= maxX && pos.z >= minZ && pos.z <= maxZ;
}

export function normalizeMapId(raw: unknown): GehennaMapId {
  if (raw === "test_zone" || raw === "industrial_yard") return raw;
  return DEFAULT_MAP_ID;
}
