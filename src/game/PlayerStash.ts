import type { WeaponInventory } from "./Weapon";

/**
 * Loose ammo stacks carried outside active magazines (Minecraft-style backpack).
 * Pickups merge by caliber; "Use" in the inventory moves rounds into matching weapons' reserve.
 */
export type StashStack = {
  id: string;
  caliber: string;
  amount: number;
};

export class PlayerStash {
  private stacks: StashStack[] = [];
  private nextId = 0;

  clear(): void {
    this.stacks.length = 0;
  }

  getStacks(): ReadonlyArray<StashStack> {
    return this.stacks;
  }

  /** Add rounds; merges into first stack with same caliber. */
  addAmmo(caliber: string, amount: number): void {
    if (amount <= 0) return;
    const ex = this.stacks.find((s) => s.caliber === caliber);
    if (ex) {
      ex.amount += amount;
      return;
    }
    this.stacks.push({
      id: `stk-${this.nextId++}`,
      caliber,
      amount
    });
  }

  /**
   * Remove one stack entirely (e.g. world drop). Returns payload or null.
   */
  takeStackAt(index: number): StashStack | null {
    if (index < 0 || index >= this.stacks.length) {
      return null;
    }
    const [removed] = this.stacks.splice(index, 1);
    return removed ?? null;
  }

  /**
   * Move as many rounds as possible from stash into owned weapons with matching caliber.
   * Removes or shrinks the stack. Returns rounds applied.
   */
  applyStackToWeapons(stackIndex: number, inventory: WeaponInventory): number {
    if (stackIndex < 0 || stackIndex >= this.stacks.length) {
      return 0;
    }
    const stack = this.stacks[stackIndex]!;
    let remaining = stack.amount;
    let applied = 0;

    for (const w of inventory.getSlots()) {
      if (w.definition.caliber !== stack.caliber) {
        continue;
      }
      const cap = w.definition.reserveAmmo;
      while (remaining > 0 && w.ammoReserve < cap) {
        w.ammoReserve += 1;
        remaining -= 1;
        applied += 1;
      }
    }

    stack.amount = remaining;
    if (stack.amount <= 0) {
      this.stacks.splice(stackIndex, 1);
    }
    return applied;
  }
}
