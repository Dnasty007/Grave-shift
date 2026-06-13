import {
  Audio,
  ColliderShape,
  CollisionGroup,
  CollisionGroupsBuilder,
  Entity,
  EntityModelAnimationLoopMode,
  DefaultPlayerEntityController,
  GameServer,
  Player,
  PlayerCameraMode,
  PlayerEntity,
  RigidBodyType,
  World,
  WorldLoopEvent,
  type Vector3Like,
  type WorldLoopEventPayloads,
  type WorldMap
} from "hytopia";
import worldMap from "../../assets/map.json";
import testMap from "../../assets/test-map.json";
import castleMap from "../../assets/high-bastion-map.json";
import sprawlMap from "../../assets/the-sprawl-map.json";
import {
  DEFAULT_MAP_ID,
  type GehennaMapId,
  hordesEnabledForMap,
  isSpawnInMapBounds,
  MAP_FOLIAGE_BLOCK_IDS,
  MAP_GROUND_SCAN_MAX_Y,
  MAP_MAX_SPAWN_GROUND_Y,
  MAP_SPAWN,
  normalizeMapId
} from "./mapConfig";
import {
  consumeLethalCharge,
  hasLethalCharges,
  LETHAL_BLAST,
  LETHAL_HUD_LABEL,
  parseDeployLoadout,
  startingLethalCharges,
  type DeployLoadout,
  type LethalId
} from "./loadoutConfig";

import { VFX } from "./VFX";
import { WeaponManager } from "./WeaponManager";
import { LethalSystem } from "./lethals/LethalSystem";
import { buildImportedGunPickups, createGun, GUN_DISPLAY_NAME, type GunEntity, type GunId } from "./guns";
import { IceDragonBoss, iceDragonSpawnY } from "./bosses/IceDragonBoss";
import { LayoutEditor } from "./devtools/LayoutEditor";
import { Quaternion } from "hytopia";

// ─────────────────────────────────────────────────────────────────────────────
// Constants (mirrors legacy GAME_CONFIG — see legacy-playcanvas-client/src/game/config.ts)
// ─────────────────────────────────────────────────────────────────────────────

// Zombie tuning
const Z_BASE_HEALTH        = 70;
const Z_HEALTH_PER_WAVE    = 16;
const Z_BASE_SPEED         = 1.35;
const Z_SPEED_PER_WAVE     = 0.09;
const Z_ATTACK_RANGE       = 1.35;   // metres
const Z_ATTACK_DAMAGE      = 35;     // HP per melee hit (3 hits = death without Jug, like classic COD Zombies). Triggers heavy red flash + shake + hit sound.
const Z_ATTACK_COOLDOWN_S  = 1.1;   // seconds between zombie melee swings

// Wave director
const WAVE_STARTING_COUNT       = 16;   // total spawns in wave 1
const WAVE_ADDITIONAL_PER_WAVE  = 2;    // extra spawns each subsequent wave
const WAVE_MAX_ALIVE_AT_ONCE    = 8;    // cap on concurrent living zombies
const WAVE_FIRST_INTERMISSION_S = 1.8;  // delay before wave 1 starts
const WAVE_INTERMISSION_S       = 5.0;  // delay between waves
const SPAWN_STAGGER_S           = 0.45; // seconds between individual spawns
const SPAWN_RING_MIN            = 10;   // min spawn distance from player (m)
const SPAWN_RING_MAX            = 24;   // max spawn distance from player (m)

// Player
const PLAYER_MAX_HEALTH = 100;

// Weapon damage tuning. Guns now live in src/server/guns/ (faithful port of the
// official zombies-fps gun system) — each GunEntity carries its own damage,
// fire rate, clip, reserve, audio, and muzzle flash.
const HEADSHOT_MULTIPLIER = 2.2;

// Headshot detection for raycast hits: a hit counts as a headshot when the bullet's
// impact point is higher than this fraction above the zombie's capsule centre,
// scaled by the zombie's per-row model scale.
const HEADSHOT_Y_THRESHOLD = 0.3; // × row.scale, above entity.position.y

/** Player uses soldier-player.gltf @ 0.5. Zombies use a shorter mesh — scale 1.0 matches player height. */
const ZOMBIE_MODEL_SCALE = 1.0;
const DOG_MODEL_SCALE    = 0.85;


// Zombie body-centre offset for explosion distance checks, per 1.0 of model scale.
const BODY_CENTER_Y = -0.27;  // × row.scale — offset from capsule centre → mid-torso

/** Third-person orbit behind the player (+Z is back in Hytopia). */
const THIRD_PERSON_CAMERA_OFFSET: Vector3Like = { x: 0, y: 0.4, z: 2.5 };
// First-person camera: the OFFICIAL zombies-fps value — a single y offset, nothing else.
const FIRST_PERSON_CAMERA_OFFSET: Vector3Like = { x: 0, y: 0.5, z: 0 };

// Dog explosion body offset (per 1.0 scale, same convention as BODY_CENTER_Y)
const DOG_BODY_CENTER_Y = -0.05;

// Ice Dragon boss — guaranteed on waves 10, 16, 23; rare random chance after wave 23.
const DRAGON_GUARANTEED_WAVES = new Set([10, 16, 23]);
/** Per-wave roll once wave 24+ (unpredictable — players know he CAN appear, not when). */
const DRAGON_LATE_GAME_CHANCE = 0.05;
const DRAGON_KILL_POINTS        = 2000;
const DRAGON_HP_PER_KILL        = 2000;  // each slain dragon makes the next one tougher
const DRAGON_SPAWN_DISTANCE     = 16;    // metres from the player

/** Test Map — interact pillars (F). Blocks are built in generate-test-map.mjs.
 *  This is the dedicated REAL TEST ROOM for fast mechanic iteration:
 *    - Walk-over weapon & lethal lanes (permanent, 999 charges on test)
 *    - Manual wave + boss control
 *    - Clear / God Mode / Max Kit utility pillars for safe + fast testing
 */
const TEST_WAVE_NEXT_XZ: Vector3Like   = { x: 12,  y: 0, z: 0 };
const TEST_WAVE_REPLAY_XZ: Vector3Like = { x: -12, y: 0, z: 0 };
const TEST_BOSS_PILLAR_XZ: Vector3Like = { x: 38,  y: 0, z: 0 };

// Smart low-profile test control positions (colored pad + central block in map + overhead glowing screen entity spawned in code)
const TEST_CLEAR_XZ: Vector3Like  = { x: 0, y: 0, z: 12 };
const TEST_GOD_XZ: Vector3Like    = { x: 0, y: 0, z: -12 };
const TEST_MAXKIT_XZ: Vector3Like = { x: 12, y: 0, z: 12 };

// ── Dev Lab portals ──────────────────────────────────────────────────────────
// Stand on a portal pad in the Test Map and press F to warp into that installed
// map in EDIT mode (no hordes, fly + build freedom). Press F on the return pad
// inside an edit map to come back to the lab. Portals only target real maps.
const PORTAL_DEFS: { mapId: GehennaMapId; label: string; x: number; z: number }[] = [
  { mapId: "industrial_yard", label: "Industrial Yard", x: -24, z: 0 },
  { mapId: "high_bastion",    label: "High Bastion",    x: -24, z: 12 },
  { mapId: "the_sprawl",      label: "The Sprawl",      x: -24, z: -12 },
];
const PORTAL_TRIGGER_R = 2.2;     // how close to a pad before F warps you
const PORTAL_COOLDOWN_MS = 1200;  // debounce so you don't instantly warp back

// Dog wave tuning
const DOG_WAVE_INTERVAL  = 5;    // every Nth wave is a dog wave
const DOG_WAVE_COUNT     = 10;   // dogs spawned in a dog wave
const DOG_BASE_HEALTH    = 45;
const DOG_HEALTH_PER_WAVE = 8;
const DOG_SPEED          = 3.2;  // faster than zombies
const DOG_ATTACK_RANGE   = 1.1;
const DOG_ATTACK_DAMAGE  = 50;   // Much scarier than regular zombies (2 hits can kill) — triggers heavier red flash + shake + lower-pitched hit sound
const DOG_ATTACK_COOLDOWN_S = 0.75;

// Economy (legacy GAME_CONFIG.pointsPerHit/Kill/Headshot)
const PTS_HIT      = 15;
const PTS_KILL     = 100;
const PTS_HEADSHOT = 175;

// Pack-a-Punch
const PAP_COST          = 5_000;
const PAP_MAX_TIER      = 5;
const PAP_DAMAGE_FACTOR = 1.28;

// Mystery Chest
const MYSTERY_COST        = 950;
const MYSTERY_SPIN_MS     = 2_800;
const MYSTERY_COOLDOWN_MS = 30_000;

// Props
const INTERACT_RADIUS = 3.2;
const PROP_PAP_POS: Record<GehennaMapId, Vector3Like> = {
  industrial_yard: { x: -12, y: 3.8, z: -8 },
  test_zone:       { x: 10, y: 1.0, z: -35 },  // south plaza, east of hub path
  high_bastion:    { x: 0, y: 1.0, z: 0 },
  the_sprawl:      { x: 12, y: 1.0, z: 8 },
};
const PROP_MYSTERY_POS: Record<GehennaMapId, Vector3Like> = {
  industrial_yard: { x: -30, y: 3.8, z: 4 },
  test_zone:       { x: -10, y: 1.0, z: -35 }, // south plaza, west of hub path
  high_bastion:    { x: 0, y: 1.0, z: 0 },
  the_sprawl:      { x: -12, y: 1.0, z: 8 },
};

// Test Map easter-egg teddies — northeast corner foliage markers.
const TEDDY_POSITIONS: Vector3Like[] = [
  { x: 42, y: 1.2, z: 42 },
  { x: 45, y: 1.2, z: 44 },
  { x: 40, y: 1.2, z: 45 },
];

// Explosion safety: Never destroy blocks at or below this Y to protect the main floor of the map.
const WORLD_FLOOR_PROTECTION_Y = 1;

// C4 Jump perk (fun rocket jump when standing on your own C4)
const C4_JUMP_RADIUS = 3.8;
const C4_JUMP_FORCE = 32;        // very strong upward when right on top
const C4_JUMP_HORIZONTAL = 7;    // allows some creative movement (directional jumps)

/** Host-only desktop dev fly — V or pause menu; WASD move, Space up, Shift down. */
const FLY_MOVE_SPEED = 18;

// Lethal lane — west range off the hub path.
const LETHAL_PICKUP_XZ: { x: number; z: number; lethalId: LethalId; label: string; model: string; scale: number }[] = [
  { x: -38, z: -6,  lethalId: "frag",    label: "Frag Grenade",     model: "models/particles/green-sphere.glb", scale: 1.1 },
  { x: -38, z: -2,  lethalId: "n74st",   label: "N 74 ST (Sticky)", model: "models/particles/sticky-bomb.glb",  scale: 1.0 },
  { x: -38, z: 2,   lethalId: "satchel", label: "C4 Satchel",       model: "models/particles/c4-block.glb",     scale: 1.25 },
  { x: -38, z: 6,   lethalId: "smine44", label: "S-Mine 44",        model: "models/particles/smine.glb",        scale: 1.15 },
];

type WeaponPickupDef = {
  x: number;
  z: number;
  weaponKey: GunId;
  label: string;
  model: string;
  scale: number;
};

// Official gun row — north range (import grid farther north via buildImportedGunPickups).
const WEAPON_PICKUP_DEFS: WeaponPickupDef[] = [
  { x: -25, z: 32, weaponKey: "pistol",       label: "Pistol",       model: "models/items/pistol.glb",       scale: 0.8 },
  { x: -15, z: 32, weaponKey: "auto-pistol",  label: "Auto Pistol",  model: "models/items/auto-pistol.glb",  scale: 0.8 },
  { x: -5,  z: 32, weaponKey: "shotgun",      label: "Shotgun",      model: "models/items/shotgun.glb",      scale: 0.8 },
  { x: 5,   z: 32, weaponKey: "auto-shotgun", label: "Auto Shotgun", model: "models/items/auto-shotgun.glb", scale: 0.8 },
  { x: 15,  z: 32, weaponKey: "ar15",         label: "AR-15",        model: "models/items/ar-15.glb",        scale: 0.8 },
  { x: 25,  z: 32, weaponKey: "ak47",         label: "AK-47",        model: "models/items/ak-47.glb",        scale: 0.8 },
  ...buildImportedGunPickups(),
];

// ─────────────────────────────────────────────────────────────────────────────
// UI payload types
// ─────────────────────────────────────────────────────────────────────────────

export type GehennaScreenPayload = {
  type: "screen";
  value: "menu" | "hud";
  /** When returning to menu, which sub-screen to show (default: title). */
  submenu?: "sub-title" | "sub-map-select";
};

export type GehennaRoundPayload = {
  type: "round";
  value: number;
};

export type GehennaHudPayload = {
  type: "gehennaHud";
  health: number;
  maxHealth: number;
  hostiles: number;
  score: number;
  weapon: string;
  magAmmo?: number;
  reserveAmmo?: number;
  caliber?: string;
  reloadFraction?: number;
  wave?: number;
  lethalCharges?: number;
  lethalName?: string;
  /** Ice Dragon boss bar — only present while the boss is alive. */
  bossHealth?: number;
  bossMaxHealth?: number;
  bossName?: string;
  /** When true the client can show a persistent TEST ROOM banner / dev tools hint. */
  testMode?: boolean;
};

export type GehennaRunEndPayload = {
  type: "runEnd";
  kills: number;
  wave: number;
  score: number;
  shotsFired: number;
  shotsHit: number;
  downs: number;
  revives: number;
  survivedSeconds: number;
  headshots: number;
};

export type GehennaPlayerHitPayload = {
  type: "playerHit";
  damage: number;
  isDog?: boolean;
};

export type GehennaUiPayload =
  | GehennaScreenPayload
  | GehennaRoundPayload
  | GehennaHudPayload
  | GehennaRunEndPayload
  | GehennaPlayerHitPayload;

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

type ZombieRow = {
  entity:          Entity;
  hp:              number;
  speed:           number;
  attackCooldownS: number; // seconds until next melee hit allowed
  isDog:           boolean;
  scale:           number; // per-zombie modelScale — used for headshot height + explosion offsets
};

// Mystery box rolls among the official zombies-fps guns (minus whatever you're holding).
const MYSTERY_POOL: GunId[] = ["pistol", "auto-pistol", "shotgun", "auto-shotgun", "ar15", "ak47"];

// ─────────────────────────────────────────────────────────────────────────────
// GehennaDirector
// ─────────────────────────────────────────────────────────────────────────────

export class GehennaDirector {
  private _world: World | null = null;
  private _loadedMapId: GehennaMapId | null = null;
  private _sessionStarted = false;

  /** Sky/lighting applier injected from index.ts (where the skybox profiles live). */
  private _applySky: (world: World, mapId: GehennaMapId) => void = () => {};
  setSkyApplier(fn: (world: World, mapId: GehennaMapId) => void): void { this._applySky = fn; }

  // Identity
  private _hostPlayer: Player | null = null;
  private _currentMapId: GehennaMapId = DEFAULT_MAP_ID;
  private _deployLoadout: DeployLoadout = { lethal: null };

  // Lethal (from deploy loadout)
  private _activeLethal: LethalId | null = null;
  private _lethalCharges   = 0;

  /** Real physics-based lethal throwables (replaces the old static PendingLethalBlast timer hack) */
  private _lethalSystem!: LethalSystem; // assigned in applyLoadoutLethals during resetRunState

  // Zombie horde
  private _zombies: ZombieRow[] = [];

  // Ice Dragon boss (dragon waves)
  private _boss: IceDragonBoss | null = null;
  private _dragonsSlain = 0;
  private _isDragonWave = false;

  // Props
  private _papEntity: Entity | null = null;
  private _mysteryEntity: Entity | null = null;
  private _teddyEntities: Entity[] = [];
  private _launchedTeddies: { entity: Entity; despawnAt: number }[] = [];
  private _lethalPickupEntities: { entity: Entity; lethalId: LethalId; label: string }[] = [];
  private _weaponPickupEntities: {
    entity: Entity;
    weaponKey: GunId;
    label: string;
  }[] = [];
  /** Overhead "UI Screens" for the smart low-profile test control stations (the floating labels + visual markers). */
  private _testControlScreens: Entity[] = [];

  // ── Dev Lab portals + edit mode ──────────────────────────────────────────────
  /** Visual portal pads spawned in the Test Map (one per installed map). */
  private _portalEntities: Entity[] = [];
  /** When set, we are in free-build EDIT mode inside this map (no hordes, fly on). */
  private _devEditMapId: GehennaMapId | null = null;
  /** Debounce timestamp for portal warps. */
  private _lastPortalWarpMs = 0;

  /** In-game model layout tool (grab/move/rotate/scale/save props). */
  private readonly _layout = new LayoutEditor();
  private _layoutCommandsRegistered = false;
  /** Live door-frame entity per portal so a moved/saved door carries its trigger. */
  private _portalDoorByMap = new Map<GehennaMapId, Entity>();

  /** Throttle for automatic proximity hints when near a test control station. */
  private _lastTestHintMs = 0;
  private _teddyVictorySongPlayed = false; // Only play "The Piston Stops" once per run when all 3 teddies are shot
  private _teddyVictorySong: any = null; // Store the Audio instance so we can stop it on menu / new game

  // For Test Map: track blocks we destroyed this run so we can restore them on restart
  private _destroyedBlocksThisRun: { pos: Vector3Like; originalBlockId: number }[] = [];

  // ── Wave director state ──────────────────────────────────────────────────────
  private _round             = 0;
  private _waveActive        = false;
  private _intermissionTimer = 0;   // seconds; fires startNextWave when it hits 0
  private _queuedSpawns      = 0;   // zombies still to drip-spawn this wave
  private _spawnCooldownS    = 0;   // seconds until next individual spawn is allowed
  private _isDogWave         = false;

  // Per-wave tuning (updated in startNextWave)
  private _waveZombieHealth = Z_BASE_HEALTH;
  private _waveZombieSpeed  = Z_BASE_SPEED;

  // ── Player state ─────────────────────────────────────────────────────────────
  private _health    = PLAYER_MAX_HEALTH;
  private _points    = 0;
  private _runStartMs = 0;

  // ── Run stats ────────────────────────────────────────────────────────────────
  private _kills      = 0;
  private _headshots  = 0;
  private _shotsFired = 0;
  private _shotsHit   = 0;
  private _downs      = 0;
  private _revives    = 0;

  // ── Weapon (official zombies-fps GunEntity system) ──────────────────────────
  /** The currently equipped gun — a child entity of the player's hand anchor. */
  private _gun: GunEntity | null = null;
  private _gunId: GunId = "ar15";   // start with the rifle (Assault Rifle feel)
  private _packTier = 0;
  private _outOfAmmoMsgAtMs = 0;    // throttle for "Out of ammo!" chat

  // ── Input / fire timing ──────────────────────────────────────────────────────
  private _prevF  = false;
  private _prevC  = false;
  /** Edge detect for lethal throw (wire key **n**; local client maps **G** → n). */
  private _prevN  = false;
  /** Timestamp of the last accepted lethal-use — used to debounce the double-fire from UI + input poll. */
  private _lethalUsedAtMs = 0;

  /** Desktop: press C to toggle first / third person during a run. */
  private _thirdPersonActive = false;

  /** Dev fly (host desktop only) — noclip setPosition, Space/Shift for vertical. */
  private _flyMode = false;
  private _prevV = false;
  private _flyToggleAtMs = 0;
  private _savedFlyCtrl: {
    tickInput: boolean;
    canWalk: (controller: DefaultPlayerEntityController) => boolean;
    canRun: (controller: DefaultPlayerEntityController) => boolean;
    canJump: (controller: DefaultPlayerEntityController) => boolean;
    sticksToPlatforms: boolean;
  } | null = null;

  /** True while the client pause overlay is open — freezes wave/zombie/lethal simulation. */
  private _gamePaused = false;

  /** Test Room only: god mode for safe iteration (never die from zombies/boss/explosions while testing). */
  private _testGodMode = false;
  private _savedMovement: {
    canWalk: (controller: DefaultPlayerEntityController) => boolean;
    canRun: (controller: DefaultPlayerEntityController) => boolean;
    canJump: (controller: DefaultPlayerEntityController) => boolean;
  } | null = null;

  // ── Mystery chest ────────────────────────────────────────────────────────────
  private _mysteryBusyUntilMs     = 0;
  private _mysteryCooldownUntilMs = 0;
  private _pendingMysteryWeapon: GunId | null = null;

  // ── HUD throttle ─────────────────────────────────────────────────────────────
  private _lastHudPushMs = 0;

  // ─────────────────────────────────────────────────────────────────────────────
  // Tick handler
  // ─────────────────────────────────────────────────────────────────────────────

  private readonly _onTick = (
    payload: WorldLoopEventPayloads[WorldLoopEvent.TICK_START]
  ) => {
    this.tickGameplay(payload.tickDeltaMs);
  };

  private readonly _onTickEnd = (
    payload: WorldLoopEventPayloads[WorldLoopEvent.TICK_END]
  ) => {
    this.tickFlyMovement(payload.tickDurationMs / 1000);
  };

  private isSessionHost(player: Player): boolean {
    return this._hostPlayer !== null && this._hostPlayer.id === player.id;
  }

  /** Sole player in the world may control run flow if host ref is missing / mismatched. */
  private isSolePlayerInWorld(world: World, player: Player): boolean {
    try {
      const list = GameServer.instance.playerManager.getConnectedPlayersByWorld(world);
      return list.length === 1 && list[0]!.id === player.id;
    } catch {
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ─────────────────────────────────────────────────────────────────────────────

  attach(world: World): void {
    if (this._world === world) return;
    this.detach();
    this._world = world;
    this._loadedMapId = DEFAULT_MAP_ID; // index.ts already loaded assets/map.json
    world.loop.on(WorldLoopEvent.TICK_START, this._onTick);
    world.loop.on(WorldLoopEvent.TICK_END, this._onTickEnd);
    this.registerLayoutCommands(world);
  }

  /** Chat-command interface for the in-game model layout tool (dev rooms). */
  private registerLayoutCommands(world: World): void {
    if (this._layoutCommandsRegistered) return;
    this._layoutCommandsRegistered = true;
    const cm = world.chatManager;

    const isDevRoom = () => this._currentMapId === "test_zone" || this._devEditMapId !== null;

    const withPlayer = (player: Player, fn: (pe: PlayerEntity) => string) => {
      if (!isDevRoom()) { cm.sendPlayerMessage(player, "Layout tools only work in the Dev Lab / edit maps.", "FF6666"); return; }
      const pe = this.getHostPlayerEntity(world, player);
      if (!pe) return;
      cm.sendPlayerMessage(player, fn(pe), "AA88FF");
    };

    cm.registerCommand("/grab",   (player) => withPlayer(player, (pe) => this._layout.grab(player, pe)));
    cm.registerCommand("/drop",   (player) => withPlayer(player, () => this._layout.drop()));
    cm.registerCommand("/save",   (player) => withPlayer(player, () => this._layout.saveAll()));
    cm.registerCommand("/list",   (player) => withPlayer(player, () => this._layout.list()));
    cm.registerCommand("/up",     (player) => withPlayer(player, () => this._layout.nudgeHeight(0.25)));
    cm.registerCommand("/down",   (player) => withPlayer(player, () => this._layout.nudgeHeight(-0.25)));
    cm.registerCommand("/rotate", (player, args) => withPlayer(player, () => this._layout.rotate(parseFloat(args[0] ?? "45") || 45)));
    cm.registerCommand("/scale",  (player, args) => withPlayer(player, () => this._layout.scale(args[0] ?? "1.1")));
    cm.registerCommand("/reset",  (player, args) => withPlayer(player, () => this._layout.reset(args[0])));
  }

  detach(): void {
    // Restore Test Map before we lose the world reference
    this.restoreAndClearTestMapBlocks();

    if (this._world) {
      this._world.loop.off(WorldLoopEvent.TICK_START, this._onTick);
      this._world.loop.off(WorldLoopEvent.TICK_END, this._onTickEnd);
      this._world = null;
    }
    this.clearZombies();
    this.destroyPropEntities();
    if (this._lethalSystem) this._lethalSystem.reset();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Player event handlers (called from index.ts)
  // ─────────────────────────────────────────────────────────────────────────────

  handlePlayerJoined(world: World, player: Player): void {
    this.attach(world);
    if (this._sessionStarted && this._round > 0) {
      this.pushScreenToPlayer(player, "hud");
      this.pushRoundToPlayer(player);
      this.syncHud(player);
    } else {
      this.pushScreenToPlayer(player, "menu");
    }
  }

  handleStartGame(
    world: World,
    player: Player,
    mapIdRaw?: unknown,
    loadoutRaw?: unknown
  ): void {
    const mapId = normalizeMapId(mapIdRaw);
    this._currentMapId = mapId;
    this._deployLoadout = parseDeployLoadout(loadoutRaw);

    if (this._sessionStarted && this.isSessionHost(player)) {
      // Already running — just re-sync (e.g. player clicked Deploy twice)
      this.pushScreenToPlayer(player, "hud");
      this.pushRoundToPlayer(player);
      this.syncHud(player);
      return;
    }

    this._sessionStarted = true;
    this._hostPlayer = player;

    this.stopTeddyVictorySong(); // Stop any victory song when starting a fresh game
    this.resetRunState();
    this.ensureMapLoaded(world, mapId);
    this.teleportHostToMapSpawn(world, player, mapId);
    this.spawnWorldProps(world);

    // Equip the starting rifle (official GunEntity — parented to the hand anchor)
    const peStart = this.getHostPlayerEntity(world, player);
    if (peStart) {
      this.disableFlyMode(world, peStart);
      this.equipGun(world, peStart, this._gunId);
    }

    this.pushScreenToPlayer(player, "hud");
    this.syncHud(player);

    if (this._activeLethal && this._lethalCharges > 0) {
      world.chatManager.sendPlayerMessage(
        player,
        `Lethal ready: ${LETHAL_HUD_LABEL[this._activeLethal]} ×${this._lethalCharges} — press G to throw`,
        "CCAAFF"
      );
    }

    const tip = mapId === "test_zone"
      ? "TEST ROOM — Tiny single floor blocks = buttons. Floating rectangular panels + green light above them = the Minecraft/Roblox-style UI Screens (text on the panel = what it does). Stand under the screen, look up, F to activate. N=full guns, W=999 lethals."
      : mapId === "high_bastion"
        ? "High Bastion — explore only. No horde. Walk the towers and ramparts. LMB fire · R reload · G lethal · F interact · C toggle 1st/3rd person."
        : mapId === "the_sprawl"
          ? "The Sprawl — massive urban zone. Hold the streets. LMB fire · R reload · G lethal · F interact · C toggle 1st/3rd person."
          : "Wave 1 inbound. LMB fire · R reload · G lethal · F interact · C toggle 1st/3rd person.";
    world.chatManager.sendPlayerMessage(player, tip, "00FFAA");
  }

  handlePlayerLeft(world: World, player: Player): void {
    if (this.isSessionHost(player)) {
      this._hostPlayer = null;
      this._sessionStarted = false;
      this._round = 0;
      this.despawnGun();
      this.clearZombies();
      this.destroyPropEntities();
      this.resetWaveDirector();
      if (this._lethalSystem) this._lethalSystem.reset();

      // Restore Test Map blocks if the host left mid-run (prevents permanently destroyed trees for the next session)
      this.restoreAndClearTestMapBlocks();
    }
    void world;
  }

  /**
   * Public helper for reconnects / late joins during an active run.
   * Re-equips the current gun (a fresh GunEntity parented to the new player entity).
   */
  public reattachWeaponForPlayer(player: Player): void {
    if (!this._world || !this._sessionStarted) return;
    if (!this.isSessionHost(player)) return;
    const pe = this.getHostPlayerEntity(this._world, player);
    if (!pe) return;
    this.equipGun(this._world, pe, this._gunId);
  }

  resyncScreenForUiMount(player: Player): void {
    if (this._sessionStarted && this._round > 0) {
      this.pushScreenToPlayer(player, "hud");
      this.pushRoundToPlayer(player);
      this.syncHud(player);
    } else {
      this.pushScreenToPlayer(player, "menu");
    }
  }

  /** Return to main menu from an active run.
   *  Acts as an "insta-die" — all XP / stats earned are saved via runEnd before
   *  the menu is shown. No score penalty applied. */
  quitToMenu(world: World, player: Player): void {
    if (!this.isSessionHost(player)) {
      if (!this.isSolePlayerInWorld(world, player)) {
        world.chatManager.sendPlayerMessage(
          player,
          "Only the session host can quit to the main menu.",
          "FF6666"
        );
        return;
      }
    }

    // Save whatever the player earned during this run (no penalties).
    if (this._sessionStarted && this._runStartMs > 0) {
      const survivedSeconds = Math.floor((performance.now() - this._runStartMs) / 1000);
      player.ui.sendData({
        type:            "runEnd",
        kills:           this._kills,
        wave:            this._round,
        score:           this._points,
        shotsFired:      this._shotsFired,
        shotsHit:        this._shotsHit,
        downs:           this._downs,
        revives:         this._revives,
        survivedSeconds,
        headshots:       this._headshots
      } satisfies GehennaRunEndPayload);
    }

    this.despawnGun();
    this.clearZombies();
    this.destroyPropEntities();
    this.resetWaveDirector();
    this.stopTeddyVictorySong(); // Stop victory song when returning to main menu

    // IMPORTANT: actually put the blocks back before we forget which ones we deleted.
    // This fixes the bug where "destroy trees → die → Main Menu → New Game on Test Map"
    // left the trees permanently gone (the tracking list was discarded without restoring).
    this.restoreAndClearTestMapBlocks();

    this._sessionStarted = false;
    this._round = 0;

    /* Insta-die in run terms: zero HP, stop movement, lobby spawn — then main menu. */
    this._health = 0;
    const pe = this.getHostPlayerEntity(world, player);
    if (pe) {
      this.disableFlyMode(world, pe);
      try {
        pe.setLinearVelocity({ x: 0, y: 0, z: 0 });
      } catch {
        void 0;
      }
    } else {
      this.disableFlyMode(world);
    }
    this.teleportHostToMapSpawn(world, player, DEFAULT_MAP_ID);
    this.syncHud(player);
    this.setGamePaused(world, player, false);
    this.pushScreenToPlayer(player, "menu", "sub-map-select");
    world.chatManager.sendPlayerMessage(player, "Run ended — pick a zone to deploy again.", "AAAAFF");
  }

  /** Restart the run from scratch (also works from the game-over screen after death). */
  restartRun(world: World, player: Player): void {
    // Host only — sole player can recover if host ref was lost (e.g. reconnect edge cases).
    if (!this.isSessionHost(player)) {
      if (!this.isSolePlayerInWorld(world, player)) return;
      this._hostPlayer = player;
    }

    const mapId = this._currentMapId;
    this._sessionStarted = true;
    this._round = 0;

    this.stopTeddyVictorySong(); // Stop victory song on restart / new game
    this.resetRunState();
    this.ensureMapLoaded(world, mapId);
    this.teleportHostToMapSpawn(world, player, mapId);
    this.spawnWorldProps(world);

    // Equip the starting rifle for the new run
    const peRestart = this.getHostPlayerEntity(world, player);
    if (peRestart) {
      this.disableFlyMode(world, peRestart);
      this.equipGun(world, peRestart, this._gunId);
    }

    this.pushScreenToPlayer(player, "hud");
    this.syncHud(player);
    const restartMsg = hordesEnabledForMap(mapId)
      ? "Run restarted — horde re-staged."
      : "Run restarted — explore the bastion.";
    world.chatManager.sendPlayerMessage(player, restartMsg, "88FFCC");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // UI push helpers
  // ─────────────────────────────────────────────────────────────────────────────

  pushScreenToPlayer(
    player: Player,
    screen: "menu" | "hud",
    submenu?: GehennaScreenPayload["submenu"]
  ): void {
    player.ui.sendData({
      type: "screen",
      value: screen,
      ...(submenu ? { submenu } : {}),
    } satisfies GehennaScreenPayload);
    player.ui.lockPointer(screen === "hud");
    if (screen === "hud") {
      this.applyGameplayCamera(player);
    } else {
      // Menu state - force third person with full player model visible
      this._thirdPersonActive = false;
      player.camera.setMode(PlayerCameraMode.THIRD_PERSON);
      player.camera.setOffset({ x: 0, y: 0, z: 0 });
      WeaponManager.equipThirdPerson(player);
    }
  }

  /** First- or third-person camera while in a run (HUD). */
  private applyGameplayCamera(player: Player): void {
    if (this._thirdPersonActive) {
      // Third person: show full player model + gun in hand
      player.camera.setMode(PlayerCameraMode.THIRD_PERSON);
      player.camera.setOffset(THIRD_PERSON_CAMERA_OFFSET);
      WeaponManager.equipThirdPerson(player);
      return;
    }

    // First person — the OFFICIAL zombies-fps camera setup: FP mode, y offset 0.5,
    // hide head/neck/torso/legs so only arms + the held gun render.
    player.camera.setMode(PlayerCameraMode.FIRST_PERSON);
    player.camera.setOffset(FIRST_PERSON_CAMERA_OFFSET);
    WeaponManager.equipFirstPerson(player);
  }

  private tickCameraToggle(host: Player, world: World): void {
    const c     = !!(host.input as { c?: boolean }).c;
    const cRise = c && !this._prevC;
    this._prevC = c;

    if (!cRise) return;

    this._thirdPersonActive = !this._thirdPersonActive;
    this.applyGameplayCamera(host);
    world.chatManager.sendPlayerMessage(
      host,
      this._thirdPersonActive ? "Third-person camera" : "First-person camera",
      "AAAAAA"
    );
  }

  /** Poll V for dev fly toggle (same pattern as camera C). */
  private tickFlyMode(host: Player, pe: PlayerEntity, world: World): void {
    const v     = !!(host.input as { v?: boolean }).v;
    const vRise = v && !this._prevV;
    this._prevV = v;

    if (vRise) {
      this.toggleFlyMode(world, host);
    }

    void pe;
  }

  /** Toggle fly from pause menu (UI) or V key (server input). */
  toggleFlyMode(world: World, player: Player): void {
    const now = performance.now();
    if (now - this._flyToggleAtMs < 280) return;
    this._flyToggleAtMs = now;

    if (!this._sessionStarted) return;
    if (!this.isSessionHost(player) && !this.isSolePlayerInWorld(world, player)) return;

    const pe = this.getHostPlayerEntity(world, player);
    if (!pe) return;

    this.setFlyMode(world, player, pe, !this._flyMode);
  }

  private setFlyMode(world: World, player: Player, pe: PlayerEntity, enabled: boolean): void {
    if (this._flyMode === enabled) return;

    this._flyMode = enabled;
    if (enabled) {
      this.applyFlyMode(pe, true);
      try {
        const pos = pe.position;
        pe.setPosition({ x: pos.x, y: pos.y + 0.5, z: pos.z });
      } catch {
        void 0;
      }
      world.chatManager.sendPlayerMessage(
        player,
        "Dev fly ON — WASD move, Space up, Shift down, V to land",
        "00FFAA"
      );
    } else {
      this.applyFlyMode(pe, false);
      this.landFlyPlayer(world, pe);
      world.chatManager.sendPlayerMessage(player, "Dev fly OFF — landed", "AAAAAA");
    }
  }

  /** Noclip camera-relative movement (runs on TICK_END, after default controller). */
  private tickFlyMovement(dtS: number): void {
    if (!this._flyMode || this._gamePaused) return;

    const w    = this._world;
    const host = this._hostPlayer;
    if (!w || !host || !this._sessionStarted) return;

    const pe = this.getHostPlayerEntity(w, host);
    if (!pe) return;

    const inp = host.input as {
      w?: boolean; a?: boolean; s?: boolean; d?: boolean; sp?: boolean; sh?: boolean;
    };

    const yaw = host.camera.orientation.yaw;
    const fwd = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
    const right = { x: -Math.cos(yaw), z: Math.sin(yaw) };

    let mx = 0;
    let my = 0;
    let mz = 0;
    if (inp.w) { mx += fwd.x; mz += fwd.z; }
    if (inp.s) { mx -= fwd.x; mz -= fwd.z; }
    if (inp.d) { mx += right.x; mz += right.z; }
    if (inp.a) { mx -= right.x; mz -= right.z; }
    if (inp.sp) my += 1;
    if (inp.sh) my -= 1;

    const len = Math.hypot(mx, my, mz);
    if (len < 0.001) return;

    const step = (FLY_MOVE_SPEED * dtS) / len;
    const pos = pe.position;
    try {
      pe.setPosition({
        x: pos.x + mx * step,
        y: pos.y + my * step,
        z: pos.z + mz * step,
      });
      pe.setLinearVelocity({ x: 0, y: 0, z: 0 });
    } catch {
      void 0;
    }
  }

  private applyFlyMode(pe: PlayerEntity, enabled: boolean): void {
    try {
      pe.setGravityScale(enabled ? 0 : 1);
      pe.setLinearVelocity({ x: 0, y: 0, z: 0 });
    } catch {
      void 0;
    }

    const ctrl = pe.controller as DefaultPlayerEntityController | undefined;
    if (!ctrl) return;

    if (enabled) {
      if (!this._savedFlyCtrl) {
        this._savedFlyCtrl = {
          tickInput: pe.isTickWithPlayerInputEnabled,
          canWalk: ctrl.canWalk,
          canRun: ctrl.canRun,
          canJump: ctrl.canJump,
          sticksToPlatforms: ctrl.sticksToPlatforms,
        };
      }
      pe.setTickWithPlayerInputEnabled(false);
      ctrl.sticksToPlatforms = false;
      return;
    }

    if (this._savedFlyCtrl) {
      pe.setTickWithPlayerInputEnabled(this._savedFlyCtrl.tickInput);
      ctrl.canWalk = this._savedFlyCtrl.canWalk;
      ctrl.canRun = this._savedFlyCtrl.canRun;
      ctrl.canJump = this._savedFlyCtrl.canJump;
      ctrl.sticksToPlatforms = this._savedFlyCtrl.sticksToPlatforms;
      this._savedFlyCtrl = null;
    } else {
      pe.setTickWithPlayerInputEnabled(true);
      ctrl.sticksToPlatforms = true;
    }
  }

  /** Drop to walkable ground when leaving dev fly. */
  private landFlyPlayer(world: World, pe: PlayerEntity): void {
    const { x, y, z } = pe.position;
    const ground = this.findGroundTop(world, x, z);
    const landY = ground !== null ? ground + 0.05 : y;
    try {
      pe.setPosition({ x, y: landY, z });
      pe.setLinearVelocity({ x: 0, y: 0, z: 0 });
    } catch {
      void 0;
    }
  }

  private disableFlyMode(world: World, pe?: PlayerEntity): void {
    if (!this._flyMode && !this._savedFlyCtrl) return;
    this._flyMode = false;
    this._prevV = false;
    if (pe) {
      this.applyFlyMode(pe, false);
      this.landFlyPlayer(world, pe);
    }
  }

  /** Client Esc pause — freeze simulation and player movement until resumed. */
  setGamePaused(world: World, player: Player, paused: boolean): void {
    if (!this.isSessionHost(player) && !this.isSolePlayerInWorld(world, player)) return;
    if (!this._sessionStarted) {
      this._gamePaused = false;
      return;
    }

    this._gamePaused = paused;
    const pe = this.getHostPlayerEntity(world, player);

    if (paused) {
      try { player.resetInputs(); } catch { void 0; }
      if (pe) this.applyPauseMovement(pe, true);
      return;
    }

    if (pe) {
      this.applyPauseMovement(pe, false);
      if (this._flyMode) this.applyFlyMode(pe, true);
    }
  }

  private applyPauseMovement(pe: PlayerEntity, paused: boolean): void {
    const ctrl = pe.controller as DefaultPlayerEntityController | undefined;
    if (!ctrl) return;

    if (paused) {
      if (!this._savedMovement) {
        this._savedMovement = {
          canWalk: ctrl.canWalk,
          canRun: ctrl.canRun,
          canJump: ctrl.canJump,
        };
      }
      ctrl.canWalk = () => false;
      ctrl.canRun = () => false;
      ctrl.canJump = () => false;
      try {
        pe.setLinearVelocity({ x: 0, y: 0, z: 0 });
      } catch {
        void 0;
      }
      return;
    }

    if (this._savedMovement) {
      ctrl.canWalk = this._savedMovement.canWalk;
      ctrl.canRun = this._savedMovement.canRun;
      ctrl.canJump = this._savedMovement.canJump;
      this._savedMovement = null;
    }
  }

  private tickPausedPlayer(pe: PlayerEntity): void {
    try {
      pe.setLinearVelocity({ x: 0, y: 0, z: 0 });
    } catch {
      void 0;
    }
  }

  pushRoundToPlayer(player: Player): void {
    if (this._round < 1) return;
    player.ui.sendData({ type: "round", value: this._round } satisfies GehennaRoundPayload);
  }

  pushHudToPlayer(
    player: Player,
    overrides: Partial<GehennaHudPayload> = {}
  ): void {
    // Ammo / reload state now lives on the equipped GunEntity (official pattern).
    const gun = this._gun;

    const payload: GehennaHudPayload = {
      type:           "gehennaHud",
      health:         this._health,
      maxHealth:      PLAYER_MAX_HEALTH,
      hostiles:       this._zombies.length + (this._boss?.isAlive ? 1 : 0),
      score:          this._points,
      weapon:         this.weaponDisplayName(),
      magAmmo:        gun?.ammo ?? 0,
      reserveAmmo:    gun?.reserveAmmo ?? 0,
      caliber:        this._packTier > 0 ? `PaP ×${this._packTier}` : "9×19mm",
      reloadFraction: gun?.isReloading ? gun.reloadProgress : 0,
      wave:           this._round,
      lethalCharges:  this._activeLethal ? this._lethalCharges : undefined,
      lethalName:     this._activeLethal
        ? LETHAL_HUD_LABEL[this._activeLethal]
        : undefined,
      ...(this._boss?.isAlive
        ? {
            bossHealth:    this._boss.hp,
            bossMaxHealth: this._boss.maxHp,
            bossName:      "ICE DRAGON",
          }
        : {}),
      ...(this._currentMapId === "test_zone" ? { testMode: true } : {}),
      ...overrides
    };
    player.ui.sendData(payload);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Main game tick
  // ─────────────────────────────────────────────────────────────────────────────

  private tickGameplay(tickDeltaMs: number): void {
    const w    = this._world;
    const host = this._hostPlayer;
    if (!w || !host || !this._sessionStarted) return;

    const pe = this.getHostPlayerEntity(w, host);
    if (!pe) return;

    if (this._gamePaused) {
      this.tickPausedPlayer(pe);
      return;
    }

    const dtS = tickDeltaMs / 1000;

    // Dev edit mode never runs the horde, even on maps that normally have it.
    if (!this._devEditMapId && hordesEnabledForMap(this._currentMapId)) {
      this.tickWaveDirector(dtS, w, host, pe);
      this.tickMysteryResolve(host, w);
      this.tickZombies(dtS, pe, host, w);

      // endRun() inside tickZombies sets _sessionStarted = false — bail if so
      if (!this._sessionStarted) return;

      // Ice Dragon boss AI (dragon waves). Its attacks can also end the run.
      this._boss?.tick(dtS);
      if (!this._sessionStarted) return;
    }

    this.tickCameraToggle(host, w);
    this.tickFlyMode(host, pe, w);
    this.tickGun(host, w);
    this.tickAds(host, dtS);
    this.tickLethalInput(host, w, dtS);
    this.tickLethalBlasts(w, host, dtS);
    this.tickTeddyBears();
    this.tickLethalPickups(w, pe);
    this.tickWeaponPickups(w, pe);
    this.tickInteract(host, pe, w);
    this.tickTestControlHints(host, w);
    this._layout.tick(host, pe); // grabbed prop follows the player's aim
    this.maybeThrottleHud(host, 80);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Wave director
  // ─────────────────────────────────────────────────────────────────────────────

  private tickWaveDirector(
    dtS: number,
    world: World,
    host: Player,
    pe: PlayerEntity
  ): void {
    // Drain the per-spawn stagger timer
    if (this._spawnCooldownS > 0) {
      this._spawnCooldownS = Math.max(0, this._spawnCooldownS - dtS);
    }

    // Intermission countdown — fires once it reaches zero
    if (this._intermissionTimer > 0) {
      this._intermissionTimer = Math.max(0, this._intermissionTimer - dtS);
      if (this._intermissionTimer === 0) {
        this.startNextWave(world, host);
      }
      return; // nothing else to do during intermission
    }

    // Drip-spawn queued enemies (capped at WAVE_MAX_ALIVE_AT_ONCE)
    if (this._waveActive && this._queuedSpawns > 0) {
      const alive = this._zombies.length;
      if (alive < WAVE_MAX_ALIVE_AT_ONCE && this._spawnCooldownS === 0) {
        if (this._isDogWave) {
          this.spawnOneDog(world, pe);
        } else {
          this.spawnOneZombie(world, pe);
        }
        this._queuedSpawns -= 1;
        this._spawnCooldownS = SPAWN_STAGGER_S;
      }
    }

    // Wave-cleared detection: all queued spawns done, no zombies alive, AND no boss
    if (this._waveActive && this._queuedSpawns === 0 && this._zombies.length === 0 && !this._boss) {
      this._waveActive = false;
      world.chatManager.sendPlayerMessage(
        host,
        `Wave ${this._round} cleared!`,
        "88FF88"
      );
      // Test Map: wait for player to hit Next or Replay — no auto intermission.
      if (this._currentMapId !== "test_zone") {
        this._intermissionTimer = WAVE_INTERMISSION_S;
      }
    }
  }

  private rollDragonWave(wave: number): boolean {
    if (this._currentMapId === "test_zone") return false;
    if (DRAGON_GUARANTEED_WAVES.has(wave)) return true;
    if (wave > 23) return Math.random() < DRAGON_LATE_GAME_CHANCE;
    return false;
  }

  private abortActiveWave(): void {
    this.clearZombies();
    this._waveActive        = false;
    this._intermissionTimer = 0;
    this._queuedSpawns      = 0;
    this._spawnCooldownS    = 0;
  }

  private beginWave(world: World, host: Player, waveNumber: number): void {
    this._round = waveNumber;
    const w = this._round;

    this._isDragonWave = this.rollDragonWave(w);
    this._isDogWave    = !this._isDragonWave && (w % DOG_WAVE_INTERVAL === 0);

    this._waveZombieHealth = Z_BASE_HEALTH + (w - 1) * Z_HEALTH_PER_WAVE;
    this._waveZombieSpeed  = Z_BASE_SPEED  + (w - 1) * Z_SPEED_PER_WAVE;

    if (this._isDragonWave) {
      this._queuedSpawns = 0;
    } else if (this._isDogWave) {
      this._queuedSpawns = DOG_WAVE_COUNT;
    } else {
      this._queuedSpawns = WAVE_STARTING_COUNT + (w - 1) * WAVE_ADDITIONAL_PER_WAVE;
    }

    this._spawnCooldownS = 0;
    this._waveActive     = true;

    this.pushRoundToPlayer(host);
    if (this._isDragonWave) {
      const pe = this.getHostPlayerEntity(world, host);
      if (pe) this.spawnIceDragon(world, pe);
      const msg = DRAGON_GUARANTEED_WAVES.has(w)
        ? `WAVE ${w} — THE ICE DRAGON DESCENDS! Bring it down!`
        : `Something stirs in the sky… THE ICE DRAGON DESCENDS!`;
      world.chatManager.sendPlayerMessage(host, msg, "66CCFF");
    } else if (this._isDogWave) {
      world.chatManager.sendPlayerMessage(
        host,
        `WAVE ${w} — HELLHOUND PACK! ${this._queuedSpawns} dogs inbound!`,
        "FF4444"
      );
    } else {
      world.chatManager.sendPlayerMessage(
        host,
        `WAVE ${w} — ${this._queuedSpawns} hostiles inbound!`,
        "FFAA00"
      );
    }
    this.syncHud(host);
  }

  private startNextWave(world: World, host: Player): void {
    this.beginWave(world, host, this._round + 1);
  }

  private replayCurrentWave(world: World, host: Player): void {
    if (this._round < 1) {
      world.chatManager.sendPlayerMessage(
        host,
        "No wave yet — use the lime Next Wave pillar (east of hub, F) to start Wave 1.",
        "FFAA00"
      );
      return;
    }
    this.abortActiveWave();
    this.beginWave(world, host, this._round);
    world.chatManager.sendPlayerMessage(host, `Replaying Wave ${this._round}…`, "88FF88");
  }

  private advanceTestWave(world: World, host: Player): void {
    this.abortActiveWave();
    this.startNextWave(world, host);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // REAL TEST ROOM utility actions (new pillars)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Instantly remove every living zombie + the boss without ending the run. Perfect for re-testing a specific mechanic. */
  private clearAllHostiles(world: World, host: Player): void {
    const before = this._zombies.length + (this._boss?.isAlive ? 1 : 0);
    this.clearZombies(); // also clears boss
    this._boss = null;
    this._isDragonWave = false;
    world.chatManager.sendPlayerMessage(host, `Test: cleared ${before} hostiles. Arena reset.`, "00FFFF");
    this.syncHud(host);
  }

  /** Toggle god mode (only meaningful on the test map). Health stops decreasing from enemies. */
  private toggleTestGodMode(world: World, host: Player): void {
    if (this._currentMapId !== "test_zone") return;

    this._testGodMode = !this._testGodMode;

    if (this._testGodMode) {
      this._health = PLAYER_MAX_HEALTH; // top up when enabling
    }

    world.chatManager.sendPlayerMessage(
      host,
      this._testGodMode
        ? "TEST GOD MODE ON — you cannot die from enemies (explosions still affect world)."
        : "TEST GOD MODE OFF",
      this._testGodMode ? "00FFAA" : "AAAAAA"
    );
    this.syncHud(host);
  }

  /** Give the tester a strong combat loadout instantly (good gun + high PaP + points + full ammo). */
  private giveTestMaxKit(world: World, pe: PlayerEntity, host: Player): void {
    if (this._currentMapId !== "test_zone") return;

    // Strong late-game feeling gun + high pack tier
    this.equipGun(world, pe, "ak47");
    this._packTier = Math.max(this._packTier, 3);
    this._gun?.refillReserve();

    // Enough points to freely PaP more or buy mystery if desired
    this._points = Math.max(this._points, 12000);

    // Also top up health + give max lethals for the session
    this._health = PLAYER_MAX_HEALTH;
    this._lethalCharges = 999;

    world.chatManager.sendPlayerMessage(
      host,
      "TEST MAX KIT: AK-47 + PaP×3 + 12k pts + full lethals + reserves. Go break things.",
      "FFD700"
    );
    this.syncHud(host);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Ice Dragon boss (dragon waves)
  // ─────────────────────────────────────────────────────────────────────────────

  private spawnIceDragon(world: World, pe: PlayerEntity): void {
    this.clearBoss();

    // Spawn on the arena floor — match player standing height + dragon bbox offset.
    const base = pe.position;
    const playerGround = this.findGroundTop(world, base.x, base.z) ?? 1;
    const playerFloorOffset = base.y - playerGround;
    let spawnPos: Vector3Like = {
      x: base.x + DRAGON_SPAWN_DISTANCE,
      y: iceDragonSpawnY(
        this.findGroundTop(world, base.x + DRAGON_SPAWN_DISTANCE, base.z) ?? playerGround,
        playerFloorOffset
      ),
      z: base.z,
    };
    for (let attempt = 0; attempt < 10; attempt++) {
      const ang = Math.random() * Math.PI * 2;
      const x = base.x + Math.sin(ang) * DRAGON_SPAWN_DISTANCE;
      const z = base.z + Math.cos(ang) * DRAGON_SPAWN_DISTANCE;
      if (!isSpawnInMapBounds({ x, y: 0, z }, this._currentMapId)) continue;
      const groundTop = this.findGroundTop(world, x, z);
      if (groundTop === null || groundTop > MAP_MAX_SPAWN_GROUND_Y[this._currentMapId]) continue;
      spawnPos = { x, y: iceDragonSpawnY(groundTop, playerFloorOffset), z };
      break;
    }

    this._boss = new IceDragonBoss(
      world,
      spawnPos,
      {
        getPlayerPos: () => {
          if (!this._world || !this._hostPlayer) return null;
          const hostPe = this.getHostPlayerEntity(this._world, this._hostPlayer);
          return hostPe?.position ?? null;
        },
        damagePlayer: (amount, isHeavy) => this.damageHost(amount, isHeavy),
        knockbackPlayer: (fromPos, horizontal, vertical) => {
          if (!this._world || !this._hostPlayer) return;
          const hostPe = this.getHostPlayerEntity(this._world, this._hostPlayer);
          if (!hostPe) return;
          const pp = hostPe.position;
          let dx = pp.x - fromPos.x, dz = pp.z - fromPos.z;
          const len = Math.hypot(dx, dz) || 1;
          dx /= len; dz /= len;
          try {
            hostPe.setLinearVelocity({ x: dx * horizontal, y: vertical, z: dz * horizontal });
          } catch {}
        },
        onDeath: () => {
          this._boss = null;
          this._dragonsSlain += 1;
          this._kills += 1;
          this._points += DRAGON_KILL_POINTS;
          if (this._world && this._hostPlayer) {
            this._world.chatManager.sendPlayerMessage(
              this._hostPlayer,
              `ICE DRAGON SLAIN!  +${DRAGON_KILL_POINTS} pts`,
              "FFD700"
            );
            this.syncHud(this._hostPlayer);
          }
        },
        announce: (msg, color) => {
          if (this._world && this._hostPlayer) {
            this._world.chatManager.sendPlayerMessage(this._hostPlayer, msg, color ?? "66CCFF");
          }
        },
      },
      this._dragonsSlain * DRAGON_HP_PER_KILL
    );

    if (this._hostPlayer) {
      this.syncHud(this._hostPlayer);
      world.chatManager.sendPlayerMessage(
        this._hostPlayer,
        `ICE DRAGON — ${this._boss.maxHp} HP. Shoot the body — health bar is at the top of the screen.`,
        "66CCFF"
      );
    }
  }

  /** Damage the host player (boss attacks). Mirrors the zombie melee feedback path. */
  private damageHost(amount: number, isHeavy: boolean): void {
    const world = this._world;
    const host  = this._hostPlayer;
    if (!world || !host || !this._sessionStarted) return;

    // REAL TEST ROOM god mode: ignore boss damage while testing
    if (!(this._testGodMode)) {
      this._health = Math.max(0, this._health - amount);
    }

    // Red flash + screen shake on the client (same payload the zombie melee uses;
    // isDog=true triggers the heavier feedback — fitting for dragon hits)
    try {
      host.ui.sendData({
        type: "playerHit",
        damage: amount,
        isDog: isHeavy,
      } satisfies GehennaPlayerHitPayload);
    } catch {}

    this.syncHud(host);

    if (this._health <= 0) {
      this.endRun(world, host);
    }
  }

  private clearBoss(): void {
    if (this._boss) {
      this._boss.destroy();
      this._boss = null;
    }
  }

  private spawnOneZombie(world: World, pe: PlayerEntity): void {
    const base = pe.position;
    const zScale = ZOMBIE_MODEL_SCALE;
    const capHalf = 0.45 * zScale;
    const capRad  = 0.28 * zScale;

    for (let attempt = 0; attempt < 10; attempt++) {
      const ang  = Math.random() * Math.PI * 2;
      const dist = SPAWN_RING_MIN + Math.random() * (SPAWN_RING_MAX - SPAWN_RING_MIN);
      const targetX = base.x + Math.sin(ang) * dist;
      const targetZ = base.z + Math.cos(ang) * dist;

      if (!isSpawnInMapBounds({ x: targetX, y: 0, z: targetZ }, this._currentMapId)) continue;

      const groundTop = this.findGroundTop(world, targetX, targetZ);
      if (groundTop === null || groundTop > MAP_MAX_SPAWN_GROUND_Y[this._currentMapId]) continue;

      const spawnPos: Vector3Like = {
        x: targetX,
        y: groundTop + capHalf + capRad,
        z: targetZ,
      };

      const zEnt = new Entity({
        name:       `Zombie-W${this._round}-${(Date.now() % 100_000)}`,
        tag:        "gehenna-zombie",
        modelUri:   "models/enemies/zombie.gltf",
        modelScale: zScale,
        rigidBodyOptions: {
          type: RigidBodyType.KINEMATIC_VELOCITY,
          colliders: [
            {
              shape:      ColliderShape.CAPSULE,
              halfHeight: capHalf,
              radius:     capRad,
              tag:        "body"
            }
          ]
        }
      });
      zEnt.spawn(world, spawnPos);

      const RUN_THRESHOLD = Z_BASE_SPEED + 5 * Z_SPEED_PER_WAVE;
      if (this._waveZombieSpeed >= RUN_THRESHOLD) {
        const runAnim = zEnt.getModelAnimation("run");
        if (runAnim) {
          runAnim.setLoopMode(EntityModelAnimationLoopMode.LOOP);
          runAnim.setPlaybackRate(Math.min(this._waveZombieSpeed / RUN_THRESHOLD, 1.5));
          runAnim.play();
        }
      } else {
        const walkAnim = zEnt.getModelAnimation("walk");
        if (walkAnim) {
          walkAnim.setLoopMode(EntityModelAnimationLoopMode.LOOP);
          const t = (this._waveZombieSpeed - Z_BASE_SPEED) / (RUN_THRESHOLD - Z_BASE_SPEED);
          walkAnim.setPlaybackRate(0.5 + t * 0.5);
          walkAnim.play();
        }
      }

      this._zombies.push({
        entity:          zEnt,
        hp:              this._waveZombieHealth,
        speed:           this._waveZombieSpeed,
        attackCooldownS: 0,
        isDog:           false,
        scale:           zScale
      });
      return;
    }
  }

  private spawnOneDog(world: World, pe: PlayerEntity): void {
    const base = pe.position;
    const dogScale = DOG_MODEL_SCALE;
    const capHalf = 0.18 * dogScale;
    const capRad  = 0.22 * dogScale;

    for (let attempt = 0; attempt < 10; attempt++) {
      const ang  = Math.random() * Math.PI * 2;
      const dist = SPAWN_RING_MIN + Math.random() * (SPAWN_RING_MAX - SPAWN_RING_MIN);
      const targetX = base.x + Math.sin(ang) * dist;
      const targetZ = base.z + Math.cos(ang) * dist;

      if (!isSpawnInMapBounds({ x: targetX, y: 0, z: targetZ }, this._currentMapId)) continue;

      const groundTop = this.findGroundTop(world, targetX, targetZ);
      if (groundTop === null || groundTop > MAP_MAX_SPAWN_GROUND_Y[this._currentMapId]) continue;

      const spawnPos: Vector3Like = {
        x: targetX,
        y: groundTop + capHalf + capRad,
        z: targetZ,
      };

      const dEnt = new Entity({
        name:       `HellHound-W${this._round}-${(Date.now() % 100_000)}`,
        tag:        "gehenna-zombie",
        modelUri:   "models/npcs/animals/dog-german-shepherd.gltf",
        modelScale: dogScale,
        rigidBodyOptions: {
          type: RigidBodyType.KINEMATIC_VELOCITY,
          colliders: [
            {
              shape:      ColliderShape.CAPSULE,
              halfHeight: capHalf,
              radius:     capRad,
              tag:        "body"
            }
          ]
        }
      });
      dEnt.spawn(world, spawnPos);

      const runAnim = dEnt.getModelAnimation("run");
      if (runAnim) {
        runAnim.setLoopMode(EntityModelAnimationLoopMode.LOOP);
        runAnim.setPlaybackRate(1.2 + (this._round - DOG_WAVE_INTERVAL) * 0.05);
        runAnim.play();
      }

      const dogHp = DOG_BASE_HEALTH + (this._round - 1) * DOG_HEALTH_PER_WAVE;
      this._zombies.push({
        entity:          dEnt,
        hp:              dogHp,
        speed:           DOG_SPEED,
        attackCooldownS: 0,
        isDog:           true,
        scale:           dogScale
      });
      return;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Zombie AI tick
  // ─────────────────────────────────────────────────────────────────────────────

  private tickZombies(
    dtS: number,
    pe: PlayerEntity,
    host: Player,
    world: World
  ): void {
    const pp = pe.position;
    let hudDirty = false;

    for (const row of this._zombies) {
      if (!row.entity.isSpawned) continue;

      // Per-zombie attack cooldown
      if (row.attackCooldownS > 0) {
        row.attackCooldownS = Math.max(0, row.attackCooldownS - dtS);
      }

      const zp  = row.entity.position;
      const dx  = pp.x - zp.x;
      const dz  = pp.z - zp.z;
      const len = Math.hypot(dx, dz);

      const attackRange  = row.isDog ? DOG_ATTACK_RANGE   : Z_ATTACK_RANGE;
      const attackDmg    = row.isDog ? DOG_ATTACK_DAMAGE   : Z_ATTACK_DAMAGE; // 35 / 50 dmg → very punishing without Jug perk
      const attackCooldown = row.isDog ? DOG_ATTACK_COOLDOWN_S : Z_ATTACK_COOLDOWN_S;

      if (len <= attackRange) {
        // In melee range — stop and swing when cooldown allows
        row.entity.setLinearVelocity({ x: 0, y: 0, z: 0 });

        if (row.attackCooldownS === 0) {
          row.attackCooldownS = attackCooldown;

          // REAL TEST ROOM god mode: never take damage while testing
          if (!(this._testGodMode)) {
            this._health = Math.max(0, this._health - attackDmg);
          }
          hudDirty = true;

          // COD-style hit feedback — "getting hit Hurts HARD"
          // Send to client for red flash + screen shake (respects user settings)
          try {
            host.ui.sendData({
              type: "playerHit",
              damage: attackDmg,
              isDog: row.isDog,
            } satisfies GehennaPlayerHitPayload);
          } catch {}

          // Positional hit sound (meaty punch using existing short clip pitched down)
          try {
            const pe = this.getHostPlayerEntity(world, host);
            const hitVol = row.isDog ? 0.95 : 0.78;
            const hitRate = row.isDog ? 0.52 : 0.62;
            const hitSnd = new Audio({
              uri: "audio/ui/ui-click.mp3",
              volume: hitVol,
              playbackRate: hitRate,
              position: pe ? pe.position : undefined,
            });
            hitSnd.play(world);
          } catch {}

          if (this._health <= 0) {
            this.endRun(world, host);
            return; // _zombies cleared inside endRun; stop iterating
          }
        }
      } else {
        // Chase: move directly toward player on XZ plane
        if (len < 0.05) {
          row.entity.setLinearVelocity({ x: 0, y: 0, z: 0 });
        } else {
          const inv = 1 / len;
          row.entity.setLinearVelocity({
            x: dx * inv * row.speed,
            y: 0,
            z: dz * inv * row.speed
          });

          // Hytopia identity faces -Z; atan2(dx, dz) aligns +Z toward the player, so add π.
          const angle = Math.atan2(dx, dz) + Math.PI;
          const hs = Math.sin(angle / 2);
          const hc = Math.cos(angle / 2);
          row.entity.setRotation({ x: 0, y: hs, z: 0, w: hc });
        }
      }
    }

    if (hudDirty) this.syncHud(host);
  }

  /** Poll Hytopia player input for lethal (G → n). Tap = throw/place. Hold (for C4) = detonate all. */
  private tickLethalInput(host: Player, world: World, dtS: number): void {
    const nPress = !!(host.input as { n?: boolean }).n;
    const nRise  = nPress && !this._prevN;
    this._prevN  = nPress;

    if (nRise) {
      this.handleUseLethal(world, host);
    }

    // C4 hold-to-detonate.
    // Skip the very first frame of a press (nRise frame) so the throw from handleUseLethal
    // above isn't immediately treated as the start of a hold → detonation on the same tick.
    if (this._lethalSystem && this._activeLethal === "satchel" && !nRise) {
      this._lethalSystem.tickC4Hold(dtS, world, host);
    }
  }

  /** Throw / plant the equipped lethal. Real Entity physics now live in LethalSystem. */
  handleUseLethal(world: World, player: Player): void {
    if (!this._sessionStarted || !this.isSessionHost(player)) return;

    // 200 ms debounce — prevents the double-throw that happens when BOTH the
    // server input-poll (tickLethalInput) AND a UI keydown message both fire on
    // the same G press.
    const now = performance.now();
    if (now - this._lethalUsedAtMs < 200) return;
    this._lethalUsedAtMs = now;

    const pe = this.getHostPlayerEntity(world, player);
    if (!pe || !this._activeLethal) return;

    if (!hasLethalCharges(this._currentMapId, this._lethalCharges)) {
      world.chatManager.sendPlayerMessage(player, "No lethal charges left.", "FF6666");
      return;
    }

    // Compute a good throw origin (camera eye + forward). The system will add arc.
    const origin = this.getShotOrigin(player, pe);
    const dir    = this.getShotDirection(player);

    // NOTE: C4 tap-to-detonate is intentionally removed.
    // Real C4 is a plant-then-hold device: tap G to THROW the brick, HOLD G to detonate.
    // Detonation is handled exclusively by tickC4Hold (0.65 s hold threshold).

    const res = this._lethalSystem.useLethal(world, pe, this._activeLethal, origin, dir);
    if (!res.ok) {
      if (res.reason) world.chatManager.sendPlayerMessage(player, res.reason, "FFAA66");
      return;
    }

    // Spend the charge (server authority)
    this._lethalCharges = consumeLethalCharge(this._currentMapId, this._lethalCharges);

    const label = LETHAL_HUD_LABEL[this._activeLethal];
    const spec = LETHAL_BLAST[this._activeLethal];
    if (this._activeLethal !== "satchel" && this._activeLethal !== "smine44") {
      world.chatManager.sendPlayerMessage(
        player,
        `${label} thrown — ${spec.fuseSeconds.toFixed(1)}s fuse`,
        "CCAAFF"
      );
    } else if (this._activeLethal === "smine44") {
      world.chatManager.sendPlayerMessage(player, `${label} planted — arming...`, "AACCFF");
    } else {
      world.chatManager.sendPlayerMessage(player, `${label} placed (${this._lethalSystem.getActiveC4Count()}/4). Hold G to detonate.`, "FFCC88");
    }

    this.syncHud(player);
  }

  /** Delegate to real LethalSystem (bouncing nades, sticky, C4, smines + shrapnel) */
  private tickLethalBlasts(world: World, host: Player, dtS = 1 / 60): void {
    if (!this._lethalSystem) return;
    // Gather live zombie positions so S-Mine proximity check triggers on enemies, not the player.
    const zombiePositions = this._zombies
      .filter(z => z.entity.isSpawned)
      .map(z => z.entity.position);
    this._lethalSystem.tick(dtS, world, host, zombiePositions);
  }

  /** Updates any teddy bears that have been shot and are flying away. */
  private tickTeddyBears(): void {
    if (this._launchedTeddies.length === 0) return;

    const now = performance.now();
    const remaining: { entity: Entity; despawnAt: number }[] = [];

    for (const item of this._launchedTeddies) {
      if (now >= item.despawnAt) {
        if (item.entity.isSpawned) item.entity.despawn();
      } else {
        remaining.push(item);
      }
    }

    this._launchedTeddies = remaining;
  }

  /** Auto-equip lethal pickups when the player runs into them (Test Map only) */
  private tickLethalPickups(world: World, pe: PlayerEntity): void {
    if (this._currentMapId !== "test_zone" || this._lethalPickupEntities.length === 0) return;

    const p = pe.position;
    const PICKUP_RADIUS = 1.6; // how close you need to get

    for (let i = this._lethalPickupEntities.length - 1; i >= 0; i--) {
      const pickup = this._lethalPickupEntities[i];
      if (!pickup.entity?.isSpawned) {
        this._lethalPickupEntities.splice(i, 1);
        continue;
      }

      const dist = this.distXZ(p, pickup.entity.position);
      if (dist < PICKUP_RADIUS) {
        // Auto equip (only notify if it actually changed)
        const changed = this._activeLethal !== pickup.lethalId;
        this._activeLethal = pickup.lethalId;
        this._lethalCharges = 999;

        if (changed) {
          world.chatManager.sendPlayerMessage(
            this._hostPlayer!,
            `Equipped: ${pickup.label} (999 charges)`,
            "00FFAA"
          );
          this.syncHud(this._hostPlayer!);
        }

        // Do NOT remove the pickup — they stay forever on the test map for repeated testing
        break; // only process one per frame
      }
    }
  }

  /** ADS: hold right-mouse to zoom. Delegated to WeaponManager (pure FOV lerp). */
  private tickAds(host: Player, dtS: number): void {
    // Only aim in first person; third-person ADS would just zoom the orbit cam awkwardly.
    const aiming = !this._thirdPersonActive
      && host.camera.mode === PlayerCameraMode.FIRST_PERSON
      && !!(host.input as { mr?: boolean }).mr;
    WeaponManager.tickAds(host, dtS, aiming);
  }

  /** Auto-equip weapon pickups when the player runs into them (Test Map only). */
  private tickWeaponPickups(world: World, pe: PlayerEntity): void {
    if (this._currentMapId !== "test_zone" || this._weaponPickupEntities.length === 0) return;
    if (!this._hostPlayer) return;

    const p = pe.position;
    const PICKUP_RADIUS = 1.6;

    for (const pickup of this._weaponPickupEntities) {
      if (!pickup.entity?.isSpawned) continue;
      if (this.distXZ(p, pickup.entity.position) >= PICKUP_RADIUS) continue;

      if (this._gunId === pickup.weaponKey && this._gun) break;
      this.equipGun(world, pe, pickup.weaponKey);
      world.chatManager.sendPlayerMessage(
        this._hostPlayer,
        `Equipped: ${GUN_DISPLAY_NAME[pickup.weaponKey]}`,
        "FFD700"
      );
      break; // one per frame
    }
  }

  // NOTE: the old I/J/K/L/U/O live hand-calibration is gone — and that's the point.
  // The official gun models are authored to fit the hand anchor with ONE fixed
  // transform ({0,0,-0.2} + Euler(-90,0,0)). There is nothing left to calibrate.

  /** Launches a teddy bear into the sky with spin when shot. */
  private launchTeddyBear(teddy: Entity, world: World): void {
    // Remove from alive list
    this._teddyEntities = this._teddyEntities.filter(t => t !== teddy);

    // Play a nice "ding/ring" sound at the teddy's position
    try {
      const ding = new Audio({
        uri: "audio/ui/ui-click.mp3",
        volume: 0.95,
        playbackRate: 1.75, // makes the click sound higher and more "ding"-like
        position: teddy.position,
      });
      ding.play(world);
    } catch (err) {
      // Audio is optional — don't break the feature if it fails
    }

    try {
      // Allow physics to take over
      teddy.setType(RigidBodyType.DYNAMIC);

      // Strong upward launch + some randomness
      const up = 16 + Math.random() * 5;
      const sideways = (Math.random() - 0.5) * 3;
      teddy.setLinearVelocity({
        x: sideways,
        y: up,
        z: (Math.random() - 0.5) * 3,
      });

      // Wild spinning
      teddy.setAngularVelocity({
        x: (Math.random() - 0.5) * 14,
        y: (Math.random() - 0.5) * 22,
        z: (Math.random() - 0.5) * 14,
      });
    } catch (e) {
      // Fallback: just despawn if something goes wrong with rigidbody
      if (teddy.isSpawned) teddy.despawn();
      return;
    }

    // === VICTORY SONG TRIGGER ===
    // If this was the last teddy, play "The Piston Stops" once this run
    if (this._teddyEntities.length === 0 && !this._teddyVictorySongPlayed) {
      this._teddyVictorySongPlayed = true;
      this.playTeddyVictorySong(world);
    }

    // Schedule cleanup
    this._launchedTeddies.push({
      entity: teddy,
      despawnAt: performance.now() + 1600,
    });
  }

  /** Plays the special victory song once when all 3 teddy bears have been shot on the test map. */
  private playTeddyVictorySong(world: World): void {
    try {
      const song = new Audio({
        uri: "audio/easter/the-piston-stops.mp3",
        volume: 0.9,
        loop: false,
      });
      song.play(world);
      this._teddyVictorySong = song; // Store reference so we can stop it later
      console.log("[Teddy Victory] Playing The Piston Stops.mp3");
    } catch (err) {
      console.warn("[Teddy Victory] Failed to play victory song:", err);
    }
  }

  /** Stops the teddy victory song (used when going to menu or starting a new game) */
  private stopTeddyVictorySong(): void {
    if (this._teddyVictorySong) {
      try {
        this._teddyVictorySong.pause();
      } catch (e) {}
      this._teddyVictorySong = null;
    }
  }

  /** Public so the server entrypoint can re-apply the correct sky/lighting profile when the player chooses or restarts on a specific map (e.g. test_zone). */
  getCurrentMapId(): GehennaMapId {
    return this._currentMapId;
  }

  private applyExplosionDamage(
    world: World,
    host: Player,
    center: Vector3Like,
    blastRadius: number,
    damageMultiplier: number
  ): void {
    // VFX is handled by LethalSystem._detonate before calling this fn — don't duplicate it here.
    const baseDamage = 300 * damageMultiplier;
    let hudDirty     = false;

    for (const row of [...this._zombies]) {
      if (!row.entity.isSpawned) continue;

      const zp   = row.entity.position;
      const bodyY = zp.y + (row.isDog ? DOG_BODY_CENTER_Y : BODY_CENTER_Y) * row.scale;
      const dist  = Math.hypot(zp.x - center.x, bodyY - center.y, zp.z - center.z);
      if (dist > blastRadius) continue;

      const falloff = Math.max(0.25, 1 - dist / blastRadius);
      const dmg     = baseDamage * falloff;
      row.hp       -= dmg;
      hudDirty      = true;

      if (row.hp <= 0) {
        const deathPos: Vector3Like = { x: zp.x, y: bodyY, z: zp.z };
        VFX.deathExplosion(world, deathPos);
        if (row.entity.isSpawned) row.entity.despawn();
        this._zombies = this._zombies.filter((z) => z !== row);
        this._kills += 1;
        this._points += PTS_KILL;
      } else {
        this._points += PTS_HIT;
      }
    }

    // Explosions also hurt the Ice Dragon (lethals are a big part of the boss DPS plan)
    if (this._boss?.isAlive) {
      const bp = this._boss.entity.position;
      const dist = Math.hypot(bp.x - center.x, bp.y - center.y, bp.z - center.z);
      // The dragon is huge — give the blast a little extra effective reach against it
      if (dist <= blastRadius + 1.5) {
        const falloff = Math.max(0.25, 1 - dist / (blastRadius + 1.5));
        this._boss.takeDamage(Math.round(baseDamage * falloff));
        this._points += PTS_HIT;
        hudDirty = true;
      }
    }

    if (hudDirty) this.syncHud(host);

    // === Block Destruction & Physics Debris ===
    // Scale destruction based on explosive power so C4 feels devastating
    // while normal grenades do light environmental damage.
    const isHeavyExplosion = damageMultiplier >= 1.5 || blastRadius >= 12;

    if (blastRadius >= 5) {  // even smaller explosives can do *some* light damage
      let destructionRadius = blastRadius * (isHeavyExplosion ? 0.7 : 0.4);
      let debrisDensity = isHeavyExplosion ? 0.82 : 0.22;   // Most blocks become flying pieces on C4, few on normal nades

      const safeMinY = Math.max(WORLD_FLOOR_PROTECTION_Y, Math.floor(center.y - blastRadius * 0.5));

      this.destroyBlocksInRadius(world, center, destructionRadius, safeMinY, debrisDensity);
    }

    // === C4 Jump Perk ===
    // If the player is standing right on their own C4 when it detonates, launch them high.
    // This enables fun rocket-jump style movement and creative play.
    if (damageMultiplier >= 1.4 && this._hostPlayer) {
      const playerEntity = this.getHostPlayerEntity(world, host);
      if (playerEntity?.isSpawned) {
        const playerPos = playerEntity.position;
        const dist = Math.hypot(
          playerPos.x - center.x,
          playerPos.y - center.y,
          playerPos.z - center.z
        );

        if (dist < C4_JUMP_RADIUS) {
          const closeness = 1 - (dist / C4_JUMP_RADIUS);
          const upForce = C4_JUMP_FORCE * closeness;
          const horizontalForce = C4_JUMP_HORIZONTAL * closeness;

          // Direction away from the explosion center for creative movement
          let dx = playerPos.x - center.x;
          let dz = playerPos.z - center.z;
          const hLen = Math.hypot(dx, dz) || 1;
          dx /= hLen;
          dz /= hLen;

          playerEntity.setLinearVelocity({
            x: dx * horizontalForce,
            y: upForce,
            z: dz * horizontalForce,
          });

          // Fun feedback
          world.chatManager.sendPlayerMessage(host, "C4 Jump!", "FFAA00");
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Gun system (official zombies-fps GunEntity pattern)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Equip a gun by id. The gun is constructed already PARENTED to the player's
   * hand anchor, then spawned with the ONE universal local transform from the
   * official example: pos {0,0,-0.2}, Euler(-90,0,0). The official gun models
   * are authored to fit the soldier rig's hand with exactly this transform.
   */
  equipGun(world: World, pe: PlayerEntity, gunId: GunId): void {
    if (this._gun) {
      try { if (this._gun.isSpawned) this._gun.despawn(); } catch {}
      this._gun = null;
    }

    this._gunId = gunId;
    const gun = createGun(gunId, pe, {
      onShoot: () => { this._shotsFired += 1; },
      onHit: (hitEntity, hitPoint, baseDamage) => this.onGunHit(hitEntity, hitPoint, baseDamage),
      resolveHit: (origin, direction, length, primary) => this.resolveGunHit(origin, direction, length, primary),
      onAmmoChanged: () => { if (this._hostPlayer) this.syncHud(this._hostPlayer); },
    });
    gun.spawn(world, { x: 0, y: 0, z: -0.2 }, Quaternion.fromEuler(-90, 0, 0));
    this._gun = gun;
    gun.setParentAnimations();

    if (this._hostPlayer) this.syncHud(this._hostPlayer);
  }

  /** Despawn the equipped gun (run teardown / quit to menu). */
  private despawnGun(): void {
    if (this._gun) {
      try { if (this._gun.isSpawned) this._gun.despawn(); } catch {}
      this._gun = null;
    }
  }

  /**
   * Per-tick gun input (official pattern): LMB → gun.shoot() — the gun itself
   * gates fire rate + ammo and handles audio/anim/muzzle flash/raycast.
   * Semi-auto guns clear input.ml after each shot; full-auto guns keep it held.
   */
  private tickGun(host: Player, world: World): void {
    const gun = this._gun;
    if (!gun || !gun.isSpawned) return;

    const inp = host.input;

    // R = reload (consume the edge so it doesn't repeat)
    if ((inp as { r?: boolean }).r) {
      gun.reload();
      (inp as { r?: boolean }).r = false;

      if (gun.ammo <= 0 && gun.reserveAmmo <= 0) {
        this.notifyOutOfAmmo(host, world);
      }
    }

    // LMB = fire
    if ((inp as { ml?: boolean }).ml) {
      if (gun.ammo <= 0 && gun.reserveAmmo <= 0) {
        this.notifyOutOfAmmo(host, world);
      } else {
        gun.shoot();
      }
    }
  }

  /** Raycast hit resolution — boss, zombies (damage/points/headshots), teddies (test map). */
  private resolveGunHit(
    origin: Vector3Like,
    direction: Vector3Like,
    length: number,
    primary: { entity: Entity; hitPoint: Vector3Like } | null
  ): { entity: Entity; hitPoint: Vector3Like } | null {
    const boss = this._boss;
    if (!boss?.isAlive) return primary;

    const bossEnt = boss.entity;
    if (primary?.entity === bossEnt) return primary;

    const bossPoint = boss.raycastHitPoint(origin, direction, length);
    if (!bossPoint) return primary;

    const distAlongRay = (pt: Vector3Like) =>
      Math.hypot(pt.x - origin.x, pt.y - origin.y, pt.z - origin.z);

    const bossDist = distAlongRay(bossPoint);
    if (primary && distAlongRay(primary.hitPoint) <= bossDist) return primary;

    return { entity: bossEnt, hitPoint: bossPoint };
  }

  private onGunHit(hitEntity: Entity, hitPoint: Vector3Like, baseDamage: number): void {
    const world = this._world;
    const host  = this._hostPlayer;
    if (!world || !host) return;

    // Test-map teddy bears launch when shot
    if (this._teddyEntities.includes(hitEntity)) {
      this.launchTeddyBear(hitEntity, world);
      return;
    }

    // Ice Dragon boss — flat damage × PaP (no headshot bonus on the dragon)
    if (this._boss?.isAlive && hitEntity === this._boss.entity) {
      this._shotsHit += 1;
      const tierMul = Math.pow(PAP_DAMAGE_FACTOR, this._packTier);
      const dmg = Math.round(baseDamage * tierMul);
      VFX.bloodHit(world, hitPoint, false);
      this._points += PTS_HIT;
      const killed = this._boss.takeDamage(dmg);
      this.syncHud(host);
      if (killed) return;
      return;
    }

    const row = this._zombies.find((z) => z.entity === hitEntity);
    if (!row || !row.entity.isSpawned) return;

    this._shotsHit += 1;

    // Headshot: impact point high on the zombie relative to its per-row scale
    const headshot = hitPoint.y > row.entity.position.y + HEADSHOT_Y_THRESHOLD * row.scale;

    this.applyHitToZombie(row, headshot, world, host, hitPoint, baseDamage);
    this.syncHud(host);
  }

  private notifyOutOfAmmo(host: Player, world: World): void {
    const now = performance.now();
    if (now - this._outOfAmmoMsgAtMs < 1500) return;
    this._outOfAmmoMsgAtMs = now;
    world.chatManager.sendPlayerMessage(host, "Out of ammo! Hit the Mystery Chest or Pack-a-Punch.", "FF4444");
  }

  /** Eye-level origin for lethal throws (official pattern: position + camera y offset, nudged forward). */
  private getShotOrigin(host: Player, pe: PlayerEntity): Vector3Like {
    const { yaw } = host.camera.orientation;
    const f = 0.5; // forward nudge so throws clear the player's own collider
    const camY = host.camera.offset?.y ?? FIRST_PERSON_CAMERA_OFFSET.y;
    return {
      x: pe.position.x - Math.sin(yaw) * f,
      y: pe.position.y + camY,
      z: pe.position.z - Math.cos(yaw) * f,
    };
  }

  private getShotDirection(host: Player): Vector3Like {
    const { pitch, yaw } = host.camera.orientation;
    const cp   = Math.cos(pitch);
    const rawX = -Math.sin(yaw) * cp;
    const rawY =  Math.sin(pitch);
    const rawZ = -Math.cos(yaw) * cp;
    const dlen = Math.hypot(rawX, rawY, rawZ) || 1;
    return { x: rawX / dlen, y: rawY / dlen, z: rawZ / dlen };
  }

  private applyHitToZombie(
    row: ZombieRow,
    headshot: boolean,
    world: World,
    host: Player,
    impact: Vector3Like,
    baseDamage: number
  ): void {
    // Damage = gun's base damage × Pack-a-Punch tier × headshot multiplier
    const tierMul = Math.pow(PAP_DAMAGE_FACTOR, this._packTier);
    const baseDmg = Math.round(baseDamage * tierMul);
    const dmg     = headshot ? Math.round(baseDmg * HEADSHOT_MULTIPLIER) : baseDmg;

    row.hp -= dmg;
    VFX.bloodHit(world, impact, headshot);

    if (row.hp <= 0) {
      // ── Kill ──
      const zp = row.entity.position;
      const deathPos: Vector3Like = {
        x: zp.x,
        y: zp.y + (row.isDog ? DOG_BODY_CENTER_Y : BODY_CENTER_Y) * row.scale,
        z: zp.z,
      };
      VFX.deathExplosion(world, deathPos);

      if (row.entity.isSpawned) row.entity.despawn();
      this._zombies = this._zombies.filter((z) => z !== row);
      this._kills += 1;

      if (headshot) {
        this._headshots += 1;
        this._points += PTS_HEADSHOT;
        world.chatManager.sendPlayerMessage(
          host,
          `HEADSHOT KILL  +${PTS_HEADSHOT} pts`,
          "FFFF44"
        );
      } else {
        this._points += PTS_KILL;
        world.chatManager.sendPlayerMessage(
          host,
          `Kill  +${PTS_KILL} pts`,
          "88FF88"
        );
      }
    } else {
      // ── Hit, zombie survived ──
      this._points += PTS_HIT;
      if (headshot) this._headshots += 1;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Run end
  // ─────────────────────────────────────────────────────────────────────────────

  private endRun(world: World, host: Player): void {
    this._downs += 1;
    const survivedSeconds = Math.floor((performance.now() - this._runStartMs) / 1000);

    // Send career stats to UI (updateAccountStats in index.html handles these)
    host.ui.sendData({
      type:            "runEnd",
      kills:           this._kills,
      wave:            this._round,
      score:           this._points,
      shotsFired:      this._shotsFired,
      shotsHit:        this._shotsHit,
      downs:           this._downs,
      revives:         this._revives,
      survivedSeconds,
      headshots:       this._headshots
    } satisfies GehennaRunEndPayload);

    // Tear down active session
    this._sessionStarted = false;
    this._round = 0;
    this.despawnGun();
    this.clearZombies();
    this.destroyPropEntities();
    this.resetWaveDirector();
    if (this._lethalSystem) this._lethalSystem.reset();

    /* Stay on HUD until the client dismisses the death overlay: MAIN MENU (quit) or DEPLOY AGAIN (restart). */
    world.chatManager.sendPlayerMessage(host, "You went down. Run ended.", "FF4444");
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Mystery chest tick
  // ─────────────────────────────────────────────────────────────────────────────

  private tickMysteryResolve(host: Player, world: World): void {
    const now = performance.now();
    if (!this._pendingMysteryWeapon || now < this._mysteryBusyUntilMs) return;

    const pick = this._pendingMysteryWeapon;
    this._pendingMysteryWeapon   = null;
    this._mysteryCooldownUntilMs = now + MYSTERY_COOLDOWN_MS;

    // Equip the rolled gun — fresh GunEntity with full clip + reserve
    const pe = this.getHostPlayerEntity(world, host);
    if (pe) this.equipGun(world, pe, pick);

    world.chatManager.sendPlayerMessage(host, `Mystery weapon: ${GUN_DISPLAY_NAME[pick]}`, "FFD700");
    this.syncHud(host);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Interact tick (Pack-a-Punch / Mystery Chest)
  // ─────────────────────────────────────────────────────────────────────────────

  private tickInteract(host: Player, pe: PlayerEntity, world: World): void {
    const inp   = host.input;
    const f     = !!(inp as { f?: boolean }).f;
    const fRise = f && !this._prevF;
    this._prevF = f;
    if (!fRise) return;
    if (this._gun?.isReloading) return;

    // Dev portals take priority over every other F-interact (lab pads + return pad).
    if (this.tryPortalInteract(world, host, pe)) return;

    const p      = pe.position;
    const nearPap = this._papEntity?.isSpawned
      ? this.distXZ(p, this._papEntity.position) < INTERACT_RADIUS
      : false;
    const nearMy  = this._mysteryEntity?.isSpawned
      ? this.distXZ(p, this._mysteryEntity.position) < INTERACT_RADIUS
      : false;

    const now = performance.now();

    if (nearPap) {
      const gun = this._gun;
      if (this._packTier >= PAP_MAX_TIER) {
        gun?.refillReserve();
        world.chatManager.sendPlayerMessage(
          host,
          "Pack-a-Punch: max tier — ammo refilled.",
          "FFAA66"
        );
      } else if (this._points < PAP_COST) {
        world.chatManager.sendPlayerMessage(
          host,
          `Need ${PAP_COST} pts for Pack-a-Punch.`,
          "FF6666"
        );
      } else {
        this._points  -= PAP_COST;
        this._packTier += 1;
        gun?.refillReserve();
        world.chatManager.sendPlayerMessage(
          host,
          `Pack-a-Punch tier ${this._packTier}! Damage up, ammo refilled.`,
          "FFAA44"
        );
      }
      this.syncHud(host);
      return;
    }

    if (nearMy) {
      if (now < this._mysteryCooldownUntilMs) {
        world.chatManager.sendPlayerMessage(host, "Mystery box cooling down…", "CCCCCC");
        return;
      }
      if (this._pendingMysteryWeapon) {
        world.chatManager.sendPlayerMessage(host, "Mystery box still rolling…", "CCCCCC");
        return;
      }
      if (this._points < MYSTERY_COST) {
        world.chatManager.sendPlayerMessage(
          host,
          `Need ${MYSTERY_COST} pts for Mystery Chest.`,
          "FF6666"
        );
        return;
      }
      this._points -= MYSTERY_COST;
      // Roll among guns you're NOT already holding — always a new toy
      const pool = MYSTERY_POOL.filter((id) => id !== this._gunId);
      const pick = pool[Math.floor(Math.random() * pool.length)]!;
      this._pendingMysteryWeapon = pick;
      this._mysteryBusyUntilMs  = now + MYSTERY_SPIN_MS;
      world.chatManager.sendPlayerMessage(host, "Mystery Chest — rolling…", "FFD700");
      this.syncHud(host);
      return;
    }

    const nearWaveNext = this._currentMapId === "test_zone"
      ? this.distXZ(p, TEST_WAVE_NEXT_XZ) < INTERACT_RADIUS
      : false;
    const nearWaveReplay = this._currentMapId === "test_zone"
      ? this.distXZ(p, TEST_WAVE_REPLAY_XZ) < INTERACT_RADIUS
      : false;
    const nearBossPillar = this._currentMapId === "test_zone"
      ? this.distXZ(p, TEST_BOSS_PILLAR_XZ) < INTERACT_RADIUS
      : false;

    // REAL TEST ROOM new pillars
    const nearClear = this._currentMapId === "test_zone"
      ? this.distXZ(p, TEST_CLEAR_XZ) < INTERACT_RADIUS
      : false;
    const nearGod = this._currentMapId === "test_zone"
      ? this.distXZ(p, TEST_GOD_XZ) < INTERACT_RADIUS
      : false;
    const nearMaxKit = this._currentMapId === "test_zone"
      ? this.distXZ(p, TEST_MAXKIT_XZ) < INTERACT_RADIUS
      : false;

    if (nearWaveNext) {
      this.advanceTestWave(world, host);
      return;
    }

    if (nearWaveReplay) {
      this.replayCurrentWave(world, host);
      return;
    }

    if (nearBossPillar) {
      if (this._boss?.isAlive) {
        world.chatManager.sendPlayerMessage(host, "Ice Dragon already active!", "CCCCCC");
        return;
      }
      this.abortActiveWave();
      this.spawnIceDragon(world, pe);
      world.chatManager.sendPlayerMessage(host, "You called the Ice Dragon — fight!", "CC2222");
      return;
    }

    if (nearClear) {
      this.clearAllHostiles(world, host);
      return;
    }

    if (nearGod) {
      this.toggleTestGodMode(world, host);
      return;
    }

    if (nearMaxKit) {
      this.giveTestMaxKit(world, pe, host);
      return;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // State helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private resetRunState(): void {
    this.clearZombies();
    this.destroyPropEntities();
    this.resetWaveDirector();

    // Restore any blocks we destroyed on the Test Map so it resets fresh for the next run
    this.restoreAndClearTestMapBlocks();

    this._health     = PLAYER_MAX_HEALTH;
    this._points     = 0;
    this._runStartMs = performance.now();

    this._kills     = 0;
    this._headshots = 0;
    this._shotsFired = 0;
    this._shotsHit   = 0;
    this._downs      = 0;
    this._revives    = 0;

    // Gun state lives on the GunEntity — a fresh one is equipped on deploy.
    this.despawnGun();
    this._gunId    = "ar15";
    this._packTier = 0;
    this._outOfAmmoMsgAtMs = 0;

    this._prevF  = false;
    this._prevC  = false;
    this._prevN  = false;

    // Reset god mode for a fresh test session (player can re-toggle if wanted)
    this._testGodMode = false;
    this._prevV  = false;
    this._lethalUsedAtMs  = 0;
    this._thirdPersonActive = false;
    this._flyMode = false;
    this._savedFlyCtrl = null;
    this._prevV = false;
    this._gamePaused = false;
    this._savedMovement = null;

    this._mysteryBusyUntilMs     = 0;
    this._mysteryCooldownUntilMs = 0;
    this._pendingMysteryWeapon   = null;

    this.applyLoadoutLethals();
    if (this._lethalSystem) this._lethalSystem.reset();

    // Reset teddy bear victory song so it can play again on next run
    this._teddyVictorySongPlayed = false;

    // Wave 1 auto-start (horde maps only — Test Map uses manual pillars).
    this._intermissionTimer = hordesEnabledForMap(this._currentMapId) && this._currentMapId !== "test_zone"
      ? WAVE_FIRST_INTERMISSION_S
      : 0;
  }

  /** Grant starting lethal charges from the deploy loadout (all maps). */
  private applyLoadoutLethals(): void {
    this._activeLethal   = this._deployLoadout.lethal;

    // On the Test Map, give the player EVERY lethal with 999 charges so they can freely test all of them
    if (this._currentMapId === "test_zone") {
      this._lethalCharges = 999; // They can switch lethals in the loadout and always have full charges
      // REAL TEST ROOM: start with some points and a combat-ready gun feel
      this._points = Math.max(this._points, 4500);
      // Start the tester with a solid rifle instead of default pistol
      this._gunId = "ak47";
    } else {
      this._lethalCharges = startingLethalCharges(this._currentMapId, this._activeLethal);
    }

    // (Re)create lethal system bound to our explosion damage logic
    this._lethalSystem = new LethalSystem(
      (world, host, center, radius, mul) => this.applyExplosionDamage(world, host, center, radius, mul)
    );
  }

  private resetWaveDirector(): void {
    this._round             = 0;
    this._waveActive        = false;
    this._intermissionTimer = 0;
    this._queuedSpawns      = 0;
    this._spawnCooldownS    = 0;
    this._waveZombieHealth  = Z_BASE_HEALTH;
    this._waveZombieSpeed   = Z_BASE_SPEED;
    this._isDogWave         = false;
    this._isDragonWave      = false;
    this._dragonsSlain      = 0;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Props
  // ─────────────────────────────────────────────────────────────────────────────

  private spawnWorldProps(world: World): void {
    this.destroyPropEntities();

    const mapId = this._currentMapId;
    if (!hordesEnabledForMap(mapId)) return;
    const papPos = this.snapPropToGround(world, PROP_PAP_POS[mapId]);
    const mysteryPos = this.snapPropToGround(world, PROP_MYSTERY_POS[mapId]);

    this._papEntity = new Entity({
      name:       "Pack-a-Punch",
      tag:        "gehenna-pap",
      modelUri:   "models/props/pack-a-punch-machine.gltf",
      modelScale: 1.05,
      rigidBodyOptions: { type: RigidBodyType.FIXED }
    });
    this._papEntity.spawn(world, papPos);

    this._mysteryEntity = new Entity({
      name:       "Mystery Chest",
      tag:        "gehenna-mystery",
      modelUri:   "models/props/mystery-chest.gltf",
      modelScale: 1.0,
      rigidBodyOptions: { type: RigidBodyType.FIXED }
    });
    this._mysteryEntity.spawn(world, mysteryPos);

    // Spawn Test Map specific decorations and testing tools
    if (this._currentMapId === "test_zone") {
      this.spawnTeddyBears(world);
      this.spawnLethalPickups(world);
      this.spawnWeaponPickups(world);
      this.spawnTestControlScreens(world);
      this.spawnDevPortals(world);
    }
  }

  private spawnTeddyBears(world: World): void {
    this._teddyEntities = [];

    TEDDY_POSITIONS.forEach((pos, index) => {
      const groundTop = this.findGroundTop(world, pos.x, pos.z) ?? 1;
      const defaultPos: Vector3Like = { x: pos.x, y: groundTop + 0.2, z: pos.z };
      const teddy = new Entity({
        name:       `TeddyBear-${index + 1}`,
        tag:        "gehenna-decoration",
        modelUri:   "models/teddy_bear.glb",
        modelScale: 1.0,
        rigidBodyOptions: { type: RigidBodyType.FIXED }
      });
      // Editable + savable layout prop.
      const t = this._layout.register(`teddy-${index + 1}`, teddy, "models/teddy_bear.glb", 1.0, defaultPos, 0);
      teddy.spawn(world, t.position, t.rotation);
      teddy.setModelScale(t.scale);
      this._teddyEntities.push(teddy);
    });
  }

  /** Spawns physical lethal pickups around the Test Map for easy testing of all 4 lethals */
  private spawnLethalPickups(world: World): void {
    this._lethalPickupEntities = [];

    LETHAL_PICKUP_XZ.forEach((data) => {
      const groundTop = this.findGroundTop(world, data.x, data.z) ?? 1;
      const spawnPos: Vector3Like = { x: data.x, y: groundTop + 0.9, z: data.z };

      const pickup = new Entity({
        name:       `LethalPickup-${data.lethalId}`,
        tag:        "gehenna-lethal-pickup",
        modelUri:   data.model,
        modelScale: data.scale,
        rigidBodyOptions: { type: RigidBodyType.FIXED }
      });
      pickup.spawn(world, spawnPos);

      this._lethalPickupEntities.push({
        entity: pickup,
        lethalId: data.lethalId,
        label: data.label,
      });
    });

    console.log("[Test Map] Spawned 4 floating lethal pickups");

    // Send a message to the player
    if (this._hostPlayer) {
      world.chatManager.sendPlayerMessage(
        this._hostPlayer,
        "Lethal range (west): Frag · Sticky · C4 · S-Mine — run into one for 999 charges.",
        "00FFAA"
      );
    }
  }

  /** Spawns physical weapon pickups (the weapons test range) on the Test Map. */
  private spawnWeaponPickups(world: World): void {
    this._weaponPickupEntities = [];

    WEAPON_PICKUP_DEFS.forEach((data) => {
      const groundTop = this.findGroundTop(world, data.x, data.z) ?? 1;
      const spawnPos: Vector3Like = { x: data.x, y: groundTop + 1.0, z: data.z };

      const pickup = new Entity({
        name:       `WeaponPickup-${data.weaponKey}`,
        tag:        "gehenna-weapon-pickup",
        modelUri:   data.model,
        modelScale: data.scale,
        rigidBodyOptions: { type: RigidBodyType.FIXED },
      });
      pickup.spawn(world, spawnPos);

      this._weaponPickupEntities.push({
        entity: pickup,
        weaponKey: data.weaponKey,
        label: data.label,
      });
    });

    const gunCount = WEAPON_PICKUP_DEFS.length;
    console.log(`[Test Map] Spawned ${gunCount} gun pickups`);

    if (this._hostPlayer) {
      world.chatManager.sendPlayerMessage(
        this._hostPlayer,
        `Gun ranges (north): ${gunCount} pickups — official row + import grid. Walk into one to equip.`,
        "FFD700"
      );
    }
  }

  /** When the player gets near a test control station, automatically explain what it is (the "overhead UI" in text form). */
  private tickTestControlHints(host: Player, world: World): void {
    if (this._currentMapId !== "test_zone") return;

    const now = performance.now();
    if (now - this._lastTestHintMs < 5500) return; // throttle

    const pe = this.getHostPlayerEntity(world, host);
    if (!pe) return;

    const p = pe.position;
    const R = 6.0; // see the hint a bit before you reach the block

    for (const def of this.TEST_CONTROL_DEFS) {
      if (this.distXZ(p, { x: def.x, y: 0, z: def.z }) < R) {
        this._lastTestHintMs = now;
        // Make it read like you're "looking at the screen"
        world.chatManager.sendPlayerMessage(
          host,
          `> ${def.title}  —  ${def.desc}   (stand at the block, look up at the glowing screen, press F)`,
          "66FFDD"
        );
        return;
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Smart low-profile test control "screens" (the overhead UI labels + visual markers)
  // Each station = one ground "Block" (colored pad + central glass holo block in the map)
  //               + one overhead glowing entity that acts as the "UI Screen" with name/instructions.
  // ─────────────────────────────────────────────────────────────────────────────

  private readonly TEST_CONTROL_DEFS = [
    { x: 12,  z: 0,   title: "NEXT WAVE",   desc: "F — Advance to next wave" },
    { x: -12, z: 0,   title: "REPLAY WAVE", desc: "F — Replay this wave" },
    { x: 0,   z: 12,  title: "CLEAR HORDE", desc: "F — Nuke all zombies + boss (run continues)" },
    { x: 0,   z: -12, title: "GOD MODE",    desc: "F — Toggle invincibility (safe testing)" },
    { x: 12,  z: 12,  title: "MAX KIT",     desc: "F — Strong gun + PaP + points + full ammo/lethals" },
  ] as const;

  /**
   * Creates real "Minecraft / Roblox style" floating UI screens for the test room.
   * Each station gets:
   *   - A flat rectangular "monitor/panel" (c4-block used as screen body)
   *   - A bright glowing orb "power indicator" above it
   *   - The Entity `name` is set to the title + action so it appears as floating label text on/above the screen
   *   - The whole thing is rotated to face the center of the arena (like a real wall-mounted UI screen)
   *
   * Ground "Block" is the tiny single glass block + 1x1 accent (from the generator).
   */
  private spawnTestControlScreens(world: World): void {
    this._testControlScreens = [];

    const PANEL_Y = 4.8;     // height for the main screen panel
    const GLOW_Y_OFFSET = 1.6; // glowing orb sits above the panel like a status light

    for (const def of this.TEST_CONTROL_DEFS) {
      const groundTop = this.findGroundTop(world, def.x, def.z) ?? 1;

      // Direction toward arena center (0,0) so the screen "faces" the player area
      const dx = -def.x;
      const dz = -def.z;
      const yaw = Math.atan2(dx, dz) + Math.PI; // +PI to make the front face inward (tuned for HYTOPIA coords)

      const rot = Quaternion.fromEuler(0, yaw, 0);

      // 1. Main "UI Screen" panel — flat rectangular look using the c4 block model as monitor
      const panelPos: Vector3Like = { x: def.x, y: groundTop + PANEL_Y, z: def.z };
      const panel = new Entity({
        name: `${def.title}\n${def.desc}`,
        tag: "gehenna-test-screen",
        modelUri: "models/particles/c4-block.glb",
        modelScale: 2.2,
        opacity: 0.92,
        rigidBodyOptions: { type: RigidBodyType.FIXED },
      });
      panel.spawn(world, panelPos, rot);
      this._testControlScreens.push(panel);

      // 2. Bright glowing orb on top of the screen (the "on air" / indicator light)
      const glowPos: Vector3Like = { x: def.x, y: groundTop + PANEL_Y + GLOW_Y_OFFSET, z: def.z };
      const glow = new Entity({
        name: " ", // small, the main text lives on the panel below
        tag: "gehenna-test-screen",
        modelUri: "models/particles/green-sphere.glb",
        modelScale: 0.9,
        opacity: 0.98,
        rigidBodyOptions: { type: RigidBodyType.FIXED },
      });
      glow.spawn(world, glowPos);
      this._testControlScreens.push(glow);
    }

    console.log(`[Test Map] Spawned ${this.TEST_CONTROL_DEFS.length} overhead UI screens (flat panels + glowing indicators)`);

    if (this._hostPlayer) {
      world.chatManager.sendPlayerMessage(
        this._hostPlayer,
        "TEST ROOM UI SCREENS: Look for the floating rectangular panels + green light on top. The text on the panel tells you the function. Stand at the tiny floor block directly below, look up, press F.",
        "00FFAA"
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Dev Lab doors (Test Map → installed maps in EDIT mode)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Spawn one big framed door per installed map, west side of the lab. */
  private spawnDevPortals(world: World): void {
    this._portalEntities = [];
    this._portalDoorByMap.clear();
    this._layout.setMap("test_zone");

    for (const def of PORTAL_DEFS) {
      const groundTop = this.findGroundTop(world, def.x, def.z) ?? 1;

      // Default: face the door toward the arena centre so you walk up to its front.
      const defaultYawDeg = ((Math.atan2(-def.x, -def.z) + Math.PI) * 180) / Math.PI;
      const defaultPos = { x: def.x, y: groundTop + 0.05, z: def.z };

      // Stone door frame — this is the editable, layout-savable prop.
      const frame = new Entity({
        name: `DOOR → ${def.label}`,
        tag: "gehenna-portal",
        modelUri: "models/environment/House/door-big-frame.gltf",
        modelScale: 2.0,
        rigidBodyOptions: { type: RigidBodyType.FIXED },
      });
      // Apply any saved override (grab/move/rotate/scale → /save), else default.
      const layoutId = `portal-door-${def.mapId}`;
      const t = this._layout.register(layoutId, frame, "models/environment/House/door-big-frame.gltf", 2.0, defaultPos, defaultYawDeg);
      frame.spawn(world, t.position, t.rotation);
      frame.setModelScale(t.scale);
      this._portalEntities.push(frame);
      this._portalDoorByMap.set(def.mapId, frame);

      // The door slab inside the frame (rides the saved frame transform).
      const door = new Entity({
        name: " ",
        tag: "gehenna-portal",
        modelUri: "models/environment/House/door-big.gltf",
        modelScale: t.scale,
        rigidBodyOptions: { type: RigidBodyType.FIXED },
      });
      door.spawn(world, t.position, t.rotation);
      this._portalEntities.push(door);

      // Floating destination label above the door.
      const label = new Entity({
        name: `${def.label}\n(walk up · press F to enter)`,
        tag: "gehenna-portal",
        modelUri: "models/particles/c4-block.glb",
        modelScale: 1.2,
        opacity: 0.9,
        rigidBodyOptions: { type: RigidBodyType.FIXED },
      });
      label.spawn(world, { x: t.position.x, y: t.position.y + 5.0, z: t.position.z });
      this._portalEntities.push(label);
    }

    console.log(`[Test Map] Spawned ${PORTAL_DEFS.length} dev doors`);
    if (this._hostPlayer) {
      world.chatManager.sendPlayerMessage(
        this._hostPlayer,
        `DEV DOORS (west): ${PORTAL_DEFS.map(p => p.label).join(", ")}. Walk up to a door, press F to enter that map in EDIT mode. Press V to fly, shoot/explode to edit blocks, press F at the door inside to return.`,
        "AA88FF"
      );
    }
  }

  /** F-interact handler for doors — returns true if it consumed the press. */
  private tryPortalInteract(world: World, host: Player, pe: PlayerEntity): boolean {
    const now = performance.now();
    if (now - this._lastPortalWarpMs < PORTAL_COOLDOWN_MS) return false;
    const p = pe.position;

    // In an edit map: the return door (live position) warps back to the lab.
    if (this._devEditMapId) {
      const door = this._portalDoorByMap.get(this._devEditMapId);
      const at = door?.isSpawned ? door.position : MAP_SPAWN[this._devEditMapId];
      if (this.distXZ(p, at) < PORTAL_TRIGGER_R + 1.5) {
        this._lastPortalWarpMs = now;
        this.exitEditMap(world, host);
        return true;
      }
      return false;
    }

    // In the lab: check each door at its LIVE position (so a moved/saved door
    // carries its entry trigger with it). Falls back to the default XZ.
    if (this._currentMapId !== "test_zone") return false;
    for (const def of PORTAL_DEFS) {
      const door = this._portalDoorByMap.get(def.mapId);
      const at = door?.isSpawned ? door.position : { x: def.x, y: 0, z: def.z };
      if (this.distXZ(p, at) < PORTAL_TRIGGER_R + 1.0) {
        this._lastPortalWarpMs = now;
        this.enterEditMap(world, host, def.mapId, def.label);
        return true;
      }
    }
    return false;
  }

  /** Warp into an installed map in free-build EDIT mode (walk + god; press V to fly). */
  private enterEditMap(world: World, host: Player, mapId: GehennaMapId, label: string): void {
    // Tear down lab props/hostiles + clear any leftover fly/edit state BEFORE swapping.
    this.abortActiveWave();
    this.clearZombies();
    this.destroyPropEntities();
    this.restoreAndClearTestMapBlocks();

    // Make sure walking is fully restored (in case fly was on in the lab).
    const peBefore = this.getHostPlayerEntity(world, host);
    if (peBefore) this.disableFlyMode(world, peBefore);

    this._devEditMapId = mapId;
    this._currentMapId = mapId;
    this.ensureMapLoaded(world, mapId);
    this._applySky(world, mapId);

    // Editor now tracks THIS map's saved layout (props placed inside it).
    this._layout.setMap(mapId);

    // Re-fetch the player entity AFTER the world swap, then place + spawn the return door.
    this.teleportHostToMapSpawn(world, host, mapId);
    this.spawnReturnDoor(world, mapId);

    // God on so stray map hazards can't kill you while editing. Movement stays normal
    // (walk works immediately); press V any time to fly for high builds.
    this._testGodMode = true;

    this.syncHud(host);
    world.chatManager.sendPlayerMessage(host, `EDIT MODE — ${label}. Walk freely, press V to fly, shoot/explode to edit blocks, press F at the door to return to the lab.`, "AA88FF");
  }

  /** A single return door at an edit map's spawn so F sends you back to the lab. */
  private spawnReturnDoor(world: World, mapId: GehennaMapId): void {
    const spawn = MAP_SPAWN[mapId];
    const groundTop = this.findGroundTop(world, spawn.x, spawn.z) ?? Math.floor(spawn.y);
    const defaultPos = { x: spawn.x + 2, y: groundTop + 0.05, z: spawn.z };

    const frame = new Entity({
      name: "DOOR → Dev Lab",
      tag: "gehenna-portal",
      modelUri: "models/environment/House/door-big-frame.gltf",
      modelScale: 2.0,
      rigidBodyOptions: { type: RigidBodyType.FIXED },
    });
    // Return door is itself an editable/savable prop (relocate where you re-enter).
    const t = this._layout.register("return-door", frame, "models/environment/House/door-big-frame.gltf", 2.0, defaultPos, 0);
    frame.spawn(world, t.position, t.rotation);
    frame.setModelScale(t.scale);
    this._portalEntities.push(frame);
    this._portalDoorByMap.set(mapId, frame);

    const label = new Entity({
      name: "Dev Lab\n(press F to return)",
      tag: "gehenna-portal",
      modelUri: "models/particles/c4-block.glb",
      modelScale: 1.2,
      opacity: 0.9,
      rigidBodyOptions: { type: RigidBodyType.FIXED },
    });
    label.spawn(world, { x: t.position.x, y: t.position.y + 5.0, z: t.position.z });
    this._portalEntities.push(label);
  }

  /** Return from an edit map back to the Dev Lab. */
  private exitEditMap(world: World, host: Player): void {
    const peBefore = this.getHostPlayerEntity(world, host);
    if (peBefore) this.disableFlyMode(world, peBefore);
    this._devEditMapId = null;
    this._testGodMode = false;

    this.destroyPropEntities(); // clears the return door too
    this._currentMapId = "test_zone";
    this.ensureMapLoaded(world, "test_zone");
    this._applySky(world, "test_zone");
    this.spawnWorldProps(world);
    this.teleportHostToMapSpawn(world, host, "test_zone");

    this.syncHud(host);
    world.chatManager.sendPlayerMessage(host, "Returned to the Dev Lab.", "AA88FF");
  }

  private destroyPropEntities(): void {
    if (this._papEntity?.isSpawned)     this._papEntity.despawn();
    if (this._mysteryEntity?.isSpawned) this._mysteryEntity.despawn();

    this._teddyEntities.forEach(t => {
      if (t?.isSpawned) t.despawn();
    });
    this._teddyEntities = [];

    this._launchedTeddies.forEach(item => {
      if (item.entity?.isSpawned) item.entity.despawn();
    });
    this._launchedTeddies = [];

    this._lethalPickupEntities.forEach(item => {
      if (item.entity?.isSpawned) item.entity.despawn();
    });
    this._lethalPickupEntities = [];

    this._weaponPickupEntities.forEach(item => {
      if (item.entity?.isSpawned) item.entity.despawn();
    });
    this._weaponPickupEntities = [];

    this._testControlScreens.forEach(e => {
      if (e?.isSpawned) e.despawn();
    });
    this._testControlScreens = [];

    this._portalEntities.forEach(e => {
      if (e?.isSpawned) e.despawn();
    });
    this._portalEntities = [];
    this._portalDoorByMap.clear();
    this._layout.clear();

    this._papEntity     = null;
    this._mysteryEntity = null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────────────────────

  private clearZombies(): void {
    for (const z of this._zombies) {
      if (z.entity.isSpawned) z.entity.despawn();
    }
    this._zombies = [];

    // Every "all hostiles down" teardown (run end, quit, reset, detach) also
    // removes the Ice Dragon and its live projectiles.
    this.clearBoss();
  }

  private getHostPlayerEntity(
    world: World,
    player: Player
  ): PlayerEntity | undefined {
    return world.entityManager.getPlayerEntitiesByPlayer(player)[0];
  }

  private teleportHostToMapSpawn(
    world: World,
    player: Player,
    mapId: GehennaMapId
  ): void {
    const entity = this.getHostPlayerEntity(world, player);
    const pos    = MAP_SPAWN[mapId];
    if (entity && pos) {
      try { entity.setPosition(pos); } catch { /* ignore */ }
    }
  }

  private syncHud(player: Player): void {
    this._lastHudPushMs = performance.now();
    this.pushHudToPlayer(player);
  }

  private maybeThrottleHud(player: Player, minIntervalMs: number): void {
    if (performance.now() - this._lastHudPushMs >= minIntervalMs) {
      this.syncHud(player);
    }
  }

  private weaponDisplayName(): string {
    const pap = this._packTier > 0 ? ` [PaP×${this._packTier}]` : "";
    const name = this._gun?.name || GUN_DISPLAY_NAME[this._gunId];
    return `${name}${pap}`;
  }

  private distXZ(a: Vector3Like, b: Vector3Like): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  /** Swap voxel worlds when the player picks a different deploy zone. */
  private ensureMapLoaded(world: World, mapId: GehennaMapId): void {
    if (this._loadedMapId === mapId) return;

    const data = (
      mapId === "test_zone" ? testMap
        : mapId === "high_bastion" ? castleMap
          : mapId === "the_sprawl" ? sprawlMap
            : worldMap
    ) as WorldMap;
    world.loadMap(data);
    this._loadedMapId = mapId;
    console.log(`[Gehenna] Loaded map: ${mapId}`);
  }

  /** Walkable ground surface Y (top of block). Skips foliage so spawns land on the floor. */
  private findGroundTop(world: World, x: number, z: number): number | null {
    const cx = Math.floor(x);
    const cz = Math.floor(z);
    const maxY = MAP_GROUND_SCAN_MAX_Y[this._currentMapId];
    const foliage = MAP_FOLIAGE_BLOCK_IDS[this._currentMapId];

    for (let y = maxY; y >= -2; y--) {
      try {
        const blockId = world.chunkLattice.getBlockId({ x: cx, y, z: cz });
        if (blockId === 0 || foliage.has(blockId)) continue;

        const aboveId = world.chunkLattice.getBlockId({ x: cx, y: y + 1, z: cz });
        if (aboveId === 0) {
          return y + 1;
        }
      } catch {
        // Chunk may not be loaded yet
      }
    }

    // Physics raycast fallback for uneven terrain / unloaded lattice edge cases
    try {
      const hit = world.simulation.raycast(
        { x, y: 64, z },
        { x: 0, y: -1, z: 0 },
        128,
        {
          filterGroups: CollisionGroupsBuilder.buildRawCollisionGroups({
            belongsTo: [CollisionGroup.ALL],
            collidesWith: [CollisionGroup.BLOCK],
          }),
        }
      );
      if (hit?.hitPoint) return hit.hitPoint.y;
    } catch {
      void 0;
    }

    return null;
  }

  /** Place a fixed prop on the ground at its X/Z, preserving model height offset. */
  private snapPropToGround(world: World, pos: Vector3Like): Vector3Like {
    const groundTop = this.findGroundTop(world, pos.x, pos.z);
    if (groundTop === null) return pos;
    const lift = Math.max(0, pos.y - 1);
    return { x: pos.x, y: groundTop + lift, z: pos.z };
  }

  /**
   * Destroys blocks in a radius around a point (used for C4/tree destruction etc.).
   * This makes trees and other block structures destructible by big explosions.
   */
  private destroyBlocksInRadius(
    world: World,
    center: Vector3Like,
    radius: number,
    minY: number = WORLD_FLOOR_PROTECTION_Y,
    debrisDensity: number = 0.33
  ) {
    const r = Math.ceil(radius);
    let destroyed = 0;

    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx * dx + dy * dy + dz * dz > radius * radius) continue;

          const pos = {
            x: Math.floor(center.x + dx),
            y: Math.floor(center.y + dy),
            z: Math.floor(center.z + dz),
          };

          if (pos.y < minY) continue; // Protect the main floor so players don't fall through the map

          try {
            const blockId = world.chunkLattice.getBlockId(pos);
            if (blockId !== 0) {
              // Record destroyed blocks so we can restore them on Test Map restart.
              // (Edit maps keep their edits — they aren't auto-restored.)
              if (this._currentMapId === "test_zone") {
                this._destroyedBlocksThisRun.push({
                  pos: { ...pos },
                  originalBlockId: blockId,
                });
              }

              world.chunkLattice.setBlock(pos, 0); // 0 = air / remove block
              destroyed++;

              // Spawn physics debris based on the density for this explosion type
              if (Math.random() < debrisDensity) {
                this.spawnPhysicsDebris(world, pos, center);
              }
            }
          } catch {
            // Ignore out of bounds or unloaded chunks
          }
        }
      }
    }

    if (destroyed > 0) {
      console.log(`[Explosion] Destroyed ${destroyed} blocks in radius ${radius} (debris density: ${debrisDensity})`);
    }
  }

  /**
   * Spawns a small dynamic entity that behaves like a flying block chunk with real physics.
   * This gives explosions that satisfying "blocks flying everywhere" feel.
   */
  private spawnPhysicsDebris(world: World, position: Vector3Like, explosionCenter: Vector3Like) {
    const debris = new Entity({
      name: "PhysicsDebris",
      modelUri: "models/projectiles/fireball.gltf",
      modelScale: 0.1 + Math.random() * 0.22,
      rigidBodyOptions: {
        type: RigidBodyType.DYNAMIC,
      }
    });

    debris.spawn(world, position);

    // Calculate explosion force direction
    let dx = position.x - explosionCenter.x;
    let dy = position.y - explosionCenter.y;
    let dz = position.z - explosionCenter.z;

    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len;
    dy /= len;
    dz /= len;

    const power = 7 + Math.random() * 9;
    const upward = 4 + Math.random() * 5;

    debris.setLinearVelocity({
      x: dx * power + (Math.random() - 0.5) * 3,
      y: dy * power * 0.5 + upward,
      z: dz * power + (Math.random() - 0.5) * 3,
    });

    // Give it nice tumbling
    debris.setAngularVelocity({
      x: (Math.random() - 0.5) * 22,
      y: (Math.random() - 0.5) * 28,
      z: (Math.random() - 0.5) * 22,
    });

    // Auto cleanup after a few seconds
    setTimeout(() => {
      try {
        if (debris.isSpawned) debris.despawn();
      } catch {}
    }, 2800 + Math.random() * 2200);
  }

  /**
   * Ensures any blocks destroyed on the Test Map this run are put back, then clears the tracking list.
   * Safe to call on full run-end paths (quit to menu, host leaves, fresh start).
   * Intentionally NOT called from endRun() — the death screen still needs the list so that
   * "Restart" / Deploy Again can restore the world for the new attempt.
   */
  private restoreAndClearTestMapBlocks(): void {
    if (this._currentMapId === "test_zone" && this._world) {
      this.restoreTestMapBlocks(this._world);
    }
    this._destroyedBlocksThisRun = [];
  }

  /**
   * Restores blocks that were destroyed during this run on the Test Map.
   * This makes the Test Map reset cleanly when the player dies and restarts.
   */
  private restoreTestMapBlocks(world: World): void {
    if (this._destroyedBlocksThisRun.length === 0) return;

    let restored = 0;
    for (const entry of this._destroyedBlocksThisRun) {
      try {
        world.chunkLattice.setBlock(entry.pos, entry.originalBlockId);
        restored++;
      } catch {}
    }

    console.log(`[Test Map] Restored ${restored} blocks after run reset`);
  }
}
