import assert from "node:assert/strict";
import {
  DEFAULT_MAP_ID,
  isSpawnInMapBounds,
  MAP_DEV_FLAGS,
  MAP_SPAWN,
  MAP_WORLD_BOUNDS
} from "../src/server/mapConfig.ts";

for (const [mapId, pos] of Object.entries(MAP_SPAWN)) {
  assert(
    isSpawnInMapBounds(pos),
    `${mapId} spawn ${JSON.stringify(pos)} must lie inside map.json bounds`
  );
}

assert.equal(
  MAP_SPAWN.test_zone.x,
  -10,
  "test_zone spawn should sit on the north-east island lane, not off-grid"
);

assert.equal(
  MAP_DEV_FLAGS.test_zone.unlimitedLethals,
  true,
  "test_zone should grant unlimited lethal charges for mechanics QA"
);

assert(MAP_SPAWN.industrial_yard.x >= MAP_WORLD_BOUNDS.minX);
assert(MAP_SPAWN.industrial_yard.x <= MAP_WORLD_BOUNDS.maxX);
assert.equal(DEFAULT_MAP_ID, "industrial_yard");

console.log("mapConfig tests passed");
