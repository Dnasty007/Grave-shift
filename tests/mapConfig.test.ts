import assert from "node:assert/strict";
import {
  DEFAULT_MAP_ID,
  isSpawnInMapBounds,
  MAP_DEV_FLAGS,
  MAP_SPAWN,
  MAP_WORLD_BOUNDS,
  TEST_ZONE_BOUNDS,
} from "../src/server/mapConfig.ts";

assert(
  isSpawnInMapBounds(MAP_SPAWN.industrial_yard, "industrial_yard"),
  "industrial_yard spawn must lie inside yard bounds"
);
assert(
  isSpawnInMapBounds(MAP_SPAWN.test_zone, "test_zone"),
  "test_zone spawn must lie inside flat test arena bounds"
);

assert.equal(MAP_SPAWN.test_zone.x, 0);
assert.equal(MAP_SPAWN.test_zone.z, 0);

assert.equal(
  MAP_DEV_FLAGS.test_zone.unlimitedLethals,
  true,
  "test_zone should grant unlimited lethal charges for mechanics QA"
);

assert(MAP_SPAWN.industrial_yard.x >= MAP_WORLD_BOUNDS.minX);
assert(MAP_SPAWN.industrial_yard.x <= MAP_WORLD_BOUNDS.maxX);
assert(MAP_SPAWN.test_zone.x >= TEST_ZONE_BOUNDS.minX);
assert(MAP_SPAWN.test_zone.x <= TEST_ZONE_BOUNDS.maxX);
assert.equal(DEFAULT_MAP_ID, "industrial_yard");

console.log("mapConfig tests passed");
