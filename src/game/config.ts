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

import { HYTOPIA } from "./hytopiaContent";
import type { JetpackVariant } from "./JetpackPickup";

export type MapPresetId = "castle" | "yard" | "testPlane";

/** Optional world-space AABB in voxel block coordinates for huge `map.json` imports. */
export type MapJsonVoxelCrop = {
  center: [number, number, number];
  halfExtents: [number, number, number];
};

/** Per-hero glTF jetpack placement (`rigProfiles` key is the file name, e.g. `player.gltf`). */
export type JetpackCosmeticRigProfile = {
  attachBoneNames?: readonly string[];
  localScale?: [number, number, number];
  localPosition?: [number, number, number];
  localEuler?: [number, number, number];
  hideBuiltInMeshNames?: readonly string[];
};

/** Back / cosmetic mesh per {@link JetpackVariant} pickup. */
export type JetpackVariantCosmeticSpec = {
  gltfUrl: string;
  localScale: [number, number, number];
  localPosition: [number, number, number];
  localEuler: [number, number, number];
};

export type MapImportVisualConfig = {
  enabled: boolean;
  replacesArena: boolean;
  /**
   * When true, skips GLB load and builds a flat 100×100 test plane at the origin (grid material).
   * Terrain sampling returns y = 0; use with `playerSpawn.y > 0` for a safe drop.
   */
  useProceduralTestGround: boolean;
  /**
   * When non-empty, builds the world from Hytopia boilerplate `map.json` (under `public/`)
   * instead of loading {@link glbUrl}. Face-culled voxel meshes + solid palette materials.
   */
  jsonVoxelMapUrl?: string;
  /**
   * When set, only blocks inside this AABB (inclusive, block coordinates) are meshed.
   * Use for multi-megabyte Hytopia worlds so GPU/CPU stay bounded.
   */
  jsonVoxelCrop?: MapJsonVoxelCrop;
  /**
   * Diffuse texture root for `textureUri` paths like `blocks/stone.png` (e.g. `/hytopia/blocks`).
   * Defaults in `Map.loadImportedVisual` to {@link HYTOPIA.blockTextures} when omitted.
   */
  jsonVoxelTextureBaseUrl?: string;
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
  useProceduralTestGround: false,
  jsonVoxelMapUrl: HYTOPIA.mapJson,
  jsonVoxelTextureBaseUrl: HYTOPIA.blockTextures,
  /** Chunk around origin; full big-world JSON is ~1.2M blocks — do not mesh without a crop. */
  jsonVoxelCrop: {
    center: [0, 0, 0],
    halfExtents: [52, 48, 52]
  },
  /** Legacy Mineways path (unused when {@link jsonVoxelMapUrl} is set). */
  glbUrl: "/maps/world.glb",
  scale: [1, 1, 1],
  position: [0, 0, 0],
  eulerDegrees: [0, 0, 0],
  cameraFarClip: 8000,
  /** Matches `sdk-examples/big-world` (`playerEntity.spawn(world, { x: 0, y: 10, z: 0 })`); snap finds ground. */
  playerSpawn: { x: 0, y: 10, z: 0 },
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
  useProceduralTestGround: false,
  jsonVoxelMapUrl: undefined,
  jsonVoxelCrop: undefined,
  jsonVoxelTextureBaseUrl: undefined,
  glbUrl: "/maps/world.glb",
  playerSpawn: { x: 0, y: 0, z: 8 },
  playerSpawnYawDegrees: 180,
  openWorldMoveMultiplier: 1.0,
  spawnRing: { min: 8, max: 28 }
};

/** Large flat plane only — no GLB, for movement / perf smoke tests. */
const TEST_PLANE_IMPORT: MapImportVisualConfig = {
  ...CASTLE_IMPORT,
  useProceduralTestGround: true,
  enabled: true,
  replacesArena: true,
  jsonVoxelMapUrl: undefined,
  jsonVoxelCrop: undefined,
  jsonVoxelTextureBaseUrl: undefined,
  glbUrl: "/maps/world.glb",
  cameraFarClip: 600,
  playerSpawn: { x: 0, y: 2, z: 0 },
  playerSpawnYawDegrees: 0,
  openWorldMoveMultiplier: 1.0,
  spawnRing: { min: 10, max: 32 }
};

export const MAP_IMPORT_PRESETS: Record<MapPresetId, MapImportVisualConfig> = {
  castle: CASTLE_IMPORT,
  yard: YARD_IMPORT,
  testPlane: TEST_PLANE_IMPORT
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
  /**
   * Development / balance testing. Set `unlimitedLethals: true` for 999 lethal uses with no spend.
   * Turn off for normal gameplay.
   */
  dev: {
    unlimitedLethals: true
  },
  /**
   * Pack-a-Punch — COD Zombies style: pay points to raise tier on the **held** ranged weapon,
   * compound damage, full ammo refill. Melee cannot be upgraded.
   */
  packAPunch: {
    cost: 5000,
    /** Damage multiplier per tier (compounded: effective = factor ^ tier). */
    tierDamageMultiplier: 1.28,
    maxTier: 5,
    modelUrl: "/models/props/Pack_A_Punch.glb",
    modelScale: 1.15,
    interactRadius: 2.85,
    /** Default spawn (m); Y adjusted by arena / terrain snap. Mystery box uses ~(0, 0, 6). */
    position: { x: -6.5, y: 0, z: -5.2 },
    rotationYDegrees: 38
  },
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
  /** Eye height: import mode; scaled by `playerVisual.playerModelScaleMultiplier` with the hero mesh. */
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
    importAutoStepGroundRefBias: 0.55,
    /**
     * Camera on pivot in **third person** (local space): +Z pulls back behind the head; +Y raises slightly.
     * Tune if the orbit feels too close or too high.
     */
    thirdPersonCamera: {
      localOffset: [0, 0.28, 2.75] as [number, number, number]
    }
  },
  weapon: {
    damage: 34,
    headshotMultiplier: 2.2,
    fireIntervalSeconds: 0.18,
    range: 100,
    hitRadius: 0.52,
    magazineSize: 24,
    reserveAmmo: 105,
    reloadSeconds: 1.0,
    spreadDegrees: 1.4
  },
  zombie: {
    baseHealth: 70,
    healthPerWave: 16,
    baseSpeed: 1.35,
    speedPerWave: 0.09,
    attackRange: 1.35,
    attackDamage: 7,
    attackCooldownSeconds: 1.1,
    despawnDelaySeconds: 0.1,
    /**
     * Open-world: max vertical change per terrain resnap for zombies (m). Smaller = smoother ramp/stair follow.
     */
    terrainSnapMaxStepY: 0.52
  },
  /**
   * Hytopia Blockbench export scale — applies to **enemy** glTF; player uses
   * `voxelAvatar.modelScale * playerVisual.playerModelScaleMultiplier`.
   */
  voxelAvatar: {
    modelScale: 2.0,
    yOffset: 0,
    yawOffsetDeg: 0
  },
  /**
   * First-person hero glTF (`public/models/players/`). Uses `voxelAvatar` for scale.
   * `soldier-player.gltf` uses `walk_lower` / `run_lower`; Hytopia `player.gltf` uses hyphens (`walk-lower` / `run-lower`).
   */
  playerVisual: {
    useGltf: true,
    gltfUrl: "/models/players/soldier-player.gltf",
    /**
     * Extra uniform scale on the hero glTF vs `voxelAvatar.modelScale` (zombies use `modelScale` only).
     * Soldier bind height is slightly below `zombie.gltf` at 2.0; ~1.12–1.18 matches horde height — tune to taste.
     */
    playerModelScaleMultiplier: 1.14,
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
    animIdleThreshold: 0.15,
    /**
     * When > 0 and movement is below {@link animIdleThreshold}, keep the walk clip playing at this
     * rate (matches zombie `enemyVisual.animIdleShuffle` — avoids freezing on frame 0 of full-body walk).
     */
    animIdleShuffle: 0,
    /**
     * Jetpack back meshes: pickup variant (`JetpackPickup`) picks {@link JetpackVariant}.
     * Base tuning was ~0.62; ×1.45 on both for a stronger silhouette on the hero.
     */
    jetpackCosmetic: {
      enabled: true,
      attachBoneNames: ["back_anchor", "back-anchor", "body_piv", "torso"] as const,
      hideBuiltInMeshNames: ["backpack"] as const,
      /** Optional per-hero overrides; Hytopia `player.gltf` uses `back-anchor` (also in default list). */
      rigProfiles: {} as Record<string, JetpackCosmeticRigProfile>,
      variants: {
        marauder: {
          gltfUrl: "/models/players/JetPack_V2.glb",
          localScale: [0.899, 0.899, 0.899] as [number, number, number],
          localPosition: [0, 0, 0] as [number, number, number],
          localEuler: [0, 0, 0] as [number, number, number]
        },
        valkyrie: {
          gltfUrl: "/models/players/rkt44z_valkyrie_V3.glb",
          localScale: [0.899, 0.899, 0.899] as [number, number, number],
          localPosition: [0, 0, 0] as [number, number, number],
          localEuler: [0, 0, 0] as [number, number, number]
        }
      } as Record<JetpackVariant, JetpackVariantCosmeticSpec>
    }
  },
  /**
   * Hytopia / Blockbench glTF (`public/models/enemies/`). Scale is `voxelAvatar` (shared with player).
   */
  enemyVisual: {
    useGltf: true,
    /** Wave spawns: single zombie type for now (add more paths + set {@link randomizeVariant}). */
    gltfUrls: ["/models/enemies/zombie.gltf"] as const,
    /** When true and multiple URLs exist, each spawn picks a random glTF. */
    randomizeVariant: false,
    aimBodyY: 0.92,
    headTargetY: 2.45,
    headRadius: 0.4,
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
  /**
   * Optional rule-based squadmate (Settings: “AI squadmate”). Not related to Hytopia server LLM agents.
   */
  aiAlly: {
    followRight: 2.0,
    followBack: 0.55,
    moveSpeed: 5.85,
    engageRange: 50,
    fireIntervalSeconds: 0.3,
    damageMultiplier: 0.52,
    /** Per-shot chance to aim at head when body is also in LOS (simplified). */
    headshotProbability: 0.11,
    eyeHeight: 1.55,
    radius: 0.48
  },
  /** World / sky presentation (see `sceneSkybox.ts`, `GameApp.configureScene`). */
  sceneLook: {
    /** Procedural starfield cubemap + cooler lighting; `false` restores Hytopia partly-cloudy sky. */
    outerSpaceSky: true
  },
  /**
   * Nine-Tails (Kurama) combat pet: roams near the player (leash), fox-fire + chakra nova.
   * Always active in a run when enabled.
   */
  nineTailsPet: {
    enabled: false,
    glbUrl: "/models/pets/Kurama_NineTails_V3.glb",
    /** Model-specific scale — tune if the import is huge or tiny vs the hero. */
    modelScale: 0.14,
    yOffset: 0,
    yawOffsetDeg: 0,
    /**
     * Wander band on XZ around the player: picks random spots between these horizontal radii.
     * Hard cap: after each move the pet is clamped to {@link roamMaxDistance}.
     */
    roamMinDistance: 2.2,
    roamMaxDistance: 6.2,
    /** Slower retarget = less jittery pathing. */
    roamRetargetSeconds: 6.5,
    roamReachDistance: 1.05,
    moveSpeed: 4.9,
    radius: 0.52,
    /** Fox-fire line attack — paced so it feels like an ability, not a machine gun. */
    foxFireIntervalSeconds: 1.1,
    foxFireDamage: 32,
    foxFireRange: 48,
    /** Chakra nova. */
    tailedBeastIntervalSeconds: 12,
    tailedBeastRadius: 9,
    tailedBeastDamage: 52,
    /**
     * After any fox-fire or bomb, neither ability fires until this elapses (seconds).
     * Stops bomb→fox (or double specials) on the same beat.
     */
    petAttackGlobalCooldownSeconds: 0.65,
    /** Ability hold at spawn so the pet doesn’t instantly nuke wave 1. */
    spawnFoxDelaySeconds: 1.5,
    spawnBombDelaySeconds: 4,
    /**
     * Locomotion clip speed: horizontal speed (m/s) that should read as a natural walk cycle
     * on this model (tune if feet slide or look sluggish).
     */
    animRefHorizSpeed: 3.4,
    animIdlePlayback: 0.9,
    animWalkPlaybackMul: 1.08,
    eyeHeight: 1.35
  },
  waves: {
    startingCount: 16,
    additionalPerWave: 2,
    maxAliveAtOnce: 8
  },
  /**
   * World pickups (not enemies). Max-ammo uses a glowing golden cube — set chance to 0 to disable.
   */
  pickups: {
    maxAmmoDropChanceOnKill: 0
  },
  fx: {
    screenShakeBase: 0.45,
    screenShakeKill: 0.9,
    screenShakeDamage: 1.4,
    muzzleFlashSeconds: 0.06,
    tracerSeconds: 0.05,
    bloodBurstSeconds: 0.45,
    killPopupSeconds: 0.85,
    /**
     * Gameplay + visuals time scale while the radial weapon wheel is open (hold V).
     * ~0.35–0.45 matches a Doom-style slowdown; 1 = no slowdown.
     */
    weaponWheelTimeScale: 0.38
  },
  audio: {
    defaultMaster: 0.75,
    defaultSfx: 0.85,
    defaultMusic: 0.4
  },
  /**
   * Jetpack powerup drop and ability tuning.
   * Drops spawn on zombie kills (dropChanceOnKill) and hover for lifetimeSeconds
   * before despawning. Two variants alternate per drop.
   */
  jetpack: {
    /** Chance a jetpack drop spawns on any zombie kill (independent of max-ammo roll). */
    dropChanceOnKill: 0.07,
    /** Max simultaneous jetpack pickups in the world at once. */
    maxActiveDrops: 2,
    /** How long the pickup hovers before disappearing (seconds). */
    lifetimeSeconds: 60,
    /** How long the player keeps the jetpack ability after picking it up (seconds). */
    powerupDurationSeconds: 60,
    /** Thruster fuel (seconds of full burn at 1× drain); refilled on each pickup. */
    thrusterFuelMax: 14,
    /** Upward acceleration (m/s²) while holding jump mid-air with fuel. */
    thrusterUpAccel: 28,
    /** Cap upward speed from thrusters (m/s). */
    thrusterMaxUpSpeed: 22,
    /** Fuel consumed per second while thrusting. */
    thrusterFuelDrainPerSecond: 1,
    /** While jetpack active, airborne, falling, holding jump — max downward speed if not thrusting (m/s). */
    glideMaxFallSpeed: 7,
    /** Fall distances below this (feet to ground apex delta, m) never hurt. */
    fallSafeHeightMeters: 4.2,
    /** HP lost per meter fallen beyond {@link fallSafeHeightMeters}. */
    fallDamagePerMeter: 9
  },
  /**
   * Easter egg: three teddy GLBs in the arena. Each new bear hit plays `hitSoundUrl`;
   * after all three are destroyed, `rewardSongUrl` plays once per run (music bus).
   */
  teddyBearEasterEgg: {
    enabled: true,
    modelUrl: "/models/easter/ww2_bear_ultimate_base.glb",
    modelScale: 1.35,
    modelYOffset: 0,
    hitRadius: 0.4,
    hitCenterYOffset: 0.34,
    spawnPositions: [
      { x: -13, y: 0, z: 11 },
      { x: 15, y: 0, z: -8 },
      { x: 5, y: 0, z: -15 }
    ],
    hitSoundUrl: "/audio/easter/teddy-hit.mp3",
    rewardSongUrl: "/audio/easter/teddy-easter-song.mp3"
  }
} as const;
