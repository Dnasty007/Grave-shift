import * as pc from "playcanvas";

const PICKUP_RADIUS = 1.8;
const FLOAT_SPEED = 1.5;
const FLOAT_AMPLITUDE = 0.16;
const ROTATE_SPEED_DEG = 108; // degrees per second
const SPAWN_Y_OFFSET = 0.9;

/**
 * A floating Max Ammo capsule that bobs and rotates in world space.
 * Call `update()` each frame — it returns true the moment the player steps into pickup range.
 */
export class MaxAmmoDrop {
  private readonly root: pc.Entity;
  private readonly baseX: number;
  private readonly baseY: number;
  private readonly baseZ: number;
  private bobTime: number;
  private rotationDeg = 0;
  private alive = true;

  constructor(scene: pc.Entity, position: pc.Vec3) {
    this.baseX = position.x;
    this.baseY = position.y + SPAWN_Y_OFFSET;
    this.baseZ = position.z;
    this.bobTime = Math.random() * Math.PI * 2;

    this.root = new pc.Entity("max-ammo-drop");

    // Glowing golden material
    const mat = new pc.StandardMaterial();
    mat.diffuse = new pc.Color(1.0, 0.72, 0.05);
    mat.emissive = new pc.Color(1.6, 0.9, 0.12);
    mat.useLighting = false;
    mat.update();

    // Tilted cube — classic power-up diamond silhouette
    const box = new pc.Entity("box");
    box.addComponent("render", { type: "box", material: mat });
    box.setLocalScale(0.34, 0.34, 0.34);
    box.setLocalEulerAngles(35, 0, 35);
    this.root.addChild(box);

    // Warm point light for ambient glow
    const light = new pc.Entity("glow");
    light.addComponent("light", {
      type: "omni",
      color: new pc.Color(1, 0.78, 0.12),
      intensity: 3.5,
      range: 5,
    });
    this.root.addChild(light);

    this.root.setPosition(this.baseX, this.baseY, this.baseZ);
    scene.addChild(this.root);
  }

  /**
   * Animate the drop and check if the player has walked into pickup range.
   * Returns `true` exactly once when pickup fires; the drop destroys itself automatically.
   */
  update(dt: number, playerPos: pc.Vec3): boolean {
    if (!this.alive) return false;

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
      return true;
    }
    return false;
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    this.root.destroy();
  }
}
