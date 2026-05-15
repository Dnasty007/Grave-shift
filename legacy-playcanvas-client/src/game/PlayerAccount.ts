/**
 * PlayerAccount — souls balance, XP/level progression, and owned mods.
 *
 * Persisted to localStorage under STORAGE_KEY.
 * Mods are buy-once for unlimited use across all loadout slots.
 */

import { type ModId, MOD_SHOP_PRICES } from "./LoadoutStore";

const STORAGE_KEY = "project-gehenna-account-v1";
const LEGACY_STORAGE_KEYS = [
  "lazarus-protocol-account-v1",
  "grave-shift-account-v1"
] as const;

/* ── XP level table ──────────────────────────────────────────────────────── */

/** XP required to reach each level (index = level, value = total XP needed). */
const LEVEL_XP_TABLE: number[] = (() => {
  const table = [0]; // level 0 → 1 needs 0 XP (starts at 1)
  for (let i = 1; i <= 100; i++) {
    // Each level costs more XP — ramp from 500 to ~12k
    table.push(Math.floor(400 + i * 80 + i * i * 2.5));
  }
  return table;
})();

export function getLevelForXp(totalXp: number): number {
  let level = 1;
  let accumulated = 0;
  for (let i = 0; i < LEVEL_XP_TABLE.length; i++) {
    accumulated += LEVEL_XP_TABLE[i];
    if (totalXp < accumulated) break;
    level = i + 1;
  }
  return Math.min(level, 100);
}

/** XP needed to complete current level (for progress bar). */
export function getXpForCurrentLevel(totalXp: number): { current: number; needed: number } {
  let accumulated = 0;
  for (let i = 0; i < LEVEL_XP_TABLE.length; i++) {
    const next = accumulated + LEVEL_XP_TABLE[i];
    if (totalXp < next) {
      return { current: totalXp - accumulated, needed: LEVEL_XP_TABLE[i] };
    }
    accumulated = next;
  }
  return { current: 0, needed: 1 };
}

/* ── Run result types ────────────────────────────────────────────────────── */

export type RunInput = {
  kills: number;
  wave: number;
  survivedSeconds: number;
  headshots: number;
  /** Weapon id → kill count for this run. Used to update career favorite weapon. */
  weaponKills?: Partial<Record<string, number>>;
};

export type RunReward = {
  xpGained: number;
  soulsGained: number;
  levelBefore: number;
  levelAfter: number;
  didLevelUp: boolean;
  newTotalXp: number;
  newTotalSouls: number;
};

/* ── Persisted account data ──────────────────────────────────────────────── */

type AccountData = {
  version: 1;
  totalXp: number;
  souls: number;
  ownedMods: ModId[];
  /** Career stats — persisted across runs. */
  highestRound: number;
  totalKills: number;
  /** weapon-id → total career kills with that weapon. */
  weaponKillCounts: Partial<Record<string, number>>;
};

const buildDefault = (): AccountData => ({
  version: 1,
  totalXp: 0,
  souls: 0,
  ownedMods: [],
  highestRound: 0,
  totalKills: 0,
  weaponKillCounts: {}
});

export class PlayerAccount {
  private data: AccountData;

  constructor() {
    this.data = this.load();
  }

  /* ── Getters ─────────────────────────────────────────────────────────────── */

  get souls(): number {
    return this.data.souls;
  }

  get totalXp(): number {
    return this.data.totalXp;
  }

  get level(): number {
    return getLevelForXp(this.data.totalXp);
  }

  get xpProgress(): { current: number; needed: number } {
    return getXpForCurrentLevel(this.data.totalXp);
  }

  get highestRound(): number {
    return this.data.highestRound;
  }

  get totalKills(): number {
    return this.data.totalKills;
  }

  /** Weapon id with the most career kills, or null if no kills on record. */
  get favoriteWeapon(): string | null {
    let max = 0;
    let fav: string | null = null;
    for (const [id, count] of Object.entries(this.data.weaponKillCounts)) {
      if ((count ?? 0) > max) {
        max = count as number;
        fav = id;
      }
    }
    return fav;
  }

  /** Human-readable display name for the favorite weapon (falls back to raw id). */
  getFavoriteWeaponName(allWeaponDefs: Record<string, { name: string }>): string {
    const id = this.favoriteWeapon;
    if (!id) return "—";
    return allWeaponDefs[id]?.name ?? id;
  }

  ownedMods(): Set<ModId> {
    return new Set(this.data.ownedMods);
  }

  hasMod(id: ModId): boolean {
    return this.data.ownedMods.includes(id);
  }

  /* ── Mod shop ────────────────────────────────────────────────────────────── */

  canAffordMod(id: ModId): boolean {
    return !this.hasMod(id) && this.data.souls >= MOD_SHOP_PRICES[id];
  }

  /**
   * Purchase a mod. Returns `true` on success, `false` if already owned or insufficient souls.
   */
  buyMod(id: ModId): boolean {
    if (this.hasMod(id)) return false;
    const price = MOD_SHOP_PRICES[id];
    if (this.data.souls < price) return false;
    this.data.souls -= price;
    this.data.ownedMods.push(id);
    this.save();
    return true;
  }

  /* ── End-of-run reward ───────────────────────────────────────────────────── */

  /**
   * Call at the end of every run to award XP + Souls.
   * Returns a snapshot for the game-over screen animation.
   */
  awardRunResults(input: RunInput): RunReward {
    const levelBefore = this.level;

    // XP formula: base per kill + bonus for waves + headshots
    const xpGained = Math.floor(
      input.kills * 30 +
      input.headshots * 15 +
      input.wave * 120 +
      Math.min(input.survivedSeconds, 600) * 0.8
    );

    // Souls formula: similar cadence, slightly fewer
    const soulsGained = Math.floor(
      input.kills * 12 +
      input.wave * 60 +
      Math.min(input.survivedSeconds, 600) * 0.3
    );

    this.data.totalXp += xpGained;
    this.data.souls += soulsGained;

    // Update career stats
    if (input.wave > this.data.highestRound) {
      this.data.highestRound = input.wave;
    }
    this.data.totalKills += input.kills;
    if (input.weaponKills) {
      for (const [id, count] of Object.entries(input.weaponKills)) {
        this.data.weaponKillCounts[id] = (this.data.weaponKillCounts[id] ?? 0) + (count ?? 0);
      }
    }

    this.save();

    const levelAfter = this.level;

    return {
      xpGained,
      soulsGained,
      levelBefore,
      levelAfter,
      didLevelUp: levelAfter > levelBefore,
      newTotalXp: this.data.totalXp,
      newTotalSouls: this.data.souls
    };
  }

  /* ── DEV helpers ─────────────────────────────────────────────────────────── */

  /** Add souls directly (debug/cheat). */
  debugAddSouls(amount: number): void {
    this.data.souls += amount;
    this.save();
  }

  /* ── Persistence ─────────────────────────────────────────────────────────── */

  private load(): AccountData {
    try {
      let raw = localStorage.getItem(STORAGE_KEY);
      let fromLegacy = false;
      if (!raw) {
        for (const key of LEGACY_STORAGE_KEYS) {
          raw = localStorage.getItem(key);
          if (raw) {
            fromLegacy = true;
            break;
          }
        }
      }
      if (!raw) return buildDefault();
      const parsed = JSON.parse(raw) as Partial<AccountData>;
      if (parsed.version !== 1) return buildDefault();
      const merged: AccountData = {
        version: 1,
        totalXp: typeof parsed.totalXp === "number" ? parsed.totalXp : 0,
        souls: typeof parsed.souls === "number" ? parsed.souls : 0,
        ownedMods: Array.isArray(parsed.ownedMods) ? (parsed.ownedMods as ModId[]) : [],
        highestRound: typeof parsed.highestRound === "number" ? parsed.highestRound : 0,
        totalKills: typeof parsed.totalKills === "number" ? parsed.totalKills : 0,
        weaponKillCounts:
          typeof parsed.weaponKillCounts === "object" &&
          parsed.weaponKillCounts &&
          !Array.isArray(parsed.weaponKillCounts)
            ? (parsed.weaponKillCounts as Partial<Record<string, number>>)
            : {}
      };
      if (fromLegacy) {
        try {
          for (const key of LEGACY_STORAGE_KEYS) {
            localStorage.removeItem(key);
          }
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        } catch {
          /* ignore */
        }
      }
      return merged;
    } catch {
      return buildDefault();
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // quota exceeded / private browsing
    }
  }
}
