import assert from "node:assert/strict";
import {
  DRACULA_DOORS,
  DRACULA_STARTING_MONEY,
  draculaDoorRequirementsMet,
} from "../src/server/draculaDoorsConfig.ts";

assert.equal(DRACULA_STARTING_MONEY, 100_000);
assert(DRACULA_DOORS.length >= 1);

const first = DRACULA_DOORS[0]!;
assert(draculaDoorRequirementsMet(first, new Set()));

const second = DRACULA_DOORS.find((d) => d.id === "inner-passage")!;
assert(!draculaDoorRequirementsMet(second, new Set()));
assert(draculaDoorRequirementsMet(second, new Set(["courtyard-door"])));

console.log("draculaDoorsConfig tests passed");
