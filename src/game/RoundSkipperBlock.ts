import * as pc from "playcanvas";
import { GAME_CONFIG } from "./config";
import type { Interactable, InteractKind, InteractPrompt, InteractResult } from "./Interactable";
import type { WeaponInventory } from "./Weapon";

/**
 * Dev-only interactable: solid glowing block that clears the horde and jumps the wave director
 * to {@link GAME_CONFIG.devRoundSkipper.targetWave} (for boss / round testing).
 */
export class RoundSkipperBlock implements Interactable {
  readonly id = "dev-round-skip-0";
  readonly kind: InteractKind = "dev-round-skip";

  private readonly root: pc.Entity;

  constructor(_app: pc.Application, parent: pc.Entity) {
    const cfg = GAME_CONFIG.devRoundSkipper;
    this.root = new pc.Entity("dev-round-skip");
    this.root.setPosition(cfg.position.x, cfg.position.y, cfg.position.z);
    parent.addChild(this.root);

    const mat = new pc.StandardMaterial();
    mat.diffuse = new pc.Color(0.35, 0.75, 0.95);
    mat.emissive = new pc.Color(0.55, 1.0, 1.25);
    mat.useLighting = false;
    mat.update();

    const box = new pc.Entity("skipper-cube");
    box.addComponent("render", { type: "box", material: mat });
    box.setLocalScale(0.85, 0.55, 0.85);
    box.setLocalPosition(0, 0.28, 0);
    this.root.addChild(box);

    const light = new pc.Entity("skipper-light");
    light.addComponent("light", {
      type: "omni",
      color: new pc.Color(0.45, 0.9, 1.0),
      intensity: 2.2,
      range: 5.5
    });
    light.setLocalPosition(0, 0.85, 0);
    this.root.addChild(light);
  }

  getRoot(): pc.Entity {
    return this.root;
  }

  destroy(): void {
    this.root.destroy();
  }

  isAvailable(): boolean {
    return GAME_CONFIG.devRoundSkipper.enabled;
  }

  getPosition(): pc.Vec3 {
    return this.root.getPosition();
  }

  getInteractRadius(): number {
    return GAME_CONFIG.devRoundSkipper.interactRadius;
  }

  getPrompt(_points: number, _inventory: WeaponInventory): InteractPrompt {
    const w = GAME_CONFIG.devRoundSkipper.targetWave;
    return {
      title: "SKIP TO WAVE",
      subtitle: `Always jump to wave ${w} (not the next wave)`,
      cost: null,
      affordable: true,
      badge: "DEV"
    };
  }

  interact(_points: number, _inventory: WeaponInventory): InteractResult {
    if (!GAME_CONFIG.devRoundSkipper.enabled) {
      return { success: false, pointsSpent: 0, type: "rejected", message: "Disabled" };
    }
    return {
      success: true,
      pointsSpent: 0,
      type: "devRoundSkip",
      devSkipToWave: GAME_CONFIG.devRoundSkipper.targetWave
    };
  }
}
