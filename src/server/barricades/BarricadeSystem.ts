import { Entity, Player } from "hytopia";

export interface BarricadeDef {
  id: string;
  position: { x: number; y: number; z: number };
  maxHealth: number;
}

export interface BarricadeState {
  maxHealth: number;
  currentHealth: number;
  lastRepairTime: number;
  entity: Entity;
}

export class BarricadeSystem {
  private barricades = new Map<Entity, BarricadeState>();
  private readonly BARRICADE_REPAIR_POINTS = 10;
  private readonly BARRICADE_REPAIR_COOLDOWN_MS = 200; // Prevent spam
  private readonly BARRICADE_REGEN_PER_SECOND = 2; // Health regeneration when not being hit
  private readonly ZOMBIE_DAMAGE_PER_HIT = 5; // Damage zombies do to barricades

  createBarricade(
    entity: Entity,
    maxHealth: number = 100
  ): void {
    this.barricades.set(entity, {
      maxHealth,
      currentHealth: maxHealth,
      lastRepairTime: 0,
      entity,
    });
  }

  removeBarricade(entity: Entity): void {
    this.barricades.delete(entity);
  }

  repairBarricade(
    barricade: Entity,
    player: Player,
    currentTime: number
  ): { points: number; repaired: boolean } {
    const state = this.barricades.get(barricade);
    if (!state) return { points: 0, repaired: false };

    // Cooldown check
    if (currentTime - state.lastRepairTime < this.BARRICADE_REPAIR_COOLDOWN_MS) {
      return { points: 0, repaired: false };
    }

    // Already at max health
    if (state.currentHealth >= state.maxHealth) {
      return { points: 0, repaired: false };
    }

    // Repair barricade
    state.currentHealth = Math.min(state.currentHealth + 25, state.maxHealth);
    state.lastRepairTime = currentTime;

    return { points: this.BARRICADE_REPAIR_POINTS, repaired: true };
  }

  damageBarricade(barricade: Entity, damage: number = this.ZOMBIE_DAMAGE_PER_HIT): boolean {
    const state = this.barricades.get(barricade);
    if (!state) return false;

    state.currentHealth -= damage;
    return state.currentHealth <= 0;
  }

  updateBarricadeRegeneration(deltaTimeSeconds: number): void {
    this.barricades.forEach((state) => {
      if (state.currentHealth < state.maxHealth) {
        state.currentHealth = Math.min(
          state.currentHealth + this.BARRICADE_REGEN_PER_SECOND * deltaTimeSeconds,
          state.maxHealth
        );
      }
    });
  }

  getBarricadeState(barricade: Entity): BarricadeState | undefined {
    return this.barricades.get(barricade);
  }

  getBarricadeHealthPercent(barricade: Entity): number {
    const state = this.barricades.get(barricade);
    if (!state) return 0;
    return (state.currentHealth / state.maxHealth) * 100;
  }

  getAllBarricades(): Map<Entity, BarricadeState> {
    return new Map(this.barricades);
  }

  resetAllBarricades(): void {
    this.barricades.forEach((state) => {
      state.currentHealth = state.maxHealth;
      state.lastRepairTime = 0;
    });
  }
}
