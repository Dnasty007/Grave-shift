import { type Player } from "hytopia";

/**
 * WeaponManager — camera-side weapon presentation only.
 *
 * The gun system itself is now a faithful port of the official Hytopia zombies-fps
 * example (see src/server/guns/). Guns are GunEntity instances parented to the
 * player's hand anchor at construction; they own their model, ammo, audio, muzzle
 * flash, and raycast shooting. GehennaDirector owns equipping and damage.
 *
 * What remains here:
 *  - First/third person body visibility (official hidden-nodes list)
 *  - ADS (aim-down-sights) FOV lerp on right mouse
 */

// Official zombies-fps first-person hidden nodes for the soldier-player.gltf rig.
// setViewModelHiddenNodes hides matching node-name substrings on the attached
// player model — body disappears, arms + held gun remain.
const FP_HIDDEN_NODES = ["head", "neck", "torso", "leg_right", "leg_left"];

export class WeaponManager {
  // ──────────────────────────────────────────────────────────────────────────
  // First / third person visibility
  // ──────────────────────────────────────────────────────────────────────────

  /** First person: hide the body so only arms + the held gun render (official). */
  static equipFirstPerson(player: Player): void {
    player.camera.setViewModelShownNodes([]);
    player.camera.setViewModelHiddenNodes(FP_HIDDEN_NODES);
  }

  /** Third person: clear the FP filters so the full body + gun show. */
  static equipThirdPerson(player: Player): void {
    player.camera.setViewModelHiddenNodes([]);
    player.camera.setViewModelShownNodes([]);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // ADS (Aim Down Sights) — right mouse. Pure FOV lerp, the universal FPS trick.
  // ──────────────────────────────────────────────────────────────────────────

  private static _currentFov: number | null = null;
  private static _adsActive = false;

  /** Drive ADS each tick from the right-mouse state. Smoothly lerps camera FOV. */
  static tickAds(player: Player, dtS: number, aiming: boolean, hipFov = 75, adsFov = 50): void {
    this._adsActive = aiming;

    const targetFov = aiming ? adsFov : hipFov;
    const cur = this._currentFov ?? hipFov;
    const k = 1 - Math.exp(-14 * dtS);          // ~70 ms time constant — snappy, not instant
    const next = cur + (targetFov - cur) * k;
    this._currentFov = next;
    try { player.camera.setFov(next); } catch {}
  }

  static isAds(): boolean {
    return this._adsActive;
  }
}
