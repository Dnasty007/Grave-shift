import * as pc from "playcanvas";
import type { CollisionWorld, CollisionId } from "./CollisionWorld";
import type {
  Interactable,
  InteractKind,
  InteractPrompt,
  InteractResult
} from "./Interactable";
import type { WeaponInventory } from "./Weapon";

let doorCounter = 0;

type DoorOptions = {
  parent: pc.Entity;
  collisionWorld: CollisionWorld;
  position: pc.Vec3;
  size: { x: number; y: number; z: number };
  rotationY: number;
  cost: number;
  label: string;
};

export class Door implements Interactable {
  readonly id = `door-${doorCounter++}`;
  readonly kind: InteractKind = "door";

  private readonly root = new pc.Entity(this.id);
  private readonly cost: number;
  private readonly label: string;
  private readonly collisionWorld: CollisionWorld;
  private readonly collisionId: CollisionId;
  private opened = false;
  private fadeTimer = 0;

  constructor(options: DoorOptions) {
    this.cost = options.cost;
    this.label = options.label;
    this.collisionWorld = options.collisionWorld;

    this.root.setPosition(options.position);
    this.root.setEulerAngles(0, options.rotationY, 0);
    options.parent.addChild(this.root);

    const barMat = new pc.StandardMaterial();
    barMat.diffuse = new pc.Color(0.1, 0.08, 0.06);
    barMat.emissive = new pc.Color(0.04, 0.02, 0.01);
    barMat.update();

    const frame = new pc.Entity("door-frame");
    frame.addComponent("render", { type: "box", material: barMat });
    frame.setLocalScale(options.size.x, options.size.y, options.size.z);
    frame.setLocalPosition(0, options.size.y * 0.5, 0);
    this.root.addChild(frame);

    const accentMat = new pc.StandardMaterial();
    accentMat.diffuse = new pc.Color(0.7, 0.35, 0.1);
    accentMat.emissive = new pc.Color(0.45, 0.15, 0.04);
    accentMat.useLighting = false;
    accentMat.update();

    for (let i = 0; i < 5; i += 1) {
      const bar = new pc.Entity("door-bar");
      bar.addComponent("render", { type: "box", material: accentMat });
      bar.setLocalScale(0.06, options.size.y * 0.95, options.size.z * 1.05);
      bar.setLocalPosition(
        -options.size.x * 0.5 + (i + 0.5) * (options.size.x / 5),
        options.size.y * 0.5,
        0
      );
      this.root.addChild(bar);
    }

    const lockLight = new pc.Entity("door-light");
    lockLight.addComponent("light", {
      type: "omni",
      color: new pc.Color(1, 0.4, 0.18),
      intensity: 0.7,
      range: 5
    });
    lockLight.setLocalPosition(0, options.size.y * 0.65, options.size.z * 0.6);
    this.root.addChild(lockLight);

    const cosY = Math.cos((options.rotationY * Math.PI) / 180);
    const sinY = Math.sin((options.rotationY * Math.PI) / 180);
    const worldSizeX = Math.abs(cosY) * options.size.x + Math.abs(sinY) * options.size.z;
    const worldSizeZ = Math.abs(sinY) * options.size.x + Math.abs(cosY) * options.size.z;

    this.collisionId = options.collisionWorld.addFromCenter(
      options.position.x,
      options.position.z,
      worldSizeX,
      worldSizeZ,
      true
    );
  }

  update(dt: number): void {
    if (!this.opened) return;
    if (this.fadeTimer >= 1) return;
    this.fadeTimer = Math.min(1, this.fadeTimer + dt * 1.5);
    const fade = 1 - this.fadeTimer;
    this.root.setLocalScale(fade, fade, fade);
    if (this.fadeTimer >= 1) {
      this.root.enabled = false;
    }
  }

  isAvailable(): boolean {
    return !this.opened;
  }

  getPosition(): pc.Vec3 {
    return this.root.getPosition();
  }

  getInteractRadius(): number {
    return 3;
  }

  getPrompt(points: number, _inventory: WeaponInventory): InteractPrompt {
    return {
      title: this.label,
      subtitle: "OPEN GATE",
      cost: this.cost,
      affordable: points >= this.cost,
      badge: "GATE"
    };
  }

  interact(points: number, _inventory: WeaponInventory): InteractResult {
    if (this.opened) {
      return { success: false, pointsSpent: 0, type: "noChange" };
    }
    if (points < this.cost) {
      return {
        success: false,
        pointsSpent: 0,
        type: "rejected",
        message: "Not enough points"
      };
    }

    this.opened = true;
    this.collisionWorld.remove(this.collisionId);
    this.fadeTimer = 0.0001;

    return {
      success: true,
      pointsSpent: this.cost,
      type: "opened"
    };
  }
}
