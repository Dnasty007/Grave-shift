/**
 * Loadout system — all type definitions, display metadata, and localStorage persistence.
 *
 * Loadouts are stored in localStorage under STORAGE_KEY.
 * MAX_LOADOUTS slots, each with a custom name + four equipment categories.
 */

export const MAX_LOADOUTS = 5;

/* ── Category ID types ───────────────────────────────────────────────────── */

export type SpecialAbilityId = "ghost_mags" | "iron_will" | "bloodlust" | "dead_sprint";
export type ModId =
  | "extended_mag"
  | "quick_hands"
  | "stopping_power"
  | "scavenger"
  | "iron_trigger"
  | "dead_eye"
  | "thick_skin"
  | "fleet_foot"
  | "mag_swapper"
  | "vital_harvest";
export type StarterPistolId = "pistol" | "autoPistol";
export type LethalId = "frag" | "n74st" | "satchel" | "smine44";

/* ── Loadout shape ───────────────────────────────────────────────────────── */

export type LoadoutData = {
  id: number;
  name: string;
  specialAbility: SpecialAbilityId | null;
  mod: ModId | null;
  primary: StarterPistolId;
  lethal: LethalId | null;
};

/* ── Display metadata ────────────────────────────────────────────────────── */

type OptionMeta = { label: string; desc: string; icon: string };

export const SPECIAL_ABILITY_META: Record<SpecialAbilityId, OptionMeta> = {
  ghost_mags: {
    label: "Phantom Mag",
    desc: "Fire freely — ammo is never consumed.",
    icon: "∞"
  },
  iron_will: {
    label: "Iron Will",
    desc: "Survive your first lethal hit each round at 1 HP.",
    icon: "⬡"
  },
  bloodlust: {
    label: "Bloodlust",
    desc: "Each kill restores 8 HP.",
    icon: "♥"
  },
  dead_sprint: {
    label: "Dead Sprint",
    desc: "Sprint speed stays at maximum regardless of health.",
    icon: "⚡"
  }
};

export const MOD_META: Record<ModId, OptionMeta> = {
  extended_mag: {
    label: "Extended Mag",
    desc: "Start with double magazine capacity.",
    icon: "≡"
  },
  quick_hands: {
    label: "Quick Hands",
    desc: "Reload 35% faster.",
    icon: "↺"
  },
  stopping_power: {
    label: "Stopping Power",
    desc: "Bullets deal +25% damage.",
    icon: "✦"
  },
  scavenger: {
    label: "Scavenger",
    desc: "+8% bonus Max Ammo drop chance on kills.",
    icon: "◈"
  },
  iron_trigger: {
    label: "Iron Trigger",
    desc: "Fire rate increased by 20%.",
    icon: "⚙"
  },
  dead_eye: {
    label: "Dead Eye",
    desc: "Headshots deal +40% bonus damage.",
    icon: "◎"
  },
  thick_skin: {
    label: "Thick Skin",
    desc: "Incoming damage reduced by 15%.",
    icon: "⬡"
  },
  fleet_foot: {
    label: "Fleet Foot",
    desc: "Move speed increased by 12%.",
    icon: "⚡"
  },
  mag_swapper: {
    label: "Mag Swapper",
    desc: "Swapping weapons instantly completes any reload.",
    icon: "⇄"
  },
  vital_harvest: {
    label: "Vital Harvest",
    desc: "Each kill restores 12 HP.",
    icon: "♥"
  }
};

export const PRIMARY_META: Record<StarterPistolId, OptionMeta & { stats: string }> = {
  pistol: {
    label: "Glock 19",
    desc: "Semi-automatic. Accurate and dependable at range.",
    icon: "⌖",
    stats: "30 DMG · 12 MAG · 9mm · SEMI"
  },
  autoPistol: {
    label: "Auto Pistol",
    desc: "Burst-fire. High capacity. Fast time-to-kill up close.",
    icon: "⌖",
    stats: "18 DMG · 36 MAG · 9mm · BURST"
  }
};

export const LETHAL_META: Record<LethalId, OptionMeta & { stats: string }> = {
  frag: {
    label: "Frag Grenade",
    desc: "Lobbed grenade — arcs through the air, then detonates after the fuse. Press G to throw.",
    icon: "◎",
    stats: "6m Blast · Thrown Arc · 1.8s Fuse · 2 Charges"
  },
  n74st: {
    label: "N 74 ST",
    desc: "Sticky charge — sticks to zombies, walls, or ground, then detonates.",
    icon: "◎",
    stats: "5m Blast · Sticky · 2s Fuse · 2 Charges"
  },
  satchel: {
    label: "C4 Explosive",
    desc: "Tap G to throw up to four flat charges (short toss). Hold G to detonate all at once.",
    icon: "▣",
    stats: "15m Blast · Max 4 Planted · Hold G Det · 4 Charges"
  },
  smine44: {
    label: "S-MINE 44",
    desc: "Bouncing Betty — plant with G (~3s arm). Stepping zombies launch it skyward; air blast plus hot shrapnel.",
    icon: "⛒",
    stats: "Proximity · Pop-Up · Air Blast + Shrapnel · 2 Charges"
  }
};

/* ── Mod shop pricing ────────────────────────────────────────────────────── */

export const MOD_SHOP_PRICES: Record<ModId, number> = {
  extended_mag:   4000,
  quick_hands:    6000,
  stopping_power: 8000,
  scavenger:      5000,
  iron_trigger:   7000,
  dead_eye:       9000,
  thick_skin:     7500,
  fleet_foot:     5500,
  mag_swapper:    6500,
  vital_harvest:  8500
};

/* ── Lethal gameplay parameters (used by GameApp) ───────────────────────── */

/**
 * Timed grenades: {@link LETHAL_PHYSICS} + {@link LETHAL_PARAMS.throwSpeed}.
 * C4 (`satchel`): short toss, up to four live, hold det.
 * S-MINE 44 (`smine44`): placed mine, arm timer, proximity pop, air burst + shrapnel.
 */
export const LETHAL_PHYSICS = {
  gravity: 34,
  /** Extra upward component mixed into camera forward for a lob arc. */
  arcUpBias: 0.42,
  groundRestitution: 0.38,
  groundFriction: 0.76,
  colliderRadius: 0.11,
  /** Hand offset from camera along forward (m). */
  spawnForward: 0.72,
  spawnDown: 0.12,
  glowPulseHz: 3.2,
  /** Fuse window (seconds) before detonation — ramp glow / pulse / shake. Capped to fuse length. */
  fuseWarningMinSeconds: 0.18,
  fuseWarningMaxSeconds: 0.62,
  /** Portion of total fuse (0–1) used to define warning window, mixed with min/max. */
  fuseWarningPortion: 0.34
} as const;

export const LETHAL_PARAMS: Record<
  LethalId,
  {
    blastRadius: number;
    fuseSeconds: number;
    remote: boolean;
    charges: number;
    throwSpeed: number;
    sticky?: boolean;
    stickyColliderRadius?: number;
    /** C4/satchel: multiplies explosion damage vs base 300. */
    explosionDamageMultiplier?: number;
    /** C4/satchel: extra debris, flash core, heavy shake & flicker. */
    megaExplosion?: boolean;
    /** S-MINE 44: deploy arm time before mine goes live. */
    armSeconds?: number;
    triggerRadius?: number;
    popHeight?: number;
    popDuration?: number;
    shrapnelCount?: number;
    shrapnelDamage?: number;
    shrapnelSpeed?: number;
    shrapnelLife?: number;
    shrapnelHitRadius?: number;
  }
> = {
  frag: { blastRadius: 6, fuseSeconds: 1.8, remote: false, charges: 2, throwSpeed: 38 },
  n74st: {
    blastRadius: 5,
    fuseSeconds: 2.0,
    remote: false,
    charges: 2,
    throwSpeed: 35,
    sticky: true,
    stickyColliderRadius: 0.16
  },
  satchel: {
    blastRadius: 15,
    fuseSeconds: 0,
    remote: true,
    charges: 4,
    throwSpeed: 7.5,
    explosionDamageMultiplier: 1.7,
    megaExplosion: true
  },
  smine44: {
    blastRadius: 5.5,
    fuseSeconds: 0,
    remote: false,
    charges: 2,
    throwSpeed: 0,
    explosionDamageMultiplier: 1.12,
    megaExplosion: false,
    armSeconds: 3,
    triggerRadius: 2.45,
    popHeight: 2.05,
    popDuration: 0.38,
    shrapnelCount: 16,
    shrapnelDamage: 62,
    shrapnelSpeed: 24,
    shrapnelLife: 0.42,
    shrapnelHitRadius: 0.42
  }
};

/* ── Persistence ─────────────────────────────────────────────────────────── */

const STORAGE_KEY = "project-gehenna-loadouts-v1";
const LEGACY_STORAGE_KEYS = [
  "lazarus-protocol-loadouts-v1",
  "grave-shift-loadouts-v1"
] as const;

const buildDefaultLoadouts = (): LoadoutData[] => [
  { id: 0, name: "Alpha",   specialAbility: null, mod: null, primary: "pistol",     lethal: null },
  { id: 1, name: "Bravo",   specialAbility: null, mod: null, primary: "pistol",     lethal: null },
  { id: 2, name: "Charlie", specialAbility: null, mod: null, primary: "autoPistol", lethal: null },
  { id: 3, name: "Delta",   specialAbility: null, mod: null, primary: "pistol",     lethal: null },
  { id: 4, name: "Echo",    specialAbility: null, mod: null, primary: "pistol",     lethal: null }
];

export class LoadoutStore {
  private loadouts: LoadoutData[];

  constructor() {
    this.loadouts = this.load();
  }

  getAll(): LoadoutData[] {
    return this.loadouts;
  }

  get(id: number): LoadoutData {
    return this.loadouts[id] ?? this.loadouts[0];
  }

  update(id: number, patch: Partial<Omit<LoadoutData, "id">>): void {
    const slot = this.loadouts[id];
    if (!slot) return;
    Object.assign(slot, patch);
    this.save();
  }

  private load(): LoadoutData[] {
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
      if (!raw) return buildDefaultLoadouts();
      const parsed = JSON.parse(raw) as LoadoutData[];
      if (!Array.isArray(parsed) || parsed.length < MAX_LOADOUTS) return buildDefaultLoadouts();
      const defaults = buildDefaultLoadouts();
      const merged = parsed.slice(0, MAX_LOADOUTS).map((slot, i) => ({
        ...defaults[i],
        ...slot,
        id: i
      }));
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
      return buildDefaultLoadouts();
    }
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.loadouts));
    } catch {
      // localStorage quota exceeded or private browsing
    }
  }
}
