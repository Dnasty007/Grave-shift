import * as pc from "playcanvas";
import { GAME_CONFIG } from "./config";
import type { Interactable, InteractKind, InteractPrompt, InteractResult } from "./Interactable";
import type { WeaponInventory } from "./Weapon";

/**
 * World Pack-a-Punch machine: loads `GAME_CONFIG.packAPunch.modelUrl` and upgrades the **held**
 * ranged weapon (tiered damage + ammo refill), COD Zombies style.
 */
export class PackAPunchMachine implements Interactable {
  readonly id = "pack-a-punch-0";
  readonly kind: InteractKind = "pack-a-punch";

  private readonly root: pc.Entity;
  private readonly glowLight: pc.Entity;

  constructor(app: pc.Application, parent: pc.Entity) {
    const cfg = GAME_CONFIG.packAPunch;
    this.root = new pc.Entity("pack-a-punch");
    this.root.setPosition(cfg.position.x, cfg.position.y, cfg.position.z);
    this.root.setEulerAngles(0, cfg.rotationYDegrees, 0);
    parent.addChild(this.root);

    this.glowLight = new pc.Entity("pap-light");
    this.glowLight.addComponent("light", {
      type: "omni",
      color: new pc.Color(1.0, 0.45, 0.08),
      intensity: 1.35,
      range: 6.5
    });
    this.glowLight.setLocalPosition(0, 1.25, 0);
    this.root.addChild(this.glowLight);

    const asset = new pc.Asset("pack-a-punch-mesh", "container", { url: cfg.modelUrl });
    asset.on("error", (err: string) => {
      console.warn(`[PackAPunch] glTF load failed (${cfg.modelUrl}):`, err);
    });
    asset.ready(() => {
      const res = asset.resource as pc.ContainerResource | null | undefined;
      if (!res || typeof res.instantiateRenderEntity !== "function") {
        console.warn("[PackAPunch] container resource missing");
        return;
      }
      try {
        const ent = res.instantiateRenderEntity({ castShadows: true });
        const s = cfg.modelScale;
        ent.setLocalScale(s, s, s);
        ent.setLocalPosition(0, 0, 0);
        this.root.addChild(ent);
      } catch (e) {
        console.warn("[PackAPunch] instantiateRenderEntity failed:", e);
      }
    });
    app.assets.add(asset);
    app.assets.load(asset);
  }

  getRoot(): pc.Entity {
    return this.root;
  }

  destroy(): void {
    this.root.destroy();
  }

  isAvailable(): boolean {
    return true;
  }

  getPosition(): pc.Vec3 {
    return this.root.getPosition();
  }

  getInteractRadius(): number {
    return GAME_CONFIG.packAPunch.interactRadius;
  }

  getPrompt(points: number, inventory: WeaponInventory): InteractPrompt {
    const cfg = GAME_CONFIG.packAPunch;
    const w = inventory.getCurrent();
    const melee = w.isMeleeWeapon();
    const tier = w.packAPunchTier;
    const max = cfg.maxTier;
    let subtitle: string;
    if (melee) {
      subtitle = "SWITCH TO A GUN";
    } else if (tier <= 0) {
      subtitle = "UPGRADE HELD WEAPON";
    } else if (tier >= max) {
      subtitle = `MAX PaP ×${max} — REFILL AMMO`;
    } else {
      subtitle = `PaP ×${tier} → NEXT TIER (+ REFILL)`;
    }
    return {
      title: "PACK-A-PUNCH",
      subtitle,
      cost: cfg.cost,
      affordable: !melee && points >= cfg.cost,
      badge: "V"
    };
  }

  interact(points: number, inventory: WeaponInventory): InteractResult {
    const cfg = GAME_CONFIG.packAPunch;
    const w = inventory.getCurrent();
    if (w.isMeleeWeapon()) {
      return {
        success: false,
        pointsSpent: 0,
        type: "rejected",
        message: "Melee cannot be Pack-a-Punched"
      };
    }
    if (points < cfg.cost) {
      return { success: false, pointsSpent: 0, type: "rejected", message: "Need more points" };
    }
    w.applyPackAPunchUpgrade();
    return {
      success: true,
      pointsSpent: cfg.cost,
      type: "packPunch"
    };
  }
}
