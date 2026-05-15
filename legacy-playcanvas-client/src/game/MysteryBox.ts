import * as pc from "playcanvas";
import type { Interactable, InteractKind, InteractPrompt, InteractResult } from "./Interactable";
import { WEAPON_DEFINITIONS, type WeaponId, type WeaponInventory } from "./Weapon";

export const MYSTERY_BOX_POOL: WeaponId[] = [
  "pistol", "shotgun", "autoPistol", "ar15", "ak47", "autoShotgun",
  "ak47Fun", "asval", "asvalFun", "awp", "awpFun",
  "desertEagle", "desertEagleGold",
  "glock19Blue", "glock19Green", "glock19Pink",
  "m4a4", "m4a4Fun", "mp7"
];

export const MYSTERY_BOX_POOL_NAMES = MYSTERY_BOX_POOL.map(id => WEAPON_DEFINITIONS[id].name);

const COST = 950;
const COOLDOWN_SECONDS = 30;
const SPIN_DURATION_SECONDS = 3.5;
const INTERACT_RADIUS = 2.8;

type BoxState = "idle" | "spinning" | "cooldown";

export class MysteryBox implements Interactable {
  readonly id = "mystery-box-0";
  readonly kind: InteractKind = "mystery-box";

  private state: BoxState = "idle";
  private cooldownTimer = 0;
  private spinTimer = 0;
  private pendingWeapon: WeaponId | null = null;
  private lightTime = 0;
  private beamTime = 0;
  private lidAngle = 0;

  private readonly root: pc.Entity;
  private readonly lidPivot: pc.Entity;
  private readonly boxLight: pc.Entity;
  private readonly beamEntity: pc.Entity;
  private readonly groundGlow: pc.Entity;
  private readonly beamMat: pc.StandardMaterial;
  private readonly glowMat: pc.StandardMaterial;

  constructor(
    parent: pc.Entity,
    position: pc.Vec3,
    private readonly onWeaponReady: (weaponId: WeaponId, weaponName: string) => void
  ) {
    this.root = new pc.Entity("mystery-box");
    this.lidPivot = new pc.Entity("mb-lid-pivot");
    this.boxLight = new pc.Entity("mb-light");
    this.beamEntity = new pc.Entity("mb-beam");
    this.groundGlow = new pc.Entity("mb-glow");
    this.beamMat = new pc.StandardMaterial();
    this.glowMat = new pc.StandardMaterial();

    this.root.setPosition(position);
    parent.addChild(this.root);
    this.buildGeometry();
  }

  private buildGeometry(): void {
    const BW = 1.1, BH = 0.85, BD = 0.9, LH = 0.28;

    // ── Body ──────────────────────────────────────────────────────
    const bodyMat = new pc.StandardMaterial();
    bodyMat.diffuse = new pc.Color(0.28, 0.18, 0.08);
    bodyMat.emissive = new pc.Color(0.04, 0.02, 0.005);
    bodyMat.update();
    const body = new pc.Entity("mb-body");
    body.addComponent("render", { type: "box", material: bodyMat });
    body.setLocalScale(BW, BH, BD);
    body.setLocalPosition(0, BH * 0.5, 0);
    this.root.addChild(body);

    // ── Plank seam lines ──────────────────────────────────────────
    const plankMat = new pc.StandardMaterial();
    plankMat.diffuse = new pc.Color(0.18, 0.11, 0.04);
    plankMat.emissive = new pc.Color(0.01, 0.006, 0.001);
    plankMat.update();
    for (const fz of [-1, 1]) {
      for (const row of [0.22, 0.52, 0.74]) {
        const p = new pc.Entity();
        p.addComponent("render", { type: "box", material: plankMat });
        p.setLocalScale(BW - 0.01, 0.02, 0.013);
        p.setLocalPosition(0, row, fz * (BD * 0.5 + 0.005));
        this.root.addChild(p);
      }
    }
    for (const sx of [-1, 1]) {
      for (const row of [0.22, 0.52, 0.74]) {
        const p = new pc.Entity();
        p.addComponent("render", { type: "box", material: plankMat });
        p.setLocalScale(0.013, 0.02, BD - 0.01);
        p.setLocalPosition(sx * (BW * 0.5 + 0.005), row, 0);
        this.root.addChild(p);
      }
    }

    // ── Gold trim ─────────────────────────────────────────────────
    const trimMat = new pc.StandardMaterial();
    trimMat.diffuse = new pc.Color(0.72, 0.52, 0.06);
    trimMat.emissive = new pc.Color(0.22, 0.14, 0.02);
    trimMat.update();

    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as [number, number][]) {
      const strip = new pc.Entity();
      strip.addComponent("render", { type: "box", material: trimMat });
      strip.setLocalScale(0.06, BH + 0.02, 0.06);
      strip.setLocalPosition(sx * BW * 0.48, BH * 0.5, sz * BD * 0.48);
      this.root.addChild(strip);
    }
    const bRail = new pc.Entity();
    bRail.addComponent("render", { type: "box", material: trimMat });
    bRail.setLocalScale(BW + 0.02, 0.05, BD + 0.02);
    bRail.setLocalPosition(0, 0.025, 0);
    this.root.addChild(bRail);

    const mRail = new pc.Entity();
    mRail.addComponent("render", { type: "box", material: trimMat });
    mRail.setLocalScale(BW + 0.02, 0.04, BD + 0.02);
    mRail.setLocalPosition(0, BH * 0.52, 0);
    this.root.addChild(mRail);

    // ── Corner braces ─────────────────────────────────────────────
    const braceMat = new pc.StandardMaterial();
    braceMat.diffuse = new pc.Color(0.60, 0.45, 0.05);
    braceMat.emissive = new pc.Color(0.14, 0.09, 0.01);
    braceMat.update();
    for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]] as [number, number][]) {
      for (const faceZ of [-1, 1]) {
        const bh = new pc.Entity();
        bh.addComponent("render", { type: "box", material: braceMat });
        bh.setLocalScale(BW * 0.32, 0.045, 0.072);
        bh.setLocalPosition(sx * BW * 0.28, 0.11, faceZ * (BD * 0.5 + 0.005));
        this.root.addChild(bh);
        const bv = new pc.Entity();
        bv.addComponent("render", { type: "box", material: braceMat });
        bv.setLocalScale(0.072, BH * 0.32, 0.045);
        bv.setLocalPosition(sx * (BW * 0.5 + 0.005), 0.11, faceZ * BD * 0.28);
        this.root.addChild(bv);
      }
    }

    // ── Lid pivot (hinge at back-top) ─────────────────────────────
    const lidMat = new pc.StandardMaterial();
    lidMat.diffuse = new pc.Color(0.30, 0.19, 0.08);
    lidMat.emissive = new pc.Color(0.04, 0.02, 0.005);
    lidMat.update();

    this.lidPivot.setLocalPosition(0, BH, -BD * 0.5);
    this.root.addChild(this.lidPivot);

    const lid = new pc.Entity("mb-lid");
    lid.addComponent("render", { type: "box", material: lidMat });
    lid.setLocalScale(BW, LH, BD);
    lid.setLocalPosition(0, LH * 0.5, BD * 0.5);
    this.lidPivot.addChild(lid);

    const lidTopTrim = new pc.Entity();
    lidTopTrim.addComponent("render", { type: "box", material: trimMat });
    lidTopTrim.setLocalScale(BW + 0.02, 0.05, BD + 0.02);
    lidTopTrim.setLocalPosition(0, LH + 0.015, BD * 0.5);
    this.lidPivot.addChild(lidTopTrim);

    for (const col of [0.26, 0.53, 0.80]) {
      const lp = new pc.Entity();
      lp.addComponent("render", { type: "box", material: plankMat });
      lp.setLocalScale(BW - 0.01, 0.013, 0.02);
      lp.setLocalPosition(0, LH * 0.5, col * BD - 0.01);
      this.lidPivot.addChild(lp);
    }

    // ── Barrel hinges ─────────────────────────────────────────────
    const hingeMat = new pc.StandardMaterial();
    hingeMat.diffuse = new pc.Color(0.56, 0.42, 0.08);
    hingeMat.emissive = new pc.Color(0.12, 0.07, 0.007);
    hingeMat.update();
    for (const hx of [-0.35, 0, 0.35]) {
      const h = new pc.Entity();
      h.addComponent("render", { type: "cylinder", material: hingeMat });
      h.setLocalScale(0.072, 0.16, 0.072);
      h.setLocalPosition(hx, BH + 0.02, -BD * 0.5);
      this.root.addChild(h);
    }

    // ── Padlock + chain ───────────────────────────────────────────
    const lockMat = new pc.StandardMaterial();
    lockMat.diffuse = new pc.Color(0.62, 0.46, 0.05);
    lockMat.emissive = new pc.Color(0.18, 0.11, 0.007);
    lockMat.update();
    const lockBody = new pc.Entity();
    lockBody.addComponent("render", { type: "box", material: lockMat });
    lockBody.setLocalScale(0.14, 0.16, 0.08);
    lockBody.setLocalPosition(0, BH * 0.55, BD * 0.5 + 0.04);
    this.root.addChild(lockBody);
    const lockShackle = new pc.Entity();
    lockShackle.addComponent("render", { type: "cylinder", material: lockMat });
    lockShackle.setLocalScale(0.035, 0.12, 0.035);
    lockShackle.setLocalPosition(0, BH * 0.55 + 0.14, BD * 0.5 + 0.04);
    this.root.addChild(lockShackle);

    const chainMat = new pc.StandardMaterial();
    chainMat.diffuse = new pc.Color(0.48, 0.36, 0.06);
    chainMat.emissive = new pc.Color(0.08, 0.056, 0.004);
    chainMat.update();
    for (let ci = 0; ci < 5; ci++) {
      const link = new pc.Entity();
      link.addComponent("render", { type: "box", material: chainMat });
      link.setLocalScale(0.05, 0.12, 0.04);
      link.setLocalPosition(-0.1 + ci * 0.049, BH * 0.38 - ci * 0.04, BD * 0.5 + 0.04);
      link.setLocalEulerAngles(0, 0, -22 + ci * 9);
      this.root.addChild(link);
    }

    // ── Side rivets ───────────────────────────────────────────────
    const rivetMat = new pc.StandardMaterial();
    rivetMat.diffuse = new pc.Color(0.52, 0.40, 0.07);
    rivetMat.emissive = new pc.Color(0.09, 0.06, 0.005);
    rivetMat.update();
    for (const sx of [-1, 1]) {
      for (const row of [0.20, 0.50, 0.77]) {
        for (const col of [-0.29, 0, 0.29]) {
          const r = new pc.Entity();
          r.addComponent("render", { type: "sphere", material: rivetMat });
          r.setLocalScale(0.056, 0.056, 0.056);
          r.setLocalPosition(sx * (BW * 0.5 + 0.026), row, col);
          this.root.addChild(r);
        }
      }
    }

    // ── Skid runners ──────────────────────────────────────────────
    const skidMat = new pc.StandardMaterial();
    skidMat.diffuse = new pc.Color(0.16, 0.12, 0.05);
    skidMat.emissive = new pc.Color(0.02, 0.013, 0.002);
    skidMat.update();
    for (const sz of [-0.33, 0.33]) {
      const skid = new pc.Entity();
      skid.addComponent("render", { type: "box", material: skidMat });
      skid.setLocalScale(BW + 0.04, 0.06, 0.1);
      skid.setLocalPosition(0, -0.03, sz * BD);
      this.root.addChild(skid);
    }

    // ── Purple glow light ─────────────────────────────────────────
    this.boxLight.addComponent("light", {
      type: "omni",
      color: new pc.Color(0.55, 0.08, 1.0),
      intensity: 1.6,
      range: 7
    });
    this.boxLight.setLocalPosition(0, BH + 0.5, 0);
    this.root.addChild(this.boxLight);

    // ── Mystery beam ──────────────────────────────────────────────
    this.beamMat.diffuse = new pc.Color(0, 0, 0);
    this.beamMat.emissive = new pc.Color(0.28, 0.015, 0.85);
    this.beamMat.opacity = 0.0;
    this.beamMat.blendType = pc.BLEND_ADDITIVEALPHA;
    this.beamMat.depthWrite = false;
    this.beamMat.cull = pc.CULLFACE_NONE;
    this.beamMat.update();
    this.beamEntity.addComponent("render", { type: "cylinder", material: this.beamMat });
    this.beamEntity.setLocalScale(0.22, 5.5, 0.22);
    this.beamEntity.setLocalPosition(0, BH + 3.25, 0);
    this.root.addChild(this.beamEntity);

    // ── Ground glow ───────────────────────────────────────────────
    this.glowMat.diffuse = new pc.Color(0, 0, 0);
    this.glowMat.emissive = new pc.Color(0.12, 0.005, 0.55);
    this.glowMat.opacity = 0.0;
    this.glowMat.blendType = pc.BLEND_ADDITIVEALPHA;
    this.glowMat.depthWrite = false;
    this.glowMat.cull = pc.CULLFACE_NONE;
    this.glowMat.update();
    this.groundGlow.addComponent("render", { type: "cylinder", material: this.glowMat });
    this.groundGlow.setLocalScale(2.8, 0.02, 2.8);
    this.groundGlow.setLocalPosition(0, 0.01, 0);
    this.root.addChild(this.groundGlow);
  }

  // ── Update ────────────────────────────────────────────────────

  update(dt: number): void {
    this.lightTime += dt;
    this.beamTime += dt;

    if (this.state === "idle") {
      const pulse = 0.9 + 0.1 * Math.sin(this.lightTime * 2.2);
      const lc = this.boxLight.light as pc.LightComponent;
      if (lc) lc.intensity = 1.6 * pulse;
      this.lidPivot.setLocalEulerAngles(Math.sin(this.lightTime * 1.4) * 1.5, 0, 0);
      this.beamMat.opacity = 0.0;
      this.beamMat.update();
      this.glowMat.opacity = 0.0;
      this.glowMat.update();
      return;
    }

    if (this.state === "spinning") {
      this.spinTimer -= dt;
      if (this.spinTimer <= 0) {
        this.finalizeSpin();
        return;
      }
      this.lidAngle += (-70 - this.lidAngle) * Math.min(1, dt * 5);
      this.lidPivot.setLocalEulerAngles(this.lidAngle, 0, 0);

      const bPulse = 0.5 + 0.5 * Math.abs(Math.sin(this.beamTime * 14));
      this.beamMat.opacity = 0.42 * bPulse;
      this.beamMat.emissive.set(0.28 * bPulse, 0.015 * bPulse, 0.85 * bPulse);
      this.beamMat.update();
      this.glowMat.opacity = 0.32 * bPulse;
      this.glowMat.update();
      this.beamEntity.rotateLocal(0, 50 * dt, 0);
      this.groundGlow.rotateLocal(0, -35 * dt, 0);

      const lc = this.boxLight.light as pc.LightComponent;
      if (lc) {
        lc.intensity = 2.8 + 1.2 * Math.sin(this.beamTime * 20);
        lc.color = new pc.Color(0.55 + 0.2 * Math.sin(this.beamTime * 7), 0.08, 1.0);
      }
      return;
    }

    if (this.state === "cooldown") {
      this.cooldownTimer -= dt;
      if (this.cooldownTimer <= 0) {
        this.state = "idle";
        this.lidAngle = 0;
        this.lidPivot.setLocalEulerAngles(0, 0, 0);
      }
      this.lidAngle += (0 - this.lidAngle) * Math.min(1, dt * 3.5);
      this.lidPivot.setLocalEulerAngles(this.lidAngle, 0, 0);
      this.beamMat.opacity = Math.max(0, this.beamMat.opacity * 0.96);
      this.beamMat.update();
      this.glowMat.opacity = Math.max(0, this.glowMat.opacity * 0.96);
      this.glowMat.update();
    }
  }

  private finalizeSpin(): void {
    const chosen = this.pendingWeapon ?? MYSTERY_BOX_POOL[Math.floor(Math.random() * MYSTERY_BOX_POOL.length)];
    this.pendingWeapon = null;
    this.state = "cooldown";
    this.cooldownTimer = COOLDOWN_SECONDS;
    this.onWeaponReady(chosen, WEAPON_DEFINITIONS[chosen].name);
  }

  // ── Interactable ──────────────────────────────────────────────

  isAvailable(): boolean {
    return this.state === "idle";
  }

  getPosition(): pc.Vec3 {
    return this.root.getPosition();
  }

  getInteractRadius(): number {
    return INTERACT_RADIUS;
  }

  getPrompt(points: number, _inventory: WeaponInventory): InteractPrompt {
    const recharging = this.state === "cooldown";
    return {
      title: "MYSTERY BOX",
      subtitle: recharging
        ? `RECHARGING… ${Math.ceil(this.cooldownTimer)}s`
        : "SPIN THE BOX",
      cost: recharging ? null : COST,
      affordable: points >= COST,
      badge: "???"
    };
  }

  interact(points: number, _inventory: WeaponInventory): InteractResult {
    if (this.state !== "idle") {
      return { success: false, pointsSpent: 0, type: "rejected", message: "Box is recharging" };
    }
    if (points < COST) {
      return { success: false, pointsSpent: 0, type: "rejected", message: "Need 950 points" };
    }
    this.pendingWeapon = MYSTERY_BOX_POOL[Math.floor(Math.random() * MYSTERY_BOX_POOL.length)];
    this.state = "spinning";
    this.spinTimer = SPIN_DURATION_SECONDS;
    this.lidAngle = 0;
    this.beamTime = 0;

    return {
      success: true,
      pointsSpent: COST,
      type: "mystery" as InteractResult["type"],
      weaponBought: this.pendingWeapon
    };
  }

  getRoot(): pc.Entity {
    return this.root;
  }

  destroy(): void {
    this.root.destroy();
  }
}
