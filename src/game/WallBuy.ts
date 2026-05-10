import * as pc from "playcanvas";
import type {
  Interactable,
  InteractKind,
  InteractPrompt,
  InteractResult
} from "./Interactable";
import { WEAPON_DEFINITIONS, WeaponId, WeaponInventory } from "./Weapon";

let wallBuyCounter = 0;

type WallBuyOptions = {
  parent: pc.Entity;
  weaponId: WeaponId;
  position: pc.Vec3;
  rotationY: number;
};

const SIGN_OFFSET_Y = 1.55;

export class WallBuy implements Interactable {
  readonly id = `wall-buy-${wallBuyCounter++}`;
  readonly kind: InteractKind = "wall-buy";
  readonly weaponId: WeaponId;

  private readonly root = new pc.Entity(this.id);
  private readonly weaponEntity = new pc.Entity("weapon-mount");
  private readonly priceLight = new pc.Entity("price-light");
  private readonly weaponMaterial = new pc.StandardMaterial();

  constructor(options: WallBuyOptions) {
    this.weaponId = options.weaponId;
    const def = WEAPON_DEFINITIONS[options.weaponId];

    this.root.setPosition(options.position);
    this.root.setEulerAngles(0, options.rotationY, 0);
    options.parent.addChild(this.root);

    const plate = new pc.Entity("plate");
    const plateMat = new pc.StandardMaterial();
    plateMat.diffuse = new pc.Color(0.06, 0.06, 0.08);
    plateMat.emissive = new pc.Color(0.02, 0.018, 0.014);
    plateMat.update();
    plate.addComponent("render", { type: "box", material: plateMat });
    plate.setLocalScale(1.6, 0.9, 0.08);
    plate.setLocalPosition(0, 1.55, 0.06);
    this.root.addChild(plate);

    this.weaponMaterial.diffuse = new pc.Color(...def.viewModelTint);
    this.weaponMaterial.emissive = new pc.Color(0.04, 0.025, 0.015);
    this.weaponMaterial.update();

    const stock = new pc.Entity("stock");
    stock.addComponent("render", { type: "box", material: this.weaponMaterial });
    stock.setLocalScale(0.22, 0.18, 0.4);
    stock.setLocalPosition(-0.32, 0, 0);

    const barrel = new pc.Entity("barrel");
    barrel.addComponent("render", { type: "box", material: this.weaponMaterial });
    const barrelLength = def.viewModelLength;
    barrel.setLocalScale(0.08, 0.08, barrelLength);
    barrel.setLocalPosition(barrelLength * 0.4, 0.04, 0);

    const grip = new pc.Entity("grip");
    const gripMat = new pc.StandardMaterial();
    gripMat.diffuse = new pc.Color(0.4, 0.22, 0.08);
    gripMat.emissive = new pc.Color(0.06, 0.03, 0.012);
    gripMat.update();
    grip.addComponent("render", { type: "box", material: gripMat });
    grip.setLocalScale(0.12, 0.2, 0.14);
    grip.setLocalPosition(-0.12, -0.18, 0);

    this.weaponEntity.addChild(stock);
    this.weaponEntity.addChild(barrel);
    this.weaponEntity.addChild(grip);
    this.weaponEntity.setLocalEulerAngles(0, 90, 0);
    this.weaponEntity.setLocalPosition(0, SIGN_OFFSET_Y, 0.18);
    this.root.addChild(this.weaponEntity);

    this.priceLight.addComponent("light", {
      type: "omni",
      color: new pc.Color(1, 0.55, 0.18),
      intensity: 0.55,
      range: 5
    });
    this.priceLight.setLocalPosition(0, SIGN_OFFSET_Y, 0.5);
    this.root.addChild(this.priceLight);
  }

  getEntity(): pc.Entity {
    return this.root;
  }

  isAvailable(): boolean {
    return true;
  }

  getPosition(): pc.Vec3 {
    return this.root.getPosition();
  }

  getInteractRadius(): number {
    return 2.6;
  }

  getPrompt(points: number, inventory: WeaponInventory): InteractPrompt {
    const def = WEAPON_DEFINITIONS[this.weaponId];
    const owned = inventory.hasWeapon(this.weaponId);
    const cost = owned ? def.refillCost : def.buyCost;
    return {
      title: def.name,
      subtitle: owned ? "REFILL AMMO" : "WALL BUY",
      cost,
      affordable: points >= cost,
      badge: def.shortName.toUpperCase()
    };
  }

  interact(points: number, inventory: WeaponInventory): InteractResult {
    const def = WEAPON_DEFINITIONS[this.weaponId];
    const owned = inventory.hasWeapon(this.weaponId);
    const cost = owned ? def.refillCost : def.buyCost;

    if (points < cost) {
      return { success: false, pointsSpent: 0, type: "rejected", message: "Not enough points" };
    }

    const result = inventory.buyOrRefill(this.weaponId);
    if (result === "noChange") {
      return { success: false, pointsSpent: 0, type: "noChange" };
    }

    return {
      success: true,
      pointsSpent: cost,
      type: result === "bought" ? "bought" : "refilled",
      weaponBought: this.weaponId
    };
  }
}
