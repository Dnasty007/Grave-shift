/**
 * Central tuning for Grave Shift.
 *
 * • **MAP_CONFIG** — Imported world (`Map.ts`, open-world branches elsewhere): GLB path/transform,
 *   spawn, zombie ring, first-person eye height, terrain depth-pick + cling + HUD “Drop to ground”.
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
export const MAP_CONFIG = {
  importVisual: {
    enabled: true,
    replacesArena: true,
    glbUrl: "/maps/Map1test.glb",
    scale: [1, 1, 1] as [number, number, number],
    position: [0, 0, 0] as [number, number, number],
    eulerDegrees: [0, 0, 0] as [number, number, number],
    cameraFarClip: 2400,
    /**
     * World-space spawn (meters), same units as the GLB (≈1 block = 1 m).
     * A high Y (e.g. 96) puts you far above Mineways terrain so the map looks
     * like a tiny disk and lateral movement feels meaningless — use street level.
     */
    playerSpawn: { x: 0, y: 14, z: 0 } as { x: number; y: number; z: number },
    playerSpawnYawDegrees: 0,
    /**
     * First-person camera height above the feet (meters). Lower = smaller relative to blocks.
     * Arena mode still uses 1.65 in PlayerController.
     */
    playerEyeHeight: 1.12,
    /** Extra locomotion for huge exports (optional). */
    openWorldMoveMultiplier: 1.65,
    /** Zombies spawn on a ring around you instead of at old gate entities. */
    spawnRing: { min: 22, max: 72 } as { min: number; max: number },
    /**
     * GPU depth-pick straight down at playerSpawn.x/z and place feet on the mesh surface.
     * If picking fails, `playerSpawn.y` is kept.
     */
    snapFeetToGround: true,
    groundSnapClearance: 0.08,
    /**
     * Ground height uses the **median** of several depth picks in a small footprint so one rooftop /
     * leaf hit does not strand you above the dirt.
     */
    terrainSamplePixelOffsets: [
      [0, 0],
      [0, -28],
      [0, 28],
      [-28, 0],
      [28, 0]
    ] as ReadonlyArray<readonly [number, number]>,
    /** Pick buffer half-size; center = pickRes/2 + offset (see terrainSamplePixelOffsets). */
    terrainPickResolution: 128,
    /**
     * Re-pick ground under the player while moving (XZ only) so feet follow slopes and valleys.
     */
    terrainFollowIntervalSeconds: 0.12,
    /** Max vertical change per follow tick (meters); avoids single-frame spikes from bad depth pixels. */
    terrainFollowMaxStepY: 8,
    /**
     * Round-robin: re-snap one living zombie to the mesh this often (GPU cost scales with rate).
     */
    zombieTerrainResnapIntervalSeconds: 0.28,
    /** HUD “Drop to ground”: downward acceleration (m/s²) until feet reach sampled terrain. */
    gravityDropAcceleration: 42
  }
} as const;

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
    mouseLookSensitivity: 0.09,
    touchLookSensitivity: 95
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
    despawnDelaySeconds: 0.1
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
