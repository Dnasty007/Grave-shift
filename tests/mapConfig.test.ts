import assert from "node:assert/strict";
import {
  DEFAULT_MAP_ID,
  hordesEnabledForMap,
  isSpawnInMapBounds,
  MAP_DEV_FLAGS,
  MAP_SPAWN,
  MAP_WORLD_BOUNDS,
  HIGH_BASTION_BOUNDS,
  TEST_ZONE_BOUNDS,
  THE_SPRAWL_BOUNDS,
  DRACULAS_CASTLE_BOUNDS,
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

assert(
  isSpawnInMapBounds(MAP_SPAWN.high_bastion, "high_bastion"),
  "high_bastion spawn must lie inside castle bounds"
);
assert.equal(MAP_SPAWN.high_bastion.x, 0);
assert.equal(MAP_SPAWN.high_bastion.z, 120);
assert.equal(hordesEnabledForMap("high_bastion"), false);
assert.equal(hordesEnabledForMap("industrial_yard"), true);
assert(MAP_SPAWN.high_bastion.x >= HIGH_BASTION_BOUNDS.minX);
assert(MAP_SPAWN.high_bastion.x <= HIGH_BASTION_BOUNDS.maxX);

assert(
  isSpawnInMapBounds(MAP_SPAWN.the_sprawl, "the_sprawl"),
  "the_sprawl spawn must lie inside mega map bounds"
);
assert.equal(MAP_SPAWN.the_sprawl.x, 0);
assert.equal(MAP_SPAWN.the_sprawl.z, 0);
assert.equal(hordesEnabledForMap("the_sprawl"), true);
assert(MAP_SPAWN.the_sprawl.x >= THE_SPRAWL_BOUNDS.minX);
assert(MAP_SPAWN.the_sprawl.x <= THE_SPRAWL_BOUNDS.maxX);

assert(MAP_SPAWN.industrial_yard.x >= MAP_WORLD_BOUNDS.minX);
assert(MAP_SPAWN.industrial_yard.x <= MAP_WORLD_BOUNDS.maxX);
assert(MAP_SPAWN.test_zone.x >= TEST_ZONE_BOUNDS.minX);
assert(MAP_SPAWN.test_zone.x <= TEST_ZONE_BOUNDS.maxX);

assert(
  isSpawnInMapBounds(MAP_SPAWN.draculas_castle, "draculas_castle"),
  "draculas_castle spawn must lie inside castle bounds"
);
assert.equal(MAP_SPAWN.draculas_castle.x, 15.68);
assert.equal(MAP_SPAWN.draculas_castle.y, -59.24);
assert.equal(MAP_SPAWN.draculas_castle.z, -74.77);
assert.equal(hordesEnabledForMap("draculas_castle"), false);
assert(MAP_SPAWN.draculas_castle.x >= DRACULAS_CASTLE_BOUNDS.minX);

assert(
  isSpawnInMapBounds(MAP_SPAWN.ice_map, "ice_map"),
  "ice_map spawn must lie inside ice map bounds"
);
assert.equal(MAP_SPAWN.ice_map.x, 12.96);
assert.equal(MAP_SPAWN.ice_map.y, -10.77);
assert.equal(MAP_SPAWN.ice_map.z, 2.06);
assert.equal(hordesEnabledForMap("ice_map"), false);

assert.equal(DEFAULT_MAP_ID, "industrial_yard");

console.log("mapConfig tests passed");
