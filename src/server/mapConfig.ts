import type { Vector3Like } from "hytopia";

/** Maps the UI can select for deploy (same `map.json` world until a second export exists). */
export type GehennaMapId = "industrial_yard" | "test_zone";

export const DEFAULT_MAP_ID: GehennaMapId = "industrial_yard";

/** World-space spawn per zone (Y≈12 clears current yard geometry). */
export const MAP_SPAWN: Record<GehennaMapId, Vector3Like> = {
  industrial_yard: { x: -22, y: 12, z: -4 },
  /** Open-ish offset on the same grid — tune in World Editor exports later. */
  test_zone: { x: 18, y: 12, z: 18 }
};

export function normalizeMapId(raw: unknown): GehennaMapId {
  if (raw === "test_zone" || raw === "industrial_yard") return raw;
  return DEFAULT_MAP_ID;
}
