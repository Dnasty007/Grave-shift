import type { Vector3Like } from "hytopia";

/** Starting cash on Dracula's Castle deploy (shown as Money in HUD). */
export const DRACULA_STARTING_MONEY = 100_000;

export type DraculaDoorDef = {
  id: string;
  label: string;
  cost: number;
  position: Vector3Like;
  /** Yaw degrees — 0 = blocks ±X, 90 = blocks ±Z. */
  rotationY: number;
  halfWidth: number;
  halfHeight: number;
  halfDepth: number;
  /** All listed doors must be purchased before this one is available. */
  requires?: string[];
};

/**
 * Buyable door barriers for Dracula's Castle.
 * Barriers sit in doorways on the Mineways mesh; purchasing despawns the blocker and opens the path.
 * Tune positions in-game (fly mode V) and update here.
 */
export const DRACULA_DOORS: DraculaDoorDef[] = [
  {
    id: "courtyard-door",
    label: "Courtyard Door",
    cost: 750,
    position: { x: 15.68, y: -58.5, z: -70.5 },
    rotationY: 0,
    halfWidth: 1.05,
    halfHeight: 1.6,
    halfDepth: 0.4,
  },
  {
    id: "inner-passage",
    label: "Inner Passage",
    cost: 1_250,
    position: { x: 15.68, y: -58.5, z: -58 },
    rotationY: 0,
    halfWidth: 1.05,
    halfHeight: 1.6,
    halfDepth: 0.4,
    requires: ["courtyard-door"],
  },
  {
    id: "east-gallery",
    label: "East Gallery",
    cost: 1_500,
    position: { x: 26, y: -58.5, z: -52 },
    rotationY: 90,
    halfWidth: 1.05,
    halfHeight: 1.6,
    halfDepth: 0.4,
    requires: ["inner-passage"],
  },
  {
    id: "west-gallery",
    label: "West Gallery",
    cost: 1_500,
    position: { x: 5, y: -58.5, z: -52 },
    rotationY: 90,
    halfWidth: 1.05,
    halfHeight: 1.6,
    halfDepth: 0.4,
    requires: ["inner-passage"],
  },
  {
    id: "keep-gate",
    label: "Keep Gate",
    cost: 3_000,
    position: { x: 15.68, y: -58.5, z: -40 },
    rotationY: 0,
    halfWidth: 1.2,
    halfHeight: 1.8,
    halfDepth: 0.45,
    requires: ["east-gallery", "west-gallery"],
  },
];

export function draculaDoorRequirementsMet(
  door: DraculaDoorDef,
  unlocked: ReadonlySet<string>
): boolean {
  if (!door.requires?.length) return true;
  return door.requires.every((id) => unlocked.has(id));
}
