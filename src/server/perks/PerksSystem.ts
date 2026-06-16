import { Entity, Player } from "hytopia";

export type PerkId = "quick_revive" | "jugger_nog" | "speed_cola" | "double_points";

export interface PerkDef {
  id: PerkId;
  name: string;
  cost: number;
  description: string;
  color: string;
}

export const PERK_DEFS: Record<PerkId, PerkDef> = {
  quick_revive: {
    id: "quick_revive",
    name: "Quick Revive",
    cost: 500,
    description: "Faster revive time & one self-revive per round",
    color: "#FF6B6B",
  },
  jugger_nog: {
    id: "jugger_nog",
    name: "Jugger-Nog",
    cost: 2500,
    description: "Extra health: 150 total HP instead of 100",
    color: "#4ECDC4",
  },
  speed_cola: {
    id: "speed_cola",
    name: "Speed Cola",
    cost: 3000,
    description: "Faster reload & faster movement speed",
    color: "#FFE66D",
  },
  double_points: {
    id: "double_points",
    name: "Double Points",
    cost: 1500,
    description: "Double points earned for 30 seconds",
    color: "#95E1D3",
  },
};

export interface PlayerPerkState {
  perks: Set<PerkId>;
  doublePointsEndTime: number;
  selfRevivesRemaining: number;
  reviveTimeMultiplier: number;
  movementSpeedMultiplier: number;
  reloadSpeedMultiplier: number;
  healthMultiplier: number;
}

export class PerksSystem {
  private playerPerks = new Map<Player, PlayerPerkState>();

  initializePlayer(player: Player): void {
    this.playerPerks.set(player, {
      perks: new Set(),
      doublePointsEndTime: 0,
      selfRevivesRemaining: 0,
      reviveTimeMultiplier: 1.0,
      movementSpeedMultiplier: 1.0,
      reloadSpeedMultiplier: 1.0,
      healthMultiplier: 1.0,
    });
  }

  removePlayer(player: Player): void {
    this.playerPerks.delete(player);
  }

  purchasePerk(player: Player, perkId: PerkId): boolean {
    const state = this.playerPerks.get(player);
    if (!state) return false;

    if (state.perks.has(perkId)) return false; // Already have perk

    state.perks.add(perkId);
    this.applyPerkEffects(state, perkId);
    return true;
  }

  private applyPerkEffects(state: PlayerPerkState, perkId: PerkId): void {
    switch (perkId) {
      case "quick_revive":
        state.reviveTimeMultiplier = 0.5; // 50% faster revive
        state.selfRevivesRemaining = 1;
        break;
      case "jugger_nog":
        state.healthMultiplier = 1.5; // 150 HP instead of 100
        break;
      case "speed_cola":
        state.movementSpeedMultiplier = 1.2; // 20% faster movement
        state.reloadSpeedMultiplier = 1.5; // 50% faster reload
        break;
      case "double_points":
        // This is time-based, activated on next action
        break;
    }
  }

  activateDoublePoints(currentTime: number): void {
    // Used when purchased or activated
    // Duration: 30 seconds
  }

  getPlayerPerks(player: Player): PlayerPerkState | undefined {
    return this.playerPerks.get(player);
  }

  isDoublePointsActive(player: Player, currentTime: number): boolean {
    const state = this.playerPerks.get(player);
    if (!state || !state.perks.has("double_points")) return false;
    return currentTime < state.doublePointsEndTime;
  }

  getPointsMultiplier(player: Player, currentTime: number): number {
    const multiplier = this.isDoublePointsActive(player, currentTime) ? 2.0 : 1.0;
    return multiplier;
  }

  getHealthMultiplier(player: Player): number {
    return this.playerPerks.get(player)?.healthMultiplier ?? 1.0;
  }

  getMovementSpeedMultiplier(player: Player): number {
    return this.playerPerks.get(player)?.movementSpeedMultiplier ?? 1.0;
  }

  getReloadSpeedMultiplier(player: Player): number {
    return this.playerPerks.get(player)?.reloadSpeedMultiplier ?? 1.0;
  }

  resetPerksForNewRound(player: Player): void {
    const state = this.playerPerks.get(player);
    if (!state) return;
    // Reset self-revive count for new round
    if (state.perks.has("quick_revive")) {
      state.selfRevivesRemaining = 1;
    }
  }

  useSelfRevive(player: Player): boolean {
    const state = this.playerPerks.get(player);
    if (!state || state.selfRevivesRemaining <= 0) return false;
    state.selfRevivesRemaining--;
    return true;
  }

  losePerkOnDown(player: Player): void {
    const state = this.playerPerks.get(player);
    if (!state) return;
    // In CoD WaW, you lose ALL perks when you go down (unless you have Quick Revive)
    // With Quick Revive, you keep them but lose one self-revive
    if (!state.perks.has("quick_revive")) {
      state.perks.clear();
      state.reviveTimeMultiplier = 1.0;
      state.movementSpeedMultiplier = 1.0;
      state.reloadSpeedMultiplier = 1.0;
      state.healthMultiplier = 1.0;
    }
  }
}
