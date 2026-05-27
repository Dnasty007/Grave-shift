import type { WeaponDefinition } from "../WeaponManager";
import { WEAPON_LOCAL_SCALE } from "../WeaponManager";

/**
 * Central place for all weapon definitions.
 * This is the start of the clean weapon architecture (Phase 3).
 *
 * Current approach follows the official Hytopia zombies-fps pattern:
 * Weapons are Entities attached to hand anchors on a rigged player model.
 *
 * For future: Add dedicated `viewModel` for pure first-person arms+gun rigs.
 */
export const WEAPON_DEFINITIONS: Record<string, WeaponDefinition> = {
  m4a4: {
    id: "m4a4",
    name: "M4A4",
    worldModel: "models/weapons/hytopia-guns/m4a4.gltf",
    // viewModel: "models/weapons/hytopia-guns/m4a4-fp.glb",   // Add this later for real FP viewmodel

    // Try "hand_right_weapon_anchor" if the gun still looks badly rotated after tuning the pose below.
    // Some soldier rigs have a dedicated weapon anchor that is better aligned for guns.
    handAnchor: "hand_right_anchor",
    // handAnchor: "hand_right_weapon_anchor",   // Alternative - try this if the gun is still sideways

    scale: WEAPON_LOCAL_SCALE,

    // Approximate muzzle offset for the m4a4 model (tune this based on the actual model).
    // This is in the weapon model's local space.
    muzzleOffset: { x: 0, y: 0.05, z: -0.9 },
  },

  // Example of how to add more weapons easily:
  // ak47: {
  //   id: "ak47",
  //   name: "AK-47",
  //   worldModel: "models/weapons/hytopia-guns/ak47.glb",
  //   handAnchor: "hand_right_anchor",
  //   scale: 0.95,
  // },
};

/**
 * Helper to get a weapon definition safely.
 */
export function getWeaponDefinition(key: string): WeaponDefinition | undefined {
  return WEAPON_DEFINITIONS[key];
}
