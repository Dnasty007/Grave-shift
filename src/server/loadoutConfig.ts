// Explicit .ts extension: this module is imported by tests/loadoutConfig.test.ts,
// which runs under plain `node` — its ESM loader requires the full extension.
import { MAP_DEV_FLAGS, type GehennaMapId } from "./mapConfig.ts";

/** Lethal equipment ids — must match `assets/ui/index.html` loadout grid. */
export type LethalId = "frag" | "n74st" | "satchel" | "smine44";

export type DeployLoadout = {
  lethal: LethalId | null;
};

const LETHAL_IDS: readonly LethalId[] = ["frag", "n74st", "satchel", "smine44"];

export const LETHAL_CHARGES: Record<LethalId, number> = {
  frag:    2,
  n74st:   2,
  satchel: 4,
  smine44: 2
};

/** Short HUD labels (legacy GameApp lethalName mapping). */
export const LETHAL_HUD_LABEL: Record<LethalId, string> = {
  frag:    "FRAG",
  n74st:   "N74ST",
  satchel: "C4",
  smine44: "S-MINE"
};

/** Blast tuning mirrored from legacy `LETHAL_PARAMS` (simplified server-side). */
export const LETHAL_BLAST: Record<
  LethalId,
  { radius: number; fuseSeconds: number; damageMultiplier: number; throwDistance: number }
> = {
  frag:    { radius: 6,   fuseSeconds: 1.8, damageMultiplier: 1,    throwDistance: 10 },
  n74st:   { radius: 5,   fuseSeconds: 2.0, damageMultiplier: 1,    throwDistance: 9  },
  satchel: { radius: 15,  fuseSeconds: 0.5, damageMultiplier: 1.7,  throwDistance: 4  },
  smine44: { radius: 5.5, fuseSeconds: 0,   damageMultiplier: 1.12, throwDistance: 1.5 }
};

export const LETHAL_UNLIMITED_CHARGES = 999;

export function isLethalId(raw: unknown): raw is LethalId {
  return typeof raw === "string" && (LETHAL_IDS as readonly string[]).includes(raw);
}

export function parseDeployLoadout(raw: unknown): DeployLoadout {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return { lethal: null };
  }
  const lethal = (raw as { lethal?: unknown }).lethal;
  if (lethal == null) return { lethal: null };
  return { lethal: isLethalId(lethal) ? lethal : null };
}

export function isUnlimitedLethals(mapId: GehennaMapId): boolean {
  return MAP_DEV_FLAGS[mapId].unlimitedLethals;
}

/** Starting lethal charges for a run (respects map dev flags). */
export function startingLethalCharges(
  mapId: GehennaMapId,
  lethal: LethalId | null
): number {
  if (!lethal) return 0;
  if (isUnlimitedLethals(mapId)) return LETHAL_UNLIMITED_CHARGES;
  return LETHAL_CHARGES[lethal];
}

export function hasLethalCharges(mapId: GehennaMapId, charges: number): boolean {
  return isUnlimitedLethals(mapId) || charges > 0;
}

export function consumeLethalCharge(mapId: GehennaMapId, charges: number): number {
  if (isUnlimitedLethals(mapId)) return charges;
  return Math.max(0, charges - 1);
}
