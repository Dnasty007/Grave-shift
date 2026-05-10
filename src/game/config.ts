/**
 * Central tuning for Grave Shift.
 *
 * • **MAP_CONFIG** — Imported world (`Map.ts`, open-world branches elsewhere): GLB path/transform,
 *   spawn, zombie ring, CPU vertical terrain ray + cling + HUD “Drop to ground”.
 * • **GAME_CONFIG** — Procedural arena scale, player movement/health, weapons, zombie/wave math,
 *   scoring, FX timing. Consumed by `PlayerController`, `Zombie`, `WaveDirector`, `Effects`, etc.
 *
 * Mineways: typically 1 block = 1 m in the OBJ (`1000 mm` block height).
 * Convert with `npm run convert-map`, then tune spawn + fog if the world feels wrong.
 *
 * `replacesArena`: drops the old yard (walls, doors, wall buys, gate spawns, prop collision)
 * so you explore the imported mesh. Collision against buildings is not implemented yet
 * (everyone moves in XZ; tweak `playerSpawn.y` to stand above terrain).
 */
export type MapPresetId = "castle" | "yard";

export type MapImportVisualConfig = {
  enabled: boolean;
  replacesArena: boolean;
  glbUrl: string;
  scale: [number, number, number];
  position: [number, number, number];
  eulerDegrees: [number, number, number];
  cameraFarClip: number;
  playerSpawn: { x: number; y: number; z: number };
  playerSpawnYawDegrees: number;
  openWorldMoveMultiplier: number;
  spawnRing: { min: number; max: number };
  snapFeetToGround: boolean;
  groundSnapClearance: number;
  terrainRayTopY: number;
  terrainRayBottomY: number;
  terrainRayStartAboveFeet: number;
  terrainRayMaxDropFromRef: number;
  terrainFollowIntervalSeconds: number;
  terrainFollowMaxStepY: number;
  zombieTerrainResnapIntervalSeconds: number;
  gravityDropAcceleration: number;
  /**
   * Faces with |world normal Y| above this are treated as floors/ceilings for horizontal blocking
   * (not walls). Higher = fewer false blocks on outdoor slopes and grass tops.
   */
  importWallNormalYNMax: number;
  /**
   * Horizontal hits at most this far **above** sampled terrain (m) are ignored — walk through short
   * grass / turf / decals. 0 disables. ~0.5 for typical voxel lawns; raise if tall grass still blocks.
   */
  importMeshFoliagePassThroughHeight: number;
};

const CASTLE_IMPORT: MapImportVisualConfig = {
  enabled: true,
  replacesArena: true,
  /** `public/maps/world.glb` from Mineways export. */
  glbUrl: "/maps/world.glb",
  scale: [1, 1, 1],
  position: [0, 0, 0],
  eulerDegrees: [0, 0, 0],
  cameraFarClip: 8000,
  playerSpawn: { x: 17.4801, y: 1, z: -95.2988 },
  playerSpawnYawDegrees: 0,
  openWorldMoveMultiplier: 1.0,
  spawnRing: { min: 8, max: 28 },
  snapFeetToGround: true,
  groundSnapClearance: 0,
  terrainRayTopY: 100,
  terrainRayBottomY: -100,
  terrainRayStartAboveFeet: 5,
  terrainRayMaxDropFromRef: 20,
  terrainFollowIntervalSeconds: 0.08,
  terrainFollowMaxStepY: 8,
  zombieTerrainResnapIntervalSeconds: 0.22,
  gravityDropAcceleration: 42,
  importWallNormalYNMax: 0.78,
  importMeshFoliagePassThroughHeight: 0.55
};

/** Procedural arena: no GLB; gates, wall buys, original yard flow. */
const YARD_IMPORT: MapImportVisualConfig = {
  ...CASTLE_IMPORT,
  enabled: false,
  replacesArena: false,
  glbUrl: "/maps/world.glb",
  playerSpawn: { x: 0, y: 0, z: 8 },
  playerSpawnYawDegrees: 180,
  openWorldMoveMultiplier: 1.0,
  spawnRing: { min: 8, max: 28 }
};

export const MAP_IMPORT_PRESETS: Record<MapPresetId, MapImportVisualConfig> = {
  castle: CASTLE_IMPORT,
  yard: YARD_IMPORT
};

/** Replaces active `MAP_CONFIG.importVisual` (call before world rebuild / `startRun`). */
export function applyMapPreset(id: MapPresetId): void {
  MAP_CONFIG.importVisual = structuredClone(MAP_IMPORT_PRESETS[id]);
}

/** Mutable at runtime — defaults match **castle** until `applyMapPreset` runs. */
export const MAP_CONFIG: { importVisual: MapImportVisualConfig } = {
  importVisual: structuredClone(MAP_IMPORT_PRESETS.castle)
};

export const GAME_CONFIG = {
  arenaSize: 44,
  wallHeight: 4,
  waveIntermissionSeconds: 5,
  pointsPerHit: 15,
  pointsPerKill: 100,
  pointsPerHeadshot: 175,
  player: {
    maxHealth: 100,
    moveSpeed: 6.2,
    sprintSpeed: 8,
    /** Fly mode (Settings): hold V up, Ctrl down (Space = jump). */
    flyVerticalSpeed: 12,
    /** Initial upward speed when pressing jump (Space). */
    jumpImpulse: 6.5,
    /** Gravity while airborne (m/s²). */
    jumpGravity: 38,
    mouseLookSensitivity: 0.09,
    touchLookSensitivity: 95,
    /**
     * Camera pivot above feet when `MAP_CONFIG.importVisual` is on. Tune with `voxelAvatar.modelScale`
     * so it matches the Hytopia rig eye line (~1.7 m at scale 2).
     */
    importEyeHeightAboveFeet: 1.7,
    /**
     * Imported mesh: max rise per frame for stair / lip snap (`importMeshCollision` on).
     * ~1 m matches many Mineways block stairs.
     */
    importAutoStepMaxRise: 0.95,
    /** Extra forward samples when horizontal move is mostly blocked. */
    importAutoStepProbeAhead: 0.62,
    /**
     * If actual move is below this fraction of intended, treat as blocked and probe for a tread.
     * Higher = step-up triggers earlier (smoother stairs).
     */
    importAutoStepStuckRatio: 0.82,
    /**
     * Forward ground sample distance from feet (toward intent) to catch the next tread before the
     * wall collider stops XZ completely.
     */
    importAutoStepLeadForward: 0.78,
    /** Bias (m) added to feet Y when ray-picking ground for stuck-state probes (see next tread). */
    importAutoStepGroundRefBias: 0.55
  },
  weapon: {
    damage: 34,
    headshotMultiplier: 2.2,
    fireIntervalSeconds: 0.18,
    range: 78,
    hitRadius: 0.52,
    magazineSize: 12,
    reserveAmmo: 96,
    reloadSeconds: 1.6,
    spreadDegrees: 1.4
  },
  zombie: {
    baseHealth: 70,
    healthPerWave: 16,
    baseSpeed: 1.35,
    speedPerWave: 0.09,
    attackRange: 1.35,
    attackDamage: 11,
    attackCooldownSeconds: 1.1,
    despawnDelaySeconds: 0.1,
    /** Max degrees per second when turning toward the player (smoother than instant snap). */
    trackYawDegPerSecond: 440,
    /** Chase direction low-pass (Hz); higher = snappier pathing, lower = smoother strafes. */
    trackDirectionSmoothHz: 10,
    /**
     * Open-world: max vertical change per terrain resnap for zombies (m). Smaller = smoother ramp/stair follow.
     */
    terrainSnapMaxStepY: 0.52
  },
  /**
   * Hytopia Blockbench export scale — applies to **player** and **enemy** glTF so they match height.
   */
  voxelAvatar: {
    modelScale: 2.0,
    yOffset: 0,
    yawOffsetDeg: 0
  },
  /**
   * First-person hero glTF (`public/models/players/`). Uses `voxelAvatar` for scale.
   * `soldier-player.gltf` (Zombie Forge) uses Blockbench split clips: `walk_lower` / `run_lower`.
   */
  playerVisual: {
    useGltf: true,
    gltfUrl: "/models/players/soldier-player.gltf",
    /** Disable body `render` components under FP (avoid clipping); set false for body-aware / third-person. */
    hideBodyInFirstPerson: true,
    animWalkName: "walk_lower",
    animRunName: "run_lower",
    animFallbackName: "crawling",
    animRunMinSpeed: 5.0,
    animBaseSpeed: 1.0,
    animSpeedMin: 0.14,
    animSpeedMax: 1.3,
    /** Treat as idle below this horizontal speed (m/s). */
    animIdleThreshold: 0.15
  },
  /**
   * Hytopia / Blockbench glTF (`public/models/enemies/`). Scale is `voxelAvatar` (shared with player).
   */
  enemyVisual: {
    useGltf: true,
    gltfUrls: ["/models/enemies/zombie.gltf"] as const,
    randomizeVariant: false,
    aimBodyY: 0.92,
    headTargetY: 1.72,
    headRadius: 0.3,
    /** glTF animation names (Blockbench export on `zombie.gltf`). */
    animWalkName: "walk",
    animRunName: "run",
    animFallbackName: "crawling",
    /** Use `run` clip when zombie move speed ≥ this (requires clip on model). */
    animRunMinSpeed: 1.75,
    /** Extra multiplier on `AnimComponent.speed` while chasing. */
    animBaseSpeed: 1.0,
    animSpeedMin: 0.12,
    animSpeedMax: 1.5,
    /** Playback scale while in melee range / mostly still. */
    animIdleShuffle: 0.22
  },
  waves: {
    startingCount: 4,
    additionalPerWave: 2,
    maxAliveAtOnce: 8
  },
  fx: {
    screenShakeBase: 0.45,
    screenShakeKill: 0.9,
    screenShakeDamage: 1.4,
    muzzleFlashSeconds: 0.06,
    tracerSeconds: 0.05,
    bloodBurstSeconds: 0.45,
    killPopupSeconds: 0.85
  },
  audio: {
    defaultMaster: 0.75,
    defaultSfx: 0.85,
    defaultMusic: 0.4
  }
} as const;
