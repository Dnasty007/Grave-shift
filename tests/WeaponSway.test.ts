import assert from "node:assert/strict";
import {
  calculateWeaponSwayTarget,
  smoothWeaponSway,
  WEAPON_SWAY_ZERO,
} from "../src/server/WeaponSway.ts";

const idle = calculateWeaponSwayTarget({
  elapsedSeconds: 0.25,
  horizontalSpeed: 0,
});
assert.deepEqual(idle, WEAPON_SWAY_ZERO, "idle movement should not sway the weapon");

const walking = calculateWeaponSwayTarget({
  elapsedSeconds: 0.25,
  horizontalSpeed: 3,
});
assert.notEqual(walking.x, 0, "walking should create side-to-side sway");
assert.notEqual(walking.y, 0, "walking should create vertical bob");
assert(walking.forward < 0, "walking should pull the weapon back slightly");

const sprinting = calculateWeaponSwayTarget({
  elapsedSeconds: 0.25,
  horizontalSpeed: 8,
});
assert(Math.abs(sprinting.x) >= Math.abs(walking.x), "sprint sway should scale with speed");
assert(Math.abs(sprinting.y) >= Math.abs(walking.y), "sprint bob should scale with speed");

const smoothed = smoothWeaponSway(WEAPON_SWAY_ZERO, sprinting, 1 / 60);
assert(Math.abs(smoothed.x) < Math.abs(sprinting.x), "sway should lag behind target side motion");
assert(Math.abs(smoothed.y) < Math.abs(sprinting.y), "sway should lag behind target vertical motion");
assert(Math.abs(smoothed.forward) < Math.abs(sprinting.forward), "sway should lag behind target forward motion");

console.log("WeaponSway tests passed");
