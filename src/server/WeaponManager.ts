import { Entity, PlayerCameraMode, type Player, type PlayerEntity, type Vector3Like } from "hytopia";
import { WeaponSway } from "./WeaponSway";
import { WEAPON_DEFINITIONS, getWeaponDefinition } from "./weapons/WeaponDefinitions";

/**
 * WeaponManager - Official Hytopia FPS Pattern (inspired by zombies-fps example)
 *
 * Core approach:
 * - Weapons are separate Entities attached to hand bones on the player model.
 * - First person is achieved by hiding body parts + the attached weapon moving with the hand.
 *
 * MAIN TUNING AREA: Look for the big "WEAPON HAND POSE" section near the top of this file.
 *
 * See: hytopia-client/sdk-examples/zombies-fps/
 * See docs/HYTOPIA_BIBLE/15_VIEWMODELS_WEAPONS_AND_ATTACHMENTS.md
 */

// Nodes to hide on the player model in first person.
// Goal: Hide the body so only the arms + the weapon attached to the hand are visible.
const FP_VIEW_HIDDEN_NODES = [
  "head",
  "neck",
  "torso",
  "eyes",
  "body",
  "arms",
  "legs",
  "leg_right",
  "leg_left",
  "foot_right",
  "foot_left",
  "third-person",
  "upper",
  "lower",
  "torso-anchor",
  "head_anchor",
];

/**
 * Weapon Definition
 * This is the start of a clean architecture (Phase 3).
 * - worldModel: Used for the attached entity (visible in 3rd person and as base in FP)
 * - viewModel (future): Can be used later for pure camera.setViewModel() dedicated FP rigs
 * - handAnchor: The node name on the player model to attach to
 */
export type WeaponDefinition = {
  id: string;
  name: string;
  worldModel: string;
  viewModel?: string;           // Optional dedicated FP viewmodel (for later)
  handAnchor: string;           // e.g. "hand_right_anchor"
  scale?: number;

  // Local offset (in weapon model space) from the weapon's origin to the muzzle tip.
  // Used for accurate bullet origin and muzzle flash position.
  muzzleOffset?: Vector3Like;
};

// ============================================================
// WEAPON HAND POSE - TUNE THESE VALUES
// ============================================================
// This is the primary place to adjust so the gun sits naturally in the hand.
//
// Instructions:
//   1. Change any of the three values below
//   2. Save
//   3. Restart the server
//   4. Test in-game (third person is easiest to judge)
//
// The weapon Entity gets these local values when we call setParent(..., handAnchor, pos, rot).
// ============================================================

export const WEAPON_LOCAL_POSITION = { x: 0.09, y: -0.09, z: -0.30 };
export const WEAPON_LOCAL_ROTATION = { x: 0, y: -0.7071, z: 0, w: 0.7071 }; // Current: -90° Y
// export const WEAPON_LOCAL_ROTATION = { x: 0, y: 0.7071, z: 0, w: 0.7071 }; // Try this instead (flipped Y) if gun is still sideways
export const WEAPON_LOCAL_SCALE = 0.9;

// (You can later expand this into a per-weapon pose map if you add more guns)
// ============================================================

// Re-export for convenience so other files can use the same source of truth
export { WEAPON_DEFINITIONS, getWeaponDefinition } from "./weapons/WeaponDefinitions";

// For internal use we still reference the map
const WEAPON_DEFS = WEAPON_DEFINITIONS;

export class WeaponManager {
  private static currentWeaponKey: string | null = "m4a4";
  private static readonly weaponSway = new WeaponSway();

  // Per-player attached weapon entities (unified for FP + TP using hand anchors)
  private static attachedWeapons = new Map<string, Entity>();

  // Store the base local position used when attaching (for sway calculations)
  private static weaponBaseLocalPositions = new Map<string, Vector3Like>();

  private static canSetViewModel(player: Player): boolean {
    return player.camera.attachedToEntity !== undefined;
  }

  /**
   * Equip a weapon for a player (just sets which weapon definition is active).
   */
  static equipWeapon(player: Player, weaponKey: string = "m4a4") {
    this.currentWeaponKey = weaponKey;
  }

  /**
   * Safe, idempotent method to ensure the current weapon is attached as an Entity
   * to the player's hand anchor. 
   * 
   * This should be the main entry point called from:
   * - Initial spawn
   * - Camera mode switches (1st/3rd person)
   * - Reconnects / respawns
   */
  static ensureWeaponAttached(player: Player, playerEntity?: PlayerEntity, world?: any): void {
    if (!playerEntity || !world) return;

    const def = this.getCurrentWeaponDef();
    if (!def) return;

    // If we don't have an attached weapon for this player, create it
    if (!this.attachedWeapons.has(player.id)) {
      this.attachWeaponToHand(player, playerEntity, world);
    }

    // TEMP DIAGNOSTIC: keep leg movement working without the gun idle arm pose.
    this.setNormalMovementAnimations(playerEntity);
  }

  static getCurrentWeaponKey(): string | null {
    return this.currentWeaponKey;
  }

  static getCurrentWeaponDef(): WeaponDefinition | null {
    if (!this.currentWeaponKey) return null;
    return getWeaponDefinition(this.currentWeaponKey) ?? null;
  }

  /**
   * Returns the currently attached weapon entity for a player (if any).
   * Other systems (shooting, VFX, animations) can use this to drive effects on the visual weapon.
   */
  static getAttachedWeapon(player: Player): Entity | undefined {
    return this.attachedWeapons.get(player.id);
  }

  static getWeaponBaseLocalPosition(player: Player): Vector3Like | undefined {
    return this.weaponBaseLocalPositions.get(player.id);
  }

  /**
   * Returns the world-space position of the weapon's muzzle for accurate shooting origin.
   * Falls back to the weapon's root position if no muzzleOffset is defined.
   */
  static getMuzzleWorldPosition(player: Player): Vector3Like | undefined {
    const weapon = this.attachedWeapons.get(player.id);
    if (!weapon) return undefined;

    const def = this.getCurrentWeaponDef();
    if (!def || !def.muzzleOffset) {
      return weapon.position;
    }

    // For a more accurate implementation, we would transform the muzzleOffset
    // by the weapon's world rotation. For now, we add it directly (works reasonably
    // when the weapon is roughly aligned with world axes after hand pose).
    // TODO: Proper rotation transform when we have access to the weapon's quaternion.
    return {
      x: weapon.position.x + (def.muzzleOffset.x || 0),
      y: weapon.position.y + (def.muzzleOffset.y || 0),
      z: weapon.position.z + (def.muzzleOffset.z || 0),
    };
  }

  /**
   * Triggers the shoot animation on the player model for the current weapon.
   * This follows the official Hytopia zombies-fps pattern where the player model
   * has gun-specific animations (idle_gun_right, shoot_gun_right, etc.).
   */
  static triggerShootAnimation(playerEntity: PlayerEntity): void {
    const def = this.getCurrentWeaponDef();
    if (!def || !playerEntity) return;

    // Map weapon to animation name.
    // For right-handed guns we use shoot_gun_right / idle_gun_right.
    // Future: Move this mapping into WeaponDefinition.
    const animName = "shoot_gun_right";
    playerEntity.getModelAnimation(animName)?.restart();
  }

  /**
   * Sets the appropriate idle gun animation on the player when a weapon is equipped.
   * Called during equip flows for better animation state (official pattern).
   */
  static setEquippedIdleAnimations(playerEntity: PlayerEntity): void {
    const def = this.getCurrentWeaponDef();
    if (!def || !playerEntity) return;

    const ctrl = playerEntity.controller as any;
    if (!ctrl) return;

    // For m4a4-style right hand weapons
    const gunIdle = "idle_gun_right";

    ctrl.idleLoopedAnimations = [gunIdle, "idle_lower"];
    ctrl.walkLoopedAnimations = [gunIdle, "walk_lower"];
    ctrl.runLoopedAnimations = [gunIdle, "run_lower"];
  }

  /**
   * Diagnostic animation baseline: keep the soldier's normal lower-body movement
   * loops active without forcing the gun-specific upper-body idle pose.
   */
  static setNormalMovementAnimations(playerEntity: PlayerEntity): void {
    if (!playerEntity) return;

    const ctrl = playerEntity.controller as any;
    if (!ctrl) return;

    ctrl.idleLoopedAnimations = ["idle_lower"];
    ctrl.walkLoopedAnimations = ["walk_lower"];
    ctrl.runLoopedAnimations = ["run_lower"];
  }

  /**
   * Remove weapon from player completely.
   */
  static removeCurrentWeapon(player: Player) {
    this.currentWeaponKey = null;
    this.detachAttachedWeapon(player);

    if (this.canSetViewModel(player)) {
      player.camera.setViewModel(undefined);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // FIRST PERSON
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Activate first-person viewmodel for the weapon.
   */
  static equipFirstPerson(player: Player, playerEntity?: PlayerEntity): void {
    this.weaponSway.reset(player);

    const def = this.getCurrentWeaponDef();
    if (!def) return;

    // The attached weapon (on hand_right_anchor) should already exist from equipThirdPerson / initial equip.
    // We rely on setViewModelHiddenNodes to hide the body so the weapon becomes visible in FP.
    if (playerEntity && !this.attachedWeapons.has(player.id)) {
      // Re-attach if missing (can happen on mode switches or reconnects)
      // We need the world here — for now we rely on previous attachment.
      // Future improvement: store world reference or re-attach on demand.
    }

    // Future improvement: Set a dedicated FP viewModel (arms + gun) here once you have proper first-person assets.
    // For now we rely on the attached worldModel + body hiding.
    if (def.viewModel && this.canSetViewModel(player)) {
      player.camera.setViewModel(def.viewModel);
    }

    player.camera.setViewModelShownNodes([]);
    player.camera.setViewModelHiddenNodes(FP_VIEW_HIDDEN_NODES);
    player.camera.setViewModelPitchesWithCamera(true);
    player.camera.setViewModelYawsWithCamera(true);

    if (playerEntity?.isSpawned) {
      playerEntity.getModelNodeOverride("*")?.setHidden(true);
    }

    if (playerEntity) {
      // TEMP DIAGNOSTIC: this.setEquippedIdleAnimations(playerEntity);
      this.setNormalMovementAnimations(playerEntity);
    }

    console.log(`[WeaponManager] First person activated for player ${player.id} - body hidden, weapon should be visible on hands`);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // THIRD PERSON / GENERAL EQUIP (Official attached-entity pattern)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Activate for third-person (or general equipped state).
   * Attaches the weapon to the player's hand anchor node (the correct Hytopia way).
   */
  static equipThirdPerson(player: Player, playerEntity?: PlayerEntity, world?: any): void {
    this.weaponSway.reset(player);

    // Clear FP viewmodel state
    player.camera.setViewModelShownNodes([]);
    player.camera.setViewModelHiddenNodes([]);
    if (this.canSetViewModel(player)) {
      player.camera.setViewModel(undefined);
    }

    // Show full player body
    if (playerEntity?.isSpawned) {
      playerEntity.getModelNodeOverride("*")?.setHidden(false);
    }

    if (playerEntity && world) {
      this.attachWeaponToHand(player, playerEntity, world);
    }

    if (playerEntity) {
      // TEMP DIAGNOSTIC: this.setEquippedIdleAnimations(playerEntity);
      this.setNormalMovementAnimations(playerEntity);
    }

    console.log(`[WeaponManager] Third person mode for player ${player.id} - full body + weapon on hand`);
  }

  /**
   * Attach weapon as an Entity to the hand anchor on the player model.
   * This is the pattern used in the official Hytopia zombies-fps example.
   */
  private static attachWeaponToHand(player: Player, playerEntity: PlayerEntity, world: any): void {
    this.detachAttachedWeapon(player);

    const def = this.getCurrentWeaponDef();
    if (!def || !world) return;

    // Use the definition's scale if present, otherwise fall back to the global constant
    const finalScale = def.scale ?? WEAPON_LOCAL_SCALE;

    // Defensive check: make sure the player model actually has the expected anchor node.
    // If not, the weapon will spawn but won't be properly attached.
    const hasAnchor = !!playerEntity.getModelNodeOverride(def.handAnchor);
    if (!hasAnchor) {
      console.warn(`[WeaponManager] Player model is missing expected hand anchor "${def.handAnchor}". Weapon may not attach correctly.`);
    }

    const weaponEntity = new Entity({
      modelUri: def.worldModel,
      modelScale: finalScale,
    });

    // Spawn the weapon in the world first (required by the engine during join),
    // then immediately parent it to the hand bone with the tuned local transform.
    weaponEntity.spawn(world, playerEntity.position);

    // Apply the hand pose (see the "WEAPON HAND POSE" section near the top of this file)
    weaponEntity.setParent(
      playerEntity,
      def.handAnchor,
      WEAPON_LOCAL_POSITION,
      WEAPON_LOCAL_ROTATION
    );

    console.log(`[WeaponManager] Attached weapon "${def.name}" to player ${player.id} on anchor "${def.handAnchor}"`);
    console.log(`[WeaponManager] Using local pos:`, WEAPON_LOCAL_POSITION, "rot:", WEAPON_LOCAL_ROTATION, "scale:", finalScale);
    console.log(`[WeaponManager] If the gun looks sideways or floating, the local transform above is wrong for your m4a4 + soldier-player combo. Edit the constants at the top of this file.`);

    this.attachedWeapons.set(player.id, weaponEntity);
    this.weaponBaseLocalPositions.set(player.id, { ...WEAPON_LOCAL_POSITION });
  }

  private static detachAttachedWeapon(player: Player): void {
    const existing = this.attachedWeapons.get(player.id);
    if (existing) {
      try {
        if (existing.isSpawned) existing.despawn();
      } catch {}
      this.attachedWeapons.delete(player.id);
    }
    this.weaponBaseLocalPositions.delete(player.id);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SWAY (only applies in first person)
  // ──────────────────────────────────────────────────────────────────────────

  static tickFirstPersonSway(
    player: Player,
    playerEntity: PlayerEntity | undefined,
    deltaSeconds: number,
    baseCameraOffset: Vector3Like,
    baseForwardOffset: number,
    attachedWeapon?: Entity,
    baseWeaponLocalPosition?: Vector3Like
  ): void {
    if (!playerEntity || player.camera.mode !== PlayerCameraMode.FIRST_PERSON) {
      this.weaponSway.reset(player);
      return;
    }

    this.weaponSway.tickFirstPerson({
      player,
      playerEntity,
      deltaSeconds,
      baseCameraOffset,
      baseForwardOffset,
      attachedWeapon,
      baseWeaponLocalPosition,
    });
  }

  /**
   * Cleanup when player leaves.
   */
  static onPlayerLeft(player: Player) {
    this.detachAttachedWeapon(player);
  }
}
