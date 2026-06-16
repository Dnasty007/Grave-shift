import { Player } from "hytopia";

export type MeleeId = "knife";

export interface MeleeDef {
  id: MeleeId;
  name: string;
  damage: number;
  range: number;
  cooldown: number; // seconds
  pointsPerHit: number;
  pointsPerKill: number;
}

export const MELEE_DEFS: Record<MeleeId, MeleeDef> = {
  knife: {
    id: "knife",
    name: "Knife",
    damage: 130,
    range: 1.5,
    cooldown: 0.7,
    pointsPerHit: 130,
    pointsPerKill: 130,
  },
};

export interface PlayerMeleeState {
  equippedMelee: MeleeId;
  lastAttackTime: number;
  canAttack: boolean;
}

export class MeleeSystem {
  private playerMelee = new Map<Player, PlayerMeleeState>();

  initializePlayer(player: Player): void {
    this.playerMelee.set(player, {
      equippedMelee: "knife",
      lastAttackTime: 0,
      canAttack: true,
    });
  }

  removePlayer(player: Player): void {
    this.playerMelee.delete(player);
  }

  canPlayerAttack(player: Player, currentTime: number): boolean {
    const state = this.playerMelee.get(player);
    if (!state) return false;

    const meleeConfig = MELEE_DEFS[state.equippedMelee];
    const timeSinceLastAttack = currentTime - state.lastAttackTime;

    return timeSinceLastAttack >= meleeConfig.cooldown;
  }

  performMeleeAttack(player: Player, currentTime: number): MeleeDef | null {
    const state = this.playerMelee.get(player);
    if (!state) return null;

    const meleeConfig = MELEE_DEFS[state.equippedMelee];

    if (!this.canPlayerAttack(player, currentTime)) {
      return null;
    }

    state.lastAttackTime = currentTime;
    return meleeConfig;
  }

  getMeleeConfig(melee: MeleeId): MeleeDef {
    return MELEE_DEFS[melee];
  }

  getPlayerMeleeDamage(player: Player): number {
    const state = this.playerMelee.get(player);
    if (!state) return 0;
    const config = MELEE_DEFS[state.equippedMelee];
    return config.damage;
  }

  getPlayerMeleeRange(player: Player): number {
    const state = this.playerMelee.get(player);
    if (!state) return 0;
    const config = MELEE_DEFS[state.equippedMelee];
    return config.range;
  }

  getAttackPoints(player: Player, isKill: boolean): number {
    const state = this.playerMelee.get(player);
    if (!state) return 0;

    const config = MELEE_DEFS[state.equippedMelee];
    return isKill ? config.pointsPerKill : config.pointsPerHit;
  }

  getEquippedMelee(player: Player): MeleeId | null {
    const state = this.playerMelee.get(player);
    return state?.equippedMelee ?? null;
  }

  getLastAttackTime(player: Player): number {
    return this.playerMelee.get(player)?.lastAttackTime ?? 0;
  }

  // Get cooldown remaining (0 if ready)
  getCooldownRemaining(player: Player, currentTime: number): number {
    const state = this.playerMelee.get(player);
    if (!state) return 0;

    const meleeConfig = MELEE_DEFS[state.equippedMelee];
    const timeSinceLastAttack = currentTime - state.lastAttackTime;
    const cooldownRemaining = meleeConfig.cooldown - timeSinceLastAttack;

    return Math.max(0, cooldownRemaining);
  }
}
