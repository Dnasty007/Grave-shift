import type { PlayerEntity } from "hytopia";
import SwordEntity, {
  SWORD_HAND_POSITION,
  SWORD_HAND_ROTATION,
  type SwordEntityOptions,
} from "./SwordEntity";

export { default as SwordEntity } from "./SwordEntity";
export { SWORD_HAND_POSITION, SWORD_HAND_ROTATION };
export type { SwordEntityOptions };

export const SWORD_IDS = [
  "wooden",
  "stone",
  "iron",
  "golden",
  "emerald",
  "ruby",
  "diamond",
  "sapphire",
] as const;
export type SwordId = (typeof SWORD_IDS)[number];

export const SWORD_DISPLAY_NAME: Record<SwordId, string> = {
  wooden:   "Wooden Sword",
  stone:    "Stone Sword",
  iron:     "Iron Sword",
  golden:   "Golden Sword",
  emerald:  "Emerald Sword",
  ruby:     "Ruby Sword",
  diamond:  "Diamond Sword",
  sapphire: "Sapphire Sword",
};

const SWORD_MODEL_URI: Record<SwordId, string> = {
  wooden:   "models/items/swords/sword-wooden.gltf",
  stone:    "models/items/swords/sword-stone.gltf",
  iron:     "models/items/swords/sword-iron.gltf",
  golden:   "models/items/swords/sword-golden.gltf",
  emerald:  "models/items/swords/sword-emerald.gltf",
  ruby:     "models/items/swords/sword-ruby.gltf",
  diamond:  "models/items/swords/sword-diamond.gltf",
  sapphire: "models/items/swords/sword-sapphire.gltf",
};

/** Melee damage tuned for the zombie HP curve (guns use ~30–40 per shot). */
const SWORD_DAMAGE: Record<SwordId, number> = {
  wooden:   28,
  stone:    38,
  iron:     52,
  golden:   68,
  emerald:  82,
  ruby:     92,
  diamond:  110,
  sapphire: 100,
};

export function isSwordId(raw: unknown): raw is SwordId {
  return typeof raw === "string" && (SWORD_IDS as readonly string[]).includes(raw);
}

export function createSword(
  id: SwordId,
  parent: PlayerEntity,
  hooks: Pick<SwordEntityOptions, "onSwing" | "onHit">
): SwordEntity {
  return new SwordEntity({
    name: SWORD_DISPLAY_NAME[id],
    modelUri: SWORD_MODEL_URI[id],
    modelScale: 2.0,
    damage: SWORD_DAMAGE[id],
    swingRate: 1.35,
    range: 3.8,
    parent,
    ...hooks,
  });
}
