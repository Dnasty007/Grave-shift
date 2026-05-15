import * as pc from "playcanvas";
import type { WeaponId, WeaponInventory } from "./Weapon";

export type InteractKind =
  | "wall-buy"
  | "door"
  | "power"
  | "info"
  | "mystery-box"
  | "pack-a-punch"
  | "dev-round-skip";

export type InteractPrompt = {
  title: string;
  subtitle: string;
  cost: number | null;
  affordable: boolean;
  badge?: string;
};

export type InteractResult = {
  success: boolean;
  pointsSpent: number;
  type:
    | "bought"
    | "refilled"
    | "opened"
    | "noChange"
    | "rejected"
    | "mystery"
    | "packPunch"
    | "devRoundSkip";
  weaponBought?: WeaponId;
  message?: string;
  /** When {@link type} is `devRoundSkip`, wave director advances to this wave. */
  devSkipToWave?: number;
};

export interface Interactable {
  readonly id: string;
  readonly kind: InteractKind;
  isAvailable(): boolean;
  getPosition(): pc.Vec3;
  getInteractRadius(): number;
  getPrompt(points: number, inventory: WeaponInventory): InteractPrompt;
  interact(points: number, inventory: WeaponInventory): InteractResult;
}

export type InteractTargetUpdate = {
  target: Interactable | null;
  prompt: InteractPrompt | null;
};

export class InteractionController {
  private readonly registry = new Map<string, Interactable>();
  private currentTarget: Interactable | null = null;

  register(interactable: Interactable): void {
    this.registry.set(interactable.id, interactable);
  }

  unregister(id: string): void {
    if (this.currentTarget?.id === id) {
      this.currentTarget = null;
    }
    this.registry.delete(id);
  }

  clear(): void {
    this.registry.clear();
    this.currentTarget = null;
  }

  /**
   * Find the closest available interactable in front of the player.
   * Returns the new target or null if no candidate is in range.
   */
  pickTarget(
    cameraPosition: pc.Vec3,
    cameraForward: pc.Vec3,
    points: number,
    inventory: WeaponInventory
  ): InteractTargetUpdate {
    let bestTarget: Interactable | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of this.registry.values()) {
      if (!candidate.isAvailable()) continue;
      const targetPos = candidate.getPosition();
      const offsetX = targetPos.x - cameraPosition.x;
      const offsetZ = targetPos.z - cameraPosition.z;
      const distanceXZ = Math.hypot(offsetX, offsetZ);
      if (distanceXZ > candidate.getInteractRadius()) continue;

      const dot =
        distanceXZ > 0.0001
          ? (offsetX / distanceXZ) * cameraForward.x +
            (offsetZ / distanceXZ) * cameraForward.z
          : 1;
      if (dot < 0.45) continue;

      if (distanceXZ < bestDistance) {
        bestDistance = distanceXZ;
        bestTarget = candidate;
      }
    }

    this.currentTarget = bestTarget;
    if (!bestTarget) {
      return { target: null, prompt: null };
    }

    return {
      target: bestTarget,
      prompt: bestTarget.getPrompt(points, inventory)
    };
  }

  trigger(points: number, inventory: WeaponInventory): InteractResult | null {
    if (!this.currentTarget) return null;
    return this.currentTarget.interact(points, inventory);
  }

  getCurrentTarget(): Interactable | null {
    return this.currentTarget;
  }
}
