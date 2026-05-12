import * as pc from "playcanvas";
import type { Weapon, WeaponId } from "./Weapon";

type ViewState = {
  bobPhase: number;
  recoilOffset: number;
  reloadProgress: number;
  swapProgress: number;
};

type WeaponAssetEntry = {
  asset: pc.Asset;
};

/**
 * First-person weapon viewmodel: Blockbench/Hytopia glTF model + procedural gloved hands.
 *
 * Hands are always procedural (dark glove boxes) — they show regardless of whether the
 * weapon uses a glTF or the procedural fallback model. Hand positions auto-switch between
 * GLTF and procedural layouts via `repositionHands()`.
 *
 * ADS (aim-down-sights, right mouse):
 *   - Weapon lerps from hip position to a centered ADS position
 *   - For sniper weapons (isSniperWeapon=true), the root is hidden once fully scoped
 *   - Sway, bob, and strafe tilt all blend out as adsProgress → 1
 */
export class WeaponViewmodel {
  readonly root = new pc.Entity("weapon-viewmodel");

  private readonly weaponAssets: ReadonlyMap<WeaponId, WeaponAssetEntry>;

  // ── Weapon body materials ─────────────────────────────────────────────────
  private readonly bodyMaterial = new pc.StandardMaterial();
  private readonly accentMaterial = new pc.StandardMaterial();
  private readonly muzzleMaterial = new pc.StandardMaterial();

  // ── Procedural weapon parts ───────────────────────────────────────────────
  private readonly stock = new pc.Entity("stock");
  private readonly barrel = new pc.Entity("barrel");
  private readonly grip = new pc.Entity("grip");
  private readonly muzzle = new pc.Entity("muzzle");
  private readonly proceduralRenders: pc.RenderComponent[] = [];

  // ── Gloved hand geometry (always procedural, shown in both GLTF + proc mode) ─
  private readonly handMaterial = new pc.StandardMaterial();
  private readonly rightHand = new pc.Entity("rhand");
  private readonly rightForearm = new pc.Entity("rforearm");
  private readonly leftHand = new pc.Entity("lhand");

  // ── Animation state ───────────────────────────────────────────────────────
  private state: ViewState = {
    bobPhase: 0,
    recoilOffset: 0,
    reloadProgress: 0,
    swapProgress: 0
  };

  private currentWeapon: Weapon | null = null;
  private currentWeaponIdForGltf: WeaponId | null = null;
  private gltfEntity: pc.Entity | null = null;
  private muzzleFlashTimer = 0;
  private isReloading = false;
  private wasReloading = false;
  private swapDirection: 1 | -1 | 0 = 0;
  private useProceduralModel = true;

  // ── ADS / feel state ──────────────────────────────────────────────────────
  private adsProgress = 0;           // 0 = hip, 1 = ADS (lerps smoothly)
  private recoilSideKick = 0;        // horizontal recoil pulse per shot
  private swayX = 0;                 // weapon lag X from camera movement
  private swayY = 0;                 // weapon lag Y from camera movement
  private drawEnabled = true;        // from setDrawEnabled()
  private scoping = false;           // true when sniper + fully ADS'd (hides root)

  constructor(parent: pc.Entity, weaponAssets: ReadonlyMap<WeaponId, WeaponAssetEntry>) {
    this.weaponAssets = weaponAssets;

    // ── Weapon body ───────────────────────────────────────────────────────
    this.bodyMaterial.diffuse = new pc.Color(0.2, 0.2, 0.21);
    this.bodyMaterial.emissive = new pc.Color(0.025, 0.022, 0.02);
    this.bodyMaterial.update();

    this.accentMaterial.diffuse = new pc.Color(0.6, 0.32, 0.12);
    this.accentMaterial.emissive = new pc.Color(0.18, 0.08, 0.02);
    this.accentMaterial.update();

    this.muzzleMaterial.diffuse = new pc.Color(0, 0, 0);
    this.muzzleMaterial.emissive = new pc.Color(2.8, 1.6, 0.6);
    this.muzzleMaterial.useLighting = false;
    this.muzzleMaterial.opacity = 0;
    this.muzzleMaterial.blendType = pc.BLEND_ADDITIVE;
    this.muzzleMaterial.update();

    // ── Glove material ────────────────────────────────────────────────────
    // Unlit dark-brown tactical gloves — always visible regardless of scene lighting.
    // useLighting = false means the emissive colour is exactly what you see.
    this.handMaterial.useLighting = false;
    this.handMaterial.emissive = new pc.Color(0.21, 0.15, 0.09);
    this.handMaterial.update();

    // ── Procedural weapon geometry ────────────────────────────────────────
    this.stock.addComponent("render", { type: "box", material: this.bodyMaterial });
    this.stock.setLocalScale(0.16, 0.18, 0.34);
    this.stock.setLocalPosition(0, 0, -0.16);
    this.proceduralRenders.push(this.stock.render!);

    this.barrel.addComponent("render", { type: "box", material: this.bodyMaterial });
    this.barrel.setLocalScale(0.06, 0.07, 0.5);
    this.barrel.setLocalPosition(0, 0.04, 0.18);
    this.proceduralRenders.push(this.barrel.render!);

    this.grip.addComponent("render", { type: "box", material: this.accentMaterial });
    this.grip.setLocalScale(0.1, 0.18, 0.12);
    this.grip.setLocalPosition(0, -0.12, -0.04);
    this.proceduralRenders.push(this.grip.render!);

    this.muzzle.addComponent("render", { type: "sphere", material: this.muzzleMaterial });
    this.muzzle.setLocalScale(0.22, 0.22, 0.22);
    this.muzzle.setLocalPosition(0, 0.04, 0.46);

    this.root.addChild(this.stock);
    this.root.addChild(this.barrel);
    this.root.addChild(this.grip);
    this.root.addChild(this.muzzle);

    // ── Hand geometry (right hand wraps trigger/grip, left supports forend) ─
    this.rightHand.addComponent("render", { type: "box", material: this.handMaterial });
    this.rightForearm.addComponent("render", { type: "box", material: this.handMaterial });
    this.leftHand.addComponent("render", { type: "box", material: this.handMaterial });

    this.root.addChild(this.rightHand);
    this.root.addChild(this.rightForearm);
    this.root.addChild(this.leftHand);

    // Start in procedural positions
    this.repositionHands(true);

    this.root.setLocalPosition(0.32, -0.28, -0.55);
    this.root.setLocalEulerAngles(0, 4, 0);

    parent.addChild(this.root);
  }

  // ── Hand positioning: switch between GLTF and procedural weapon layouts ──

  /**
   * Repositions and re-scales the three hand boxes to match the active weapon model type.
   *
   * Procedural model has its grip box at root-local (0, -0.12, -0.04).
   * GLTF weapons sit at gunPos ≈ (0.32, -0.26, -0.48) within root-local space, so hand
   * anchors are placed in that area with anatomical tilts (forearm angles down-forward,
   * wrist carries slight inward rotation).
   */
  private repositionHands(procedural: boolean): void {
    if (procedural) {
      // ── Procedural model ──────────────────────────────────────────────
      this.rightHand.setLocalScale(0.10, 0.12, 0.16);
      this.rightHand.setLocalPosition(0.01, -0.19, -0.03);
      this.rightHand.setLocalEulerAngles(0, 0, 0);

      this.rightForearm.setLocalScale(0.08, 0.09, 0.28);
      this.rightForearm.setLocalPosition(0.02, -0.14, -0.20);
      this.rightForearm.setLocalEulerAngles(-14, 0, 0);

      this.leftHand.setLocalScale(0.09, 0.085, 0.14);
      this.leftHand.setLocalPosition(-0.03, -0.05, 0.15);
      this.leftHand.setLocalEulerAngles(-5, 0, 0);
    } else {
      // ── GLTF model ────────────────────────────────────────────────────
      // gunPos ≈ (0.32, -0.26, -0.48) is the GLTF anchor; grip is slightly below/forward of that.
      // Hands are intentionally smaller — the detailed gun mesh carries the visual weight.
      // The forearm angles downward (~-20°) so the bottom of it naturally clips off-screen,
      // giving the impression of arms coming from below rather than floating boxes.

      // Right hand: wraps the pistol grip / trigger guard
      this.rightHand.setLocalScale(0.082, 0.092, 0.12);
      this.rightHand.setLocalPosition(0.30, -0.34, -0.40);
      this.rightHand.setLocalEulerAngles(-10, 0, 6);

      // Right forearm: extends from the grip back toward the player (z becomes less negative)
      // angled downward so it disappears off the bottom edge naturally
      this.rightForearm.setLocalScale(0.065, 0.072, 0.22);
      this.rightForearm.setLocalPosition(0.28, -0.27, -0.18);
      this.rightForearm.setLocalEulerAngles(-20, 0, 4);

      // Left hand: under the forend / front of the gun (more forward, slightly left)
      this.leftHand.setLocalScale(0.078, 0.068, 0.10);
      this.leftHand.setLocalPosition(0.15, -0.31, -0.60);
      this.leftHand.setLocalEulerAngles(-8, -12, 3);
    }
  }

  private lastPackTier = -1;

  setWeapon(weapon: Weapon): void {
    if (
      this.currentWeapon === weapon &&
      !this.useProceduralModel &&
      this.lastPackTier === weapon.packAPunchTier
    ) {
      return;
    }
    this.lastPackTier = weapon.packAPunchTier;
    this.currentWeapon = weapon;
    this.swapDirection = 1;
    this.state.swapProgress = 0;

    this.applyProceduralMaterials(weapon);

    const vm = weapon.definition.viewModelGltf;
    const entry = vm ? this.weaponAssets.get(weapon.definition.id as WeaponId) : undefined;
    const resource = entry?.asset.resource as pc.ContainerResource | null | undefined;

    const ent =
      vm && resource && typeof resource.instantiateRenderEntity === "function"
        ? this.instantiateWeaponHierarchy(resource)
        : null;

    if (vm && ent) {
      this.clearGltfEntity();
      ent.name = `weapon-gltf-${weapon.definition.id}`;
      const s = vm.scale;
      ent.setLocalScale(s, s, s);
      ent.setLocalPosition(vm.position[0], vm.position[1], vm.position[2]);
      ent.setLocalEulerAngles(vm.eulerDegrees[0], vm.eulerDegrees[1], vm.eulerDegrees[2]);
      this.root.addChild(ent);
      this.gltfEntity = ent;
      this.currentWeaponIdForGltf = weapon.definition.id as WeaponId;
      this.useProceduralModel = false;
      this.setProceduralPartsVisible(false);
      this.repositionHands(false);
    } else {
      if (vm && entry?.asset && !entry.asset.resource) {
        // Still loading — keep procedural placeholder visible.
      } else if (vm && entry?.asset.resource) {
        console.warn(
          `[WeaponViewmodel] GLB for "${weapon.definition.id}" had no render/model geometry (check file / export).`
        );
      }
      this.useProceduralFallback(weapon.definition.id as WeaponId);
    }

    this.positionMuzzleForCurrentMode(weapon);
    this.syncMuzzleMeshVisible();
  }

  /** Call when a weapon container finished loading (same tick as `setWeapon` may have missed resource). */
  refreshIfCurrent(weaponId: WeaponId): void {
    const w = this.currentWeapon;
    if (!w || w.definition.id !== weaponId) return;
    this.setWeapon(w);
  }

  private useProceduralFallback(_weaponId: WeaponId): void {
    this.clearGltfEntity();
    this.currentWeaponIdForGltf = null;
    this.useProceduralModel = true;
    this.setProceduralPartsVisible(true);
    this.repositionHands(true);
    if (this.currentWeapon) {
      this.positionMuzzleForCurrentMode(this.currentWeapon);
    }
    this.syncMuzzleMeshVisible();
  }

  private clearGltfEntity(): void {
    if (this.gltfEntity) {
      this.gltfEntity.destroy();
      this.gltfEntity = null;
    }
    this.currentWeaponIdForGltf = null;
  }

  private instantiateWeaponHierarchy(resource: pc.ContainerResource): pc.Entity | null {
    const opt = { castShadows: false };
    try {
      const renderRoot = resource.instantiateRenderEntity(opt);
      const renders = renderRoot.findComponents("render");
      if (renders.length > 0) return renderRoot;
      renderRoot.destroy();
    } catch (e) {
      console.warn("[WeaponViewmodel] instantiateRenderEntity failed:", e);
    }
    try {
      const modelRoot = resource.instantiateModelEntity(opt);
      const models = modelRoot.findComponents("model");
      if (models.length > 0) return modelRoot;
      modelRoot.destroy();
    } catch (e) {
      console.warn("[WeaponViewmodel] instantiateModelEntity failed:", e);
    }
    return null;
  }

  private setProceduralPartsVisible(visible: boolean): void {
    for (let i = 0; i < this.proceduralRenders.length; i++) {
      const r = this.proceduralRenders[i];
      if (r) r.enabled = visible;
    }
  }

  private applyProceduralMaterials(weapon: Weapon): void {
    const tier = weapon.packAPunchTier;
    const pap = tier > 0 ? Math.min(1, tier * 0.18) : 0;
    const tint = weapon.definition.viewModelTint;
    const r = Math.min(1, tint[0] + pap * 0.55);
    const g = Math.max(0.04, tint[1] * (1 - pap * 0.38));
    const b = Math.max(0.04, tint[2] * (1 - pap * 0.45));
    this.bodyMaterial.diffuse.set(r, g, b);
    this.bodyMaterial.update();

    this.accentMaterial.diffuse.set(
      Math.min(1, r + 0.22 + pap * 0.2),
      Math.max(0.04, g * 0.85),
      Math.max(0.04, b * 0.55)
    );
    this.accentMaterial.update();

    const length = weapon.definition.viewModelLength;
    this.barrel.setLocalScale(0.06, 0.07, length);
    this.barrel.setLocalPosition(0, 0.04, length * 0.4);
  }

  private positionMuzzleForCurrentMode(weapon: Weapon): void {
    const length = weapon.definition.viewModelLength;
    if (this.useProceduralModel) {
      this.muzzle.setLocalPosition(0, 0.04, length * 0.92);
    } else {
      const vm = weapon.definition.viewModelGltf;
      const forwardZ = vm ? vm.position[2] - 0.08 : -0.35;
      this.muzzle.setLocalPosition(0.02, 0.02, forwardZ);
    }
  }

  private syncMuzzleMeshVisible(): void {
    const r = this.muzzle.render;
    if (!r) return;
    r.enabled = this.useProceduralModel || this.muzzleFlashTimer > 0.001;
  }

  /**
   * Main per-frame update.
   *
   * @param options.isADS       Right-mouse ADS held
   * @param options.isSniperWeapon  If true, hides viewmodel when fully scoped
   * @param options.lookDeltaX  Raw scaled yaw delta this frame (for weapon lag/sway)
   * @param options.lookDeltaY  Raw scaled pitch delta this frame
   * @param options.strafeInput Normalised X move input −1..1 (for strafe tilt)
   */
  update(
    dt: number,
    options: {
      moveSpeed: number;
      isFiring: boolean;
      didFire: boolean;
      isReloading: boolean;
      isADS?: boolean;
      isSniperWeapon?: boolean;
      lookDeltaX?: number;
      lookDeltaY?: number;
      strafeInput?: number;
    }
  ): void {
    const isADS = (options.isADS ?? false) && !options.isReloading;
    const isSniper = options.isSniperWeapon ?? false;

    // ── ADS lerp ─────────────────────────────────────────────────────────
    const adsTarget = isADS ? 1 : 0;
    this.adsProgress += (adsTarget - this.adsProgress) * Math.min(1, dt * 10);

    // Sniper scope: hide weapon model when nearly fully scoped
    const nowScoping = isSniper && this.adsProgress > 0.88;
    if (nowScoping !== this.scoping) {
      this.scoping = nowScoping;
      this.root.enabled = this.drawEnabled && !this.scoping;
    }

    if (this.scoping) return; // nothing else to do while fully scoped

    // ── Timers ────────────────────────────────────────────────────────────
    this.state.bobPhase += dt * (options.moveSpeed > 0.01 ? 8 : 1.4);
    this.state.recoilOffset = Math.max(0, this.state.recoilOffset - dt * 8);
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);

    // ── Shot impulses ─────────────────────────────────────────────────────
    if (options.didFire && this.currentWeapon) {
      const kick = this.currentWeapon.definition.recoilKick;
      this.state.recoilOffset = Math.min(0.30, this.state.recoilOffset + kick * 1.8);
      this.recoilSideKick = (Math.random() - 0.5) * kick * 3.5;
      this.muzzleFlashTimer = 0.075;
    }
    // Horizontal kick recovers quickly
    this.recoilSideKick *= Math.max(0, 1 - dt * 9);

    // ── Camera-lag weapon sway ────────────────────────────────────────────
    const rawLookX = options.lookDeltaX ?? 0;
    const rawLookY = options.lookDeltaY ?? 0;
    const swayStr = 1 - this.adsProgress * 0.6;
    this.swayX += (-rawLookX * 0.0018 * swayStr - this.swayX) * Math.min(1, dt * 5.5);
    this.swayY += (-rawLookY * 0.0012 * swayStr - this.swayY) * Math.min(1, dt * 5.5);
    this.swayX = Math.max(-0.045, Math.min(0.045, this.swayX));
    this.swayY = Math.max(-0.032, Math.min(0.032, this.swayY));

    // ── Reload animation ──────────────────────────────────────────────────
    this.isReloading = options.isReloading;
    if (this.isReloading) {
      const reloadDuration = this.currentWeapon?.definition.reloadSeconds ?? 1.5;
      this.state.reloadProgress += dt / reloadDuration;
      if (this.state.reloadProgress > 1) this.state.reloadProgress = 1;
    } else if (this.wasReloading) {
      this.state.reloadProgress = 0;
    } else {
      this.state.reloadProgress = 0;
    }
    this.wasReloading = this.isReloading;

    // ── Weapon swap dip ───────────────────────────────────────────────────
    if (this.swapDirection !== 0) {
      this.state.swapProgress += dt * 5;
      if (this.state.swapProgress >= 1) {
        this.state.swapProgress = 1;
        this.swapDirection = 0;
      }
    }

    // ── Movement bob (suppressed when ADS) ───────────────────────────────
    const hipFrac = 1 - this.adsProgress;
    const bobAmp = hipFrac * Math.min(1, options.moveSpeed * 0.6);
    const bobX = Math.sin(this.state.bobPhase) * 0.012 * bobAmp;
    const bobY = Math.abs(Math.cos(this.state.bobPhase)) * 0.014 * bobAmp;

    // ── Reload & swap offsets ─────────────────────────────────────────────
    const reloadTilt = this.isReloading ? Math.sin(this.state.reloadProgress * Math.PI) * -32 : 0;
    const reloadDip  = this.isReloading ? Math.sin(this.state.reloadProgress * Math.PI) * -0.18 : 0;
    const swapDip = (1 - this.state.swapProgress) * -0.32;

    // ── Recoil Z ─────────────────────────────────────────────────────────
    const recoilZ = this.state.recoilOffset;

    // ── Hip vs ADS position ───────────────────────────────────────────────
    // Hip: lower-right corner, gun well out of the way. ADS: raised to eye line, centered.
    const hipX = 0.34; const hipY = -0.30; const hipZ = -0.52;
    const adsX = 0.00; const adsY = -0.04; const adsZ = -0.44;

    const finalX = hipX + (adsX - hipX) * this.adsProgress
      + bobX + this.swayX + this.recoilSideKick * hipFrac;
    const finalY = hipY + (adsY - hipY) * this.adsProgress
      + bobY + reloadDip + swapDip + this.swayY;
    const finalZ = (hipZ + (adsZ - hipZ) * this.adsProgress) - recoilZ;

    this.root.setLocalPosition(finalX, finalY, finalZ);

    // ── Strafe tilt + natural cant + recoil pitch ─────────────────────────
    // -5° Z roll = natural gun cant so it reads as "held" rather than floating
    // Strafe adds extra tilt in the opposite direction of movement
    const baseCant = -5 * hipFrac;
    const strafeTilt = (options.strafeInput ?? 0) * -3.0 * hipFrac + baseCant;
    const recoilPitch = reloadTilt - this.state.recoilOffset * 80 * (1 - this.adsProgress * 0.55);
    const yawNudge = 4 * hipFrac; // slight inward yaw

    this.root.setLocalEulerAngles(recoilPitch, yawNudge, strafeTilt);

    // ── Muzzle flash ──────────────────────────────────────────────────────
    const flashT = this.muzzleFlashTimer / 0.075;
    this.muzzleMaterial.opacity = flashT;
    this.muzzleMaterial.update();
    const flashScale = 0.22 + flashT * 0.30;
    this.muzzle.setLocalScale(flashScale, flashScale, flashScale);
    this.syncMuzzleMeshVisible();
  }

  /** Hide FPS gun + muzzle (third-person mode or scope overlay active). */
  setDrawEnabled(visible: boolean): void {
    this.drawEnabled = visible;
    this.root.enabled = visible && !this.scoping;
  }
}
