import * as pc from "playcanvas";

const PICKUP_RADIUS = 1.35;
const FLOAT_SPEED = 0.85;
const FLOAT_AMPLITUDE = 0.12;
const SPIN_DEG_PER_SEC = 28;
const SPAWN_Y_OFFSET = 0.35;
const MAX_LIFETIME = 60;

export type AmmoDropPayload = {
  caliber: string;
  amount: number;
};

/**
 * Ammo bundle floating above the ground: slow bob + Y spin, despawns after {@link MAX_LIFETIME}s.
 */
export class WorldItemDrop {
  private readonly root: pc.Entity;
  private readonly baseX: number;
  private readonly baseY: number;
  private readonly baseZ: number;
  private bobTime: number;
  private rotationDeg = 0;
  private alive = true;
  private age = 0;
  public readonly payload: AmmoDropPayload;

  constructor(scene: pc.Entity, position: pc.Vec3, payload: AmmoDropPayload) {
    this.payload = { ...payload };
    this.baseX = position.x;
    this.baseY = position.y + SPAWN_Y_OFFSET;
    this.baseZ = position.z;
    this.bobTime = Math.random() * Math.PI * 2;

    const mat = new pc.StandardMaterial();
    const hue = WorldItemDrop.hashHue(payload.caliber);
    mat.diffuse = hue;
    mat.emissive = new pc.Color(hue.r * 0.5, hue.g * 0.5, hue.b * 0.5);
    mat.useLighting = false;
    mat.update();

    this.root = new pc.Entity("world-item-drop");
    const box = new pc.Entity("box");
    box.addComponent("render", { type: "box", material: mat });
    box.setLocalScale(0.24, 0.2, 0.32);
    box.setLocalEulerAngles(20, 0, 15);
    this.root.addChild(box);

    this.root.setPosition(this.baseX, this.baseY, this.baseZ);
    scene.addChild(this.root);
  }

  private static hashHue(caliber: string): pc.Color {
    let h = 0;
    for (let i = 0; i < caliber.length; i++) {
      h = (h * 31 + caliber.charCodeAt(i)) | 0;
    }
    const t = (Math.abs(h) % 360) / 360;
    return new pc.Color(
      0.45 + 0.35 * Math.sin(t * Math.PI * 2),
      0.45 + 0.35 * Math.sin((t + 0.33) * Math.PI * 2),
      0.45 + 0.35 * Math.sin((t + 0.66) * Math.PI * 2)
    );
  }

  /**
   * @returns `"picked"` | `"expired"` | null
   */
  update(dt: number, playerPos: pc.Vec3): "picked" | "expired" | null {
    if (!this.alive) {
      return null;
    }

    this.age += dt;
    if (this.age >= MAX_LIFETIME) {
      this.destroy();
      return "expired";
    }

    this.bobTime += dt * FLOAT_SPEED;
    this.rotationDeg = (this.rotationDeg + SPIN_DEG_PER_SEC * dt) % 360;

    const bobY = Math.sin(this.bobTime) * FLOAT_AMPLITUDE;
    const y = this.baseY + bobY;
    this.root.setPosition(this.baseX, y, this.baseZ);
    this.root.setLocalEulerAngles(0, this.rotationDeg, 0);

    const dx = playerPos.x - this.baseX;
    const dy = playerPos.y - y;
    const dz = playerPos.z - this.baseZ;

    if (dx * dx + dy * dy + dz * dz <= PICKUP_RADIUS * PICKUP_RADIUS) {
      this.destroy();
      return "picked";
    }
    return null;
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    this.root.destroy();
  }

  getAlive(): boolean {
    return this.alive;
  }
}
