import type { Vector3Like } from "hytopia";
import chestData from "../../assets/ice-chest-positions.json" with { type: "json" };

/** Cost to open a map chest once per run (shown as Money on Ice Map). */
export const ICE_CRATE_COST = 500;

/** Starting cash on Ice Map deploy. */
export const ICE_STARTING_MONEY = 5_000;

/** Custom entity model replacing baked Mineways chests. */
export const ICE_CRATE_MODEL_URI = "models/props/gehenna-reinforced-chest.gltf";
export const ICE_CRATE_MODEL_SCALE = 1.0;

/** Typical walkable floor Y on Ice Map (raycast hint — avoids hitting roof geometry). */
export const ICE_CRATE_FLOOR_HINT_Y = 8;

/** Horizontal reach to a reinforced chest entity (blocks). */
export const ICE_CRATE_INTERACT_RADIUS_XZ = 3.0;

export type IceCrateKind = "Chest" | "Ender_Chest" | "Trapped_Chest";

export type IceCrateDef = {
  id: string;
  kind: IceCrateKind;
  position: Vector3Like;
};

/** Mineways chest clusters extracted from Ice_Map.obj (see scripts/extract-ice-chest-positions.mjs). */
export const ICE_CRATES: IceCrateDef[] = chestData.crates.map((c) => ({
  id: c.id,
  kind: c.kind as IceCrateKind,
  position: { x: c.x, y: c.y, z: c.z },
}));

export function findNearestIceCrate(
  playerPos: Vector3Like,
  crates: ReadonlyArray<IceCrateDef>,
  usedIds: ReadonlySet<string>
): IceCrateDef | null {
  let nearest: IceCrateDef | null = null;
  let nearestDist = ICE_CRATE_INTERACT_RADIUS_XZ;

  for (const crate of crates) {
    if (usedIds.has(crate.id)) continue;

    const d = Math.hypot(playerPos.x - crate.position.x, playerPos.z - crate.position.z);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = crate;
    }
  }

  return nearest;
}
