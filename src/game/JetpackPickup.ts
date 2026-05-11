import * as pc from "playcanvas";

export type JetpackVariant = "valkyrie" | "marauder";

const PICKUP_RADIUS = 2.0;
const FLOAT_SPEED = 1.1;
const FLOAT_AMPLITUDE = 0.14;
const ROTATE_SPEED_DEG = 65;
const SPAWN_Y_OFFSET = 1.1;

const VARIANT_COLORS: Record<JetpackVariant, { light: pc.Color; glow: pc.Color; label: string }> = {
  valkyrie: {
    light: new pc.Color(0.3, 1.0, 0.1),
    glow:  new pc.Color(0.1, 0.6, 0.04),
    label: "RKT-44Z VALKYRIE"
  },
  marauder: {
    light: new pc.Color(1.0, 0.45, 0.05),
    glow:  new pc.Color(0.6, 0.22, 0.02),
    label: "MARAUDER Mk.II"
  }
};

/**
 * A hovering jetpack pickup that bobs and spins in the world.
 * Two variants: "valkyrie" (green, matches player cosmetic) and "marauder" (orange).
 * Expires after `lifetimeSeconds` if nobody picks it up.
 * Call `update()` each frame — returns "picked" when the player steps into range,
 * "expired" when the timer runs out, or null while alive.
 */
export class JetpackPickup {
  private readonly root: pc.Entity;
  private readonly baseX: number;
  private readonly baseY: number;
  private readonly baseZ: number;
  private bobTime: number;
  private rotationDeg = 0;
  private alive = true;
  private lifetime: number;

  readonly variant: JetpackVariant;

  constructor(
    scene: pc.Entity,
    position: pc.Vec3,
    variant: JetpackVariant,
    lifetimeSeconds = 60
  ) {
    this.variant = variant;
    this.baseX = position.x;
    this.baseY = position.y + SPAWN_Y_OFFSET;
    this.baseZ = position.z;
    this.bobTime = Math.random() * Math.PI * 2;
    this.lifetime = lifetimeSeconds;

    this.root = new pc.Entity("jetpack-pickup-" + variant);

    const vc = VARIANT_COLORS[variant];

    // ── Pack body (main canvas sack shape) ─────────────────────────────────
    const bodyMat = new pc.StandardMaterial();
    bodyMat.diffuse = new pc.Color(0.14, 0.16, 0.07);
    bodyMat.emissive = vc.glow;
    bodyMat.update();

    const body = new pc.Entity("body");
    body.addComponent("render", { type: "box", material: bodyMat });
    body.setLocalScale(0.28, 0.36, 0.12);
    this.root.addChild(body);

    // ── Left canister ──────────────────────────────────────────────────────
    const canMat = new pc.StandardMaterial();
    canMat.diffuse = new pc.Color(0.18, 0.18, 0.18);
    canMat.metalness = 0.85;
    canMat.useMetalness = true;
    canMat.emissive = vc.glow;
    canMat.update();

    const canL = new pc.Entity("canL");
    canL.addComponent("render", { type: "cylinder", material: canMat });
    canL.setLocalScale(0.08, 0.26, 0.08);
    canL.setLocalPosition(-0.18, -0.02, 0);
    this.root.addChild(canL);

    // ── Right canister ─────────────────────────────────────────────────────
    const canR = new pc.Entity("canR");
    canR.addComponent("render", { type: "cylinder", material: canMat });
    canR.setLocalScale(0.08, 0.26, 0.08);
    canR.setLocalPosition(0.18, -0.02, 0);
    this.root.addChild(canR);

    // ── Engine nozzles (left + right) ─────────────────────────────────────
    const nozzleMat = new pc.StandardMaterial();
    nozzleMat.diffuse = new pc.Color(0.08, 0.08, 0.08);
    nozzleMat.emissive = vc.light;
    nozzleMat.emissiveIntensity = 1.8;
    nozzleMat.update();

    for (const nx of [-0.18, 0.18]) {
      const noz = new pc.Entity("noz");
      noz.addComponent("render", { type: "cylinder", material: nozzleMat });
      noz.setLocalScale(0.048, 0.06, 0.048);
      noz.setLocalPosition(nx, -0.245, 0);
      this.root.addChild(noz);
    }

    // ── Shoulder straps (simple flat quads across the top) ─────────────────
    const strapMat = new pc.StandardMaterial();
    strapMat.diffuse = new pc.Color(0.22, 0.20, 0.12);
    strapMat.update();

    for (const sx of [-0.07, 0.07]) {
      const strap = new pc.Entity("strap");
      strap.addComponent("render", { type: "box", material: strapMat });
      strap.setLocalScale(0.04, 0.32, 0.02);
      strap.setLocalPosition(sx, 0.02, -0.05);
      this.root.addChild(strap);
    }

    // ── Glowing point light ────────────────────────────────────────────────
    const light = new pc.Entity("glow-light");
    light.addComponent("light", {
      type: "omni",
      color: vc.light,
      intensity: 4.5,
      range: 6
    });
    light.setLocalPosition(0, -0.4, 0);
    this.root.addChild(light);

    // ── Expire-warning pulse light (dim; brightens near end) ───────────────
    const warnLight = new pc.Entity("warn-light");
    warnLight.addComponent("light", {
      type: "omni",
      color: new pc.Color(1, 0.2, 0.1),
      intensity: 0,
      range: 4
    });
    this.root.addChild(warnLight);
    this._warnLight = warnLight.light as pc.LightComponent;

    this.root.setPosition(this.baseX, this.baseY, this.baseZ);
    scene.addChild(this.root);
  }

  private readonly _warnLight: pc.LightComponent;

  /**
   * Animate and check pickup / expiry.
   * Returns `"picked"` the frame the player enters pickup range,
   * `"expired"` when the lifetime timer hits zero, otherwise `null`.
   */
  update(dt: number, playerPos: pc.Vec3): "picked" | "expired" | null {
    if (!this.alive) return null;

    this.lifetime -= dt;

    // Warn via red pulse in the last 10 seconds
    if (this.lifetime < 10) {
      const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.012);
      this._warnLight.intensity = pulse * 3.5;
    }

    if (this.lifetime <= 0) {
      this.destroy();
      return "expired";
    }

    this.bobTime += dt * FLOAT_SPEED;
    this.rotationDeg = (this.rotationDeg + ROTATE_SPEED_DEG * dt) % 360;

    const bobY = Math.sin(this.bobTime) * FLOAT_AMPLITUDE;
    this.root.setPosition(this.baseX, this.baseY + bobY, this.baseZ);
    this.root.setLocalEulerAngles(0, this.rotationDeg, 0);

    const dx = playerPos.x - this.baseX;
    const dy = playerPos.y - (this.baseY + bobY);
    const dz = playerPos.z - this.baseZ;

    if (dx * dx + dy * dy + dz * dz <= PICKUP_RADIUS * PICKUP_RADIUS) {
      this.destroy();
      return "picked";
    }
    return null;
  }

  getLifetimeRemaining(): number {
    return Math.max(0, this.lifetime);
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    this.root.destroy();
  }
}
