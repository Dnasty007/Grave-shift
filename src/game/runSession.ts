import { GAME_CONFIG, type MapPresetId } from "./config";

export type PlayerModelId = "soldier" | "survivor";

export { type MapPresetId };

export const LOBBY_MAP_ENTRIES: ReadonlyArray<{
  id: MapPresetId;
  title: string;
  description: string;
  previewUrl: string;
}> = [
  {
    id: "castle",
    title: "Castle expanse",
    description:
      "Hytopia-style voxel map (boilerplate map.json) — open ground and blocks; snap-to-ground spawn at the origin stack.",
    previewUrl: "/lobby/map-castle.png"
  },
  {
    id: "yard",
    title: "Vonderburg",
    description:
      "Arena tour of the castle layout—courtyards, keep, halls, and forest approach. Tight COD Zombies–style loop with gates and wall buys.",
    previewUrl: "/lobby/map-yard.png"
  },
  {
    id: "testPlane",
    title: "Test plane",
    description:
      "100×100 flat grid with no GLB — maximum performance for movement, weapons, and FX tuning.",
    previewUrl: "/lobby/map-test-plane.svg"
  }
];

export const LOBBY_PLAYER_ORDER: PlayerModelId[] = ["soldier", "survivor"];

export type PlayerVisualRuntime = {
  useGltf: boolean;
  gltfUrl: string;
  hideBodyInFirstPerson: boolean;
  animWalkName: string;
  animRunName: string;
  animFallbackName: string;
  animRunMinSpeed: number;
  animBaseSpeed: number;
  animSpeedMin: number;
  animSpeedMax: number;
  animIdleThreshold: number;
  /** See `GAME_CONFIG.playerVisual.animIdleShuffle`. */
  animIdleShuffle: number;
};

const baseVisual = (): PlayerVisualRuntime => ({
  useGltf: GAME_CONFIG.playerVisual.useGltf,
  gltfUrl: GAME_CONFIG.playerVisual.gltfUrl,
  hideBodyInFirstPerson: GAME_CONFIG.playerVisual.hideBodyInFirstPerson,
  animWalkName: GAME_CONFIG.playerVisual.animWalkName,
  animRunName: GAME_CONFIG.playerVisual.animRunName,
  animFallbackName: GAME_CONFIG.playerVisual.animFallbackName,
  animRunMinSpeed: GAME_CONFIG.playerVisual.animRunMinSpeed,
  animBaseSpeed: GAME_CONFIG.playerVisual.animBaseSpeed,
  animSpeedMin: GAME_CONFIG.playerVisual.animSpeedMin,
  animSpeedMax: GAME_CONFIG.playerVisual.animSpeedMax,
  animIdleThreshold: GAME_CONFIG.playerVisual.animIdleThreshold,
  animIdleShuffle: GAME_CONFIG.playerVisual.animIdleShuffle
});

let playerVisualRuntime: PlayerVisualRuntime = baseVisual();

/** Per-model overrides (same voxel scale as enemies; animation names match each glTF export). */
type PlayerModelPreset = Pick<
  PlayerVisualRuntime,
  | "gltfUrl"
  | "animWalkName"
  | "animRunName"
  | "animFallbackName"
  | "hideBodyInFirstPerson"
> &
  Partial<
    Pick<
      PlayerVisualRuntime,
      | "animRunMinSpeed"
      | "animBaseSpeed"
      | "animSpeedMin"
      | "animSpeedMax"
      | "animIdleThreshold"
      | "animIdleShuffle"
    >
  > & { label: string; description: string; previewUrl: string };

export const PLAYER_MODEL_PRESETS: Record<PlayerModelId, PlayerModelPreset> = {
  soldier: {
    label: "Field operator",
    description: "Tactical kit with split walk/run lower-body clips (Zombie Forge soldier).",
    previewUrl: "/lobby/player-soldier.svg",
    gltfUrl: "/models/players/soldier-player.gltf",
    animWalkName: "walk_lower",
    animRunName: "run_lower",
    animFallbackName: "crawling",
    hideBodyInFirstPerson: true
  },
  survivor: {
    label: "Hytopia wanderer",
    description:
      "Big-world Blockbench humanoid (Hytopia sdk-examples): lower-body walk/run clips, back-anchor jetpack mount.",
    previewUrl: "/lobby/player-survivor.svg",
    gltfUrl: "/models/players/player.gltf",
    animWalkName: "walk-lower",
    animRunName: "run-lower",
    animFallbackName: "crawling",
    hideBodyInFirstPerson: true
  }
};

export function getPlayerVisualRuntime(): PlayerVisualRuntime {
  return playerVisualRuntime;
}

export function applyPlayerModelPreset(id: PlayerModelId): void {
  const p = PLAYER_MODEL_PRESETS[id];
  const b = baseVisual();
  playerVisualRuntime = {
    ...b,
    gltfUrl: p.gltfUrl,
    animWalkName: p.animWalkName,
    animRunName: p.animRunName,
    animFallbackName: p.animFallbackName,
    hideBodyInFirstPerson: p.hideBodyInFirstPerson,
    animRunMinSpeed: p.animRunMinSpeed ?? b.animRunMinSpeed,
    animBaseSpeed: p.animBaseSpeed ?? b.animBaseSpeed,
    animSpeedMin: p.animSpeedMin ?? b.animSpeedMin,
    animSpeedMax: p.animSpeedMax ?? b.animSpeedMax,
    animIdleThreshold: p.animIdleThreshold ?? b.animIdleThreshold,
    animIdleShuffle: p.animIdleShuffle ?? b.animIdleShuffle
  };
}
