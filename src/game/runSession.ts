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
      "Moonlit gothic fortress on the ridge—torchlit gates, endless spires, and imported open ground. Kite the horde under cold sky.",
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
  animIdleThreshold: GAME_CONFIG.playerVisual.animIdleThreshold
});

let playerVisualRuntime: PlayerVisualRuntime = baseVisual();

/** Per-model overrides (same voxel scale as enemies; animation names match each glTF export). */
export const PLAYER_MODEL_PRESETS: Record<
  PlayerModelId,
  Pick<
    PlayerVisualRuntime,
    | "gltfUrl"
    | "animWalkName"
    | "animRunName"
    | "animFallbackName"
    | "hideBodyInFirstPerson"
  > & { label: string; description: string; previewUrl: string }
> = {
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
    label: "Outbreak survivor",
    description: "Compact voxel rig — same animation set as the horde (placeholder survivor mesh).",
    previewUrl: "/lobby/player-survivor.svg",
    gltfUrl: "/models/players/player.gltf",
    animWalkName: "walk",
    animRunName: "run",
    animFallbackName: "crawling",
    hideBodyInFirstPerson: true
  }
};

export function getPlayerVisualRuntime(): PlayerVisualRuntime {
  return playerVisualRuntime;
}

export function applyPlayerModelPreset(id: PlayerModelId): void {
  const p = PLAYER_MODEL_PRESETS[id];
  playerVisualRuntime = {
    ...baseVisual(),
    gltfUrl: p.gltfUrl,
    animWalkName: p.animWalkName,
    animRunName: p.animRunName,
    animFallbackName: p.animFallbackName,
    hideBodyInFirstPerson: p.hideBodyInFirstPerson
  };
}
