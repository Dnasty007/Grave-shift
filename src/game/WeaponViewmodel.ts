import * as pc from "playcanvas";
import type { Weapon } from "./Weapon";

type ViewState = {
  bobPhase: number;
  recoilOffset: number;
  reloadProgress: number;
  swapProgress: number;
};

export class WeaponViewmodel {
  readonly root = new pc.Entity("weapon-viewmodel");

  private readonly bodyMaterial = new pc.StandardMaterial();
  private readonly accentMaterial = new pc.StandardMaterial();
  private readonly muzzleMaterial = new pc.StandardMaterial();

  private readonly stock = new pc.Entity("stock");
  private readonly barrel = new pc.Entity("barrel");
  private readonly grip = new pc.Entity("grip");
  private readonly muzzle = new pc.Entity("muzzle");

  private state: ViewState = {
    bobPhase: 0,
    recoilOffset: 0,
    reloadProgress: 0,
    swapProgress: 0
  };

  private currentWeapon: Weapon | null = null;
  private muzzleFlashTimer = 0;
  private isReloading = false;
  private wasReloading = false;
  private swapDirection: 1 | -1 | 0 = 0;

  constructor(parent: pc.Entity) {
    this.bodyMaterial.diffuse = new pc.Color(0.2, 0.2, 0.21);
    this.bodyMaterial.emissive = new pc.Color(0.025, 0.022, 0.02);
    this.bodyMaterial.update();

    this.accentMaterial.diffuse = new pc.Color(0.6, 0.32, 0.12);
    this.accentMaterial.emissive = new pc.Color(0.18, 0.08, 0.02);
    this.accentMaterial.update();

    this.muzzleMaterial.diffuse = new pc.Color(0, 0, 0);
    this.muzzleMaterial.emissive = new pc.Color(2.4, 1.4, 0.5);
    this.muzzleMaterial.useLighting = false;
    this.muzzleMaterial.opacity = 0;
    this.muzzleMaterial.blendType = pc.BLEND_ADDITIVE;
    this.muzzleMaterial.update();

    this.stock.addComponent("render", { type: "box", material: this.bodyMaterial });
    this.stock.setLocalScale(0.16, 0.18, 0.34);
    this.stock.setLocalPosition(0, 0, -0.16);

    this.barrel.addComponent("render", { type: "box", material: this.bodyMaterial });
    this.barrel.setLocalScale(0.06, 0.07, 0.5);
    this.barrel.setLocalPosition(0, 0.04, 0.18);

    this.grip.addComponent("render", { type: "box", material: this.accentMaterial });
    this.grip.setLocalScale(0.1, 0.18, 0.12);
    this.grip.setLocalPosition(0, -0.12, -0.04);

    this.muzzle.addComponent("render", { type: "sphere", material: this.muzzleMaterial });
    this.muzzle.setLocalScale(0.18, 0.18, 0.18);
    this.muzzle.setLocalPosition(0, 0.04, 0.46);

    this.root.addChild(this.stock);
    this.root.addChild(this.barrel);
    this.root.addChild(this.grip);
    this.root.addChild(this.muzzle);

    this.root.setLocalPosition(0.32, -0.28, -0.55);
    this.root.setLocalEulerAngles(0, 4, 0);

    parent.addChild(this.root);
  }

  setWeapon(weapon: Weapon): void {
    if (this.currentWeapon === weapon) return;
    this.currentWeapon = weapon;
    this.swapDirection = 1;
    this.state.swapProgress = 0;

    const tint = weapon.definition.viewModelTint;
    this.bodyMaterial.diffuse.set(tint[0], tint[1], tint[2]);
    this.bodyMaterial.update();

    this.accentMaterial.diffuse.set(
      Math.min(1, tint[0] + 0.3),
      Math.max(0.04, tint[1] * 0.9),
      tint[2] * 0.6
    );
    this.accentMaterial.update();

    const length = weapon.definition.viewModelLength;
    this.barrel.setLocalScale(0.06, 0.07, length);
    this.barrel.setLocalPosition(0, 0.04, length * 0.4);
    this.muzzle.setLocalPosition(0, 0.04, length * 0.92);
  }

  update(dt: number, options: {
    moveSpeed: number;
    isFiring: boolean;
    didFire: boolean;
    isReloading: boolean;
  }): void {
    this.state.bobPhase += dt * (options.moveSpeed > 0.01 ? 8 : 1.4);
    this.state.recoilOffset = Math.max(0, this.state.recoilOffset - dt * 6);
    this.muzzleFlashTimer = Math.max(0, this.muzzleFlashTimer - dt);

    if (options.didFire && this.currentWeapon) {
      this.state.recoilOffset = Math.min(0.18, this.state.recoilOffset + this.currentWeapon.definition.recoilKick);
      this.muzzleFlashTimer = 0.06;
    }

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

    if (this.swapDirection !== 0) {
      this.state.swapProgress += dt * 5;
      if (this.state.swapProgress >= 1) {
        this.state.swapProgress = 1;
        this.swapDirection = 0;
      }
    }

    const bobX = Math.sin(this.state.bobPhase) * 0.012 * Math.min(1, options.moveSpeed * 0.6);
    const bobY = Math.abs(Math.cos(this.state.bobPhase)) * 0.014 * Math.min(1, options.moveSpeed * 0.6);

    const reloadTilt = this.isReloading
      ? Math.sin(this.state.reloadProgress * Math.PI) * -32
      : 0;
    const reloadDip = this.isReloading
      ? Math.sin(this.state.reloadProgress * Math.PI) * -0.18
      : 0;

    const swapDip = (1 - this.state.swapProgress) * -0.32;
    const recoilZ = this.state.recoilOffset;

    this.root.setLocalPosition(
      0.32 + bobX,
      -0.28 + bobY + reloadDip + swapDip,
      -0.55 - recoilZ
    );
    this.root.setLocalEulerAngles(
      reloadTilt - this.state.recoilOffset * 60,
      4,
      0
    );

    const flashOpacity = this.muzzleFlashTimer / 0.06;
    this.muzzleMaterial.opacity = flashOpacity;
    this.muzzleMaterial.update();
    this.muzzle.setLocalScale(
      0.18 + flashOpacity * 0.2,
      0.18 + flashOpacity * 0.2,
      0.18 + flashOpacity * 0.2
    );
  }
}
