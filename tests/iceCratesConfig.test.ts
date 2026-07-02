import assert from "node:assert/strict";
import {
  findNearestIceCrate,
  ICE_CRATE_COST,
  ICE_CRATES,
  ICE_STARTING_MONEY,
} from "../src/server/iceCratesConfig.ts";

assert(ICE_CRATES.length > 200, "Ice Map should have many baked-in chest clusters");
assert.equal(ICE_CRATE_COST, 500);
assert.equal(ICE_STARTING_MONEY, 5_000);

const hit = findNearestIceCrate(
  { x: ICE_CRATES[0]!.position.x, y: ICE_CRATES[0]!.position.y, z: ICE_CRATES[0]!.position.z },
  ICE_CRATES,
  new Set()
);
assert(hit, "player standing on a crate should detect it");

const crate = hit!;
const used = new Set([crate.id]);
const afterUse = findNearestIceCrate(crate.position, ICE_CRATES, used);
assert(afterUse === null || afterUse.id !== crate.id, "used crates are skipped");

console.log(`iceCratesConfig.test.ts: OK (${ICE_CRATES.length} crates)`);
