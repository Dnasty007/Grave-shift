import assert from "node:assert/strict";
import {
  consumeLethalCharge,
  LETHAL_CHARGES,
  parseDeployLoadout,
  startingLethalCharges
} from "../src/server/loadoutConfig.ts";

assert.deepEqual(parseDeployLoadout(null), { lethal: null });
assert.deepEqual(parseDeployLoadout({ lethal: "frag" }), { lethal: "frag" });
assert.deepEqual(parseDeployLoadout({ lethal: "bogus" }), { lethal: null });

assert.equal(startingLethalCharges("industrial_yard", "frag"), LETHAL_CHARGES.frag);
assert.equal(startingLethalCharges("test_zone", "satchel"), 999);
assert.equal(startingLethalCharges("test_zone", null), 0);
assert.equal(consumeLethalCharge("test_zone", 999), 999);
assert.equal(consumeLethalCharge("industrial_yard", 2), 1);

console.log("loadoutConfig tests passed");
