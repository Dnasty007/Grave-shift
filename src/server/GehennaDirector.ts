import {
  ColliderShape,
  Entity,
  EntityModelAnimationLoopMode,
  GameServer,
  Player,
  PlayerCameraMode,
  PlayerEntity,
  RigidBodyType,
  World,
  WorldLoopEvent,
  type Vector3Like,
  type WorldLoopEventPayloads
} from "hytopia";
import {
  DEFAULT_MAP_ID,
  type GehennaMapId,
  MAP_SPAWN,
  normalizeMapId
} from "./mapConfig";

// ─────────────────────────────────────────────────────────────────────────────
// Constants (mirrors legacy GAME_CONFIG — see legacy-playcanvas-client/src/game/config.ts)
// ─────────────────────────────────────────────────────────────────────────────

// Zombie tuning
const Z_BASE_HEALTH        = 70;
const Z_HEALTH_PER_WAVE    = 16;
const Z_BASE_SPEED         = 1.35;
const Z_SPEED_PER_WAVE     = 0.09;
const Z_ATTACK_RANGE       = 1.35;   // metres
const Z_ATTACK_DAMAGE      = 7;      // HP per melee hit
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

// Weapon (Assault Rifle default)
const WEAPON_DAMAGE       = 34;
const HEADSHOT_MULTIPLIER = 2.2;
const FIRE_INTERVAL_MS    = 180;
const MAG_SIZE            = 24;
const RESERVE_START       = 105;
const RELOAD_DURATION_MS  = 1_000;

// Hitscan sphere geometry — regular zombie (scale 1.0, capsule halfHeight=0.45 radius=0.28)
//
// HYTOPIA entity.position = capsule CENTRE (confirmed: Player Y == Camera Y w/ zero offset).
// Legacy values were measured from FEET at modelScale 2.0.
//   Convert: value_from_feet = legacy / 2  →  offset_from_centre = from_feet - (halfHeight+radius)
//   Zombie capsule centre is 0.73 m above feet.
//     body:  0.92/2 = 0.46 from feet  → 0.46 − 0.73 = −0.27 (torso, below centre)
//     head:  2.45/2 = 1.225 from feet → 1.225 − 0.73 = +0.50 (head, above centre)
//     head radius: 0.40/2 = 0.20 (+ small forgiveness bump → 0.24)
const BODY_CENTER_Y = -0.27;  // offset from zombie capsule centre → mid-torso
const BODY_RADIUS   =  0.36;
const HEAD_CENTER_Y =  0.50;  // offset from zombie capsule centre → head
const HEAD_RADIUS   =  0.24;

// Eye position relative to `PlayerEntity.position` (capsule centre in HYTOPIA).
// Y=0.5 is the value used in the official HYTOPIA zombies-fps SDK example.
// Forward=0.5 matches the official shoot-origin nudge (prevents self-intersection).
const PLAYER_EYE_Y_OFFSET        = 0.5;
const PLAYER_EYE_FORWARD_OFFSET  = 0.5;
const RAY_MAX_RANGE = 100;

// Hitscan sphere geometry — zombie dog (capsule halfHeight=0.18 radius=0.22 → centre 0.40m above feet)
// Dog model is low-slung; body sits near capsule centre, head slightly above.
const DOG_BODY_CENTER_Y = -0.05;
const DOG_BODY_RADIUS   =  0.28;
const DOG_HEAD_CENTER_Y =  0.18;
const DOG_HEAD_RADIUS   =  0.18;

// Dog wave tuning
const DOG_WAVE_INTERVAL  = 5;    // every Nth wave is a dog wave
const DOG_WAVE_COUNT     = 10;   // dogs spawned in a dog wave
const DOG_BASE_HEALTH    = 45;
const DOG_HEALTH_PER_WAVE = 8;
const DOG_SPEED          = 3.2;  // faster than zombies
const DOG_ATTACK_RANGE   = 1.1;
const DOG_ATTACK_DAMAGE  = 10;
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
const INTERACT_RADIUS              = 3.2;
const PROP_PAP_POS: Vector3Like    = { x: -12, y: 3.8, z: -8 };
const PROP_MYSTERY_POS: Vector3Like = { x: -30, y: 3.8, z: 4  };

// ─────────────────────────────────────────────────────────────────────────────
// UI payload types
// ─────────────────────────────────────────────────────────────────────────────

export type GehennaScreenPayload = {
  type: "screen";
  value: "menu" | "hud";
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
  magAmmo: number;
  reserveAmmo: number;
  caliber?: string;
  reloadFraction?: number;
  wave?: number;
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

export type GehennaUiPayload =
  | GehennaScreenPayload
  | GehennaRoundPayload
  | GehennaHudPayload
  | GehennaRunEndPayload;

// ─────────────────────────────────────────────────────────────────────────────
// Internal types
// ─────────────────────────────────────────────────────────────────────────────

type ZombieRow = {
  entity:          Entity;
  hp:              number;
  speed:           number;
  attackCooldownS: number; // seconds until next melee hit allowed
  isDog:           boolean;
};

type MysteryWeaponDef = { id: string; name: string; mag: number; reserve: number };

const MYSTERY_POOL: MysteryWeaponDef[] = [
  { id: "pistol",  name: "M1911",       mag: 12, reserve:  60 },
  { id: "smg",     name: "Vector SMG",  mag: 32, reserve: 128 },
  { id: "ar",      name: "M4 Carbine",  mag: 30, reserve: 120 },
  { id: "shotgun", name: "Breacher 12", mag:  8, reserve:  48 },
  { id: "lmg",     name: "RPK",         mag: 75, reserve: 150 }
];

// ─────────────────────────────────────────────────────────────────────────────
// Ray-sphere intersection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the smallest non-negative t along the ray that intersects the sphere,
 * or -1 on miss. Ray direction must be unit length.
 */
function raySphere(
  ox: number, oy: number, oz: number,  // ray origin
  dx: number, dy: number, dz: number,  // ray direction (normalised)
  cx: number, cy: number, cz: number,  // sphere centre
  r: number                             // sphere radius
): number {
  const fx = ox - cx;
  const fy = oy - cy;
  const fz = oz - cz;
  const b  = 2 * (fx * dx + fy * dy + fz * dz);
  const c  = fx * fx + fy * fy + fz * fz - r * r;
  const disc = b * b - 4 * c;          // a = dot(dir,dir) = 1
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  const t1 = (-b - sq) * 0.5;
  const t2 = (-b + sq) * 0.5;
  if (t1 >= 0) return t1;
  if (t2 >= 0) return t2;
  return -1;
}

// ─────────────────────────────────────────────────────────────────────────────
// GehennaDirector
// ─────────────────────────────────────────────────────────────────────────────

export class GehennaDirector {
  private _world: World | null = null;
  private _sessionStarted = false;

  // Identity
  private _hostPlayer: Player | null = null;
  private _currentMapId: GehennaMapId = DEFAULT_MAP_ID;

  // Zombie horde
  private _zombies: ZombieRow[] = [];

  // Props
  private _papEntity: Entity | null = null;
  private _mysteryEntity: Entity | null = null;

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

  // ── Weapon ───────────────────────────────────────────────────────────────────
  private _weaponName   = "Assault Rifle";
  private _weaponDamage = WEAPON_DAMAGE;
  private _mag          = MAG_SIZE;
  private _magMax       = MAG_SIZE;
  private _reserve      = RESERVE_START;
  private _packTier     = 0;

  // ── Input / fire timing ──────────────────────────────────────────────────────
  private _reloadUntilMs      = 0;
  private _nextFireAllowedMs  = 0;
  private _prevMl = false;
  private _prevF  = false;
  private _prevR  = false;

  // ── Mystery chest ────────────────────────────────────────────────────────────
  private _mysteryBusyUntilMs     = 0;
  private _mysteryCooldownUntilMs = 0;
  private _pendingMysteryWeapon: MysteryWeaponDef | null = null;

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
    world.loop.on(WorldLoopEvent.TICK_START, this._onTick);
  }

  detach(): void {
    if (this._world) {
      this._world.loop.off(WorldLoopEvent.TICK_START, this._onTick);
      this._world = null;
    }
    this.clearZombies();
    this.destroyPropEntities();
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

  handleStartGame(world: World, player: Player, mapIdRaw?: unknown): void {
    const mapId = normalizeMapId(mapIdRaw);
    this._currentMapId = mapId;

    if (this._sessionStarted && this.isSessionHost(player)) {
      // Already running — just re-sync (e.g. player clicked Deploy twice)
      this.pushScreenToPlayer(player, "hud");
      this.pushRoundToPlayer(player);
      this.syncHud(player);
      return;
    }

    this._sessionStarted = true;
    this._hostPlayer = player;

    this.resetRunState();
    this.teleportHostToMapSpawn(world, player, mapId);
    this.spawnWorldProps(world);
    this.pushScreenToPlayer(player, "hud");
    this.syncHud(player);

    const tip = mapId === "test_zone"
      ? "Test Zone active. Wave 1 inbound. LMB fire · R reload · F at machines."
      : "Wave 1 inbound. Hold position. LMB fire · R reload · F at machines.";
    world.chatManager.sendPlayerMessage(player, tip, "00FFAA");
  }

  handlePlayerLeft(world: World, player: Player): void {
    if (this.isSessionHost(player)) {
      this._hostPlayer = null;
      this._sessionStarted = false;
      this._round = 0;
      this.clearZombies();
      this.destroyPropEntities();
      this.resetWaveDirector();
    }
    void world;
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
    this.debugFetch("GehennaDirector:quitToMenu", "entry", "H4", {
      playerId: player.id,
      hostId: this._hostPlayer?.id ?? null,
      isHost: this.isSessionHost(player),
      sessionStarted: this._sessionStarted
    });

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

    this.clearZombies();
    this.destroyPropEntities();
    this.resetWaveDirector();
    this._sessionStarted = false;
    this._round = 0;

    /* Insta-die in run terms: zero HP, stop movement, lobby spawn — then main menu. */
    this._health = 0;
    const pe = this.getHostPlayerEntity(world, player);
    if (pe) {
      try {
        pe.setLinearVelocity({ x: 0, y: 0, z: 0 });
      } catch {
        void 0;
      }
    }
    this.teleportHostToMapSpawn(world, player, DEFAULT_MAP_ID);
    this.syncHud(player);
    this.pushScreenToPlayer(player, "menu");
    world.chatManager.sendPlayerMessage(player, "Run ended — progress saved.", "AAAAFF");

    this.debugFetch("GehennaDirector:quitToMenu", "after_push_menu", "H5", { playerId: player.id });
  }

  /** Restart the run from scratch (also works from the game-over screen after death). */
  restartRun(world: World, player: Player): void {
    this.debugFetch("GehennaDirector:restartRun", "entry", "H4", {
      playerId: player.id,
      hostId: this._hostPlayer?.id ?? null,
      isHost: this.isSessionHost(player),
      sessionStarted: this._sessionStarted
    });

    // Host only — sole player can recover if host ref was lost (e.g. reconnect edge cases).
    if (!this.isSessionHost(player)) {
      if (!this.isSolePlayerInWorld(world, player)) return;
      this._hostPlayer = player;
    }

    const mapId = this._currentMapId;
    this._sessionStarted = true;
    this._round = 0;
    this.resetRunState();
    this.teleportHostToMapSpawn(world, player, mapId);
    this.spawnWorldProps(world);
    this.pushScreenToPlayer(player, "hud");
    this.syncHud(player);
    world.chatManager.sendPlayerMessage(player, "Run restarted — horde re-staged.", "88FFCC");

    this.debugFetch("GehennaDirector:restartRun", "restart_complete", "H5", { playerId: player.id, round: this._round });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // UI push helpers
  // ─────────────────────────────────────────────────────────────────────────────

  pushScreenToPlayer(player: Player, screen: "menu" | "hud"): void {
    player.ui.sendData({ type: "screen", value: screen } satisfies GehennaScreenPayload);
    player.ui.lockPointer(screen === "hud");
    if (screen === "hud") {
      // Exact camera setup from official HYTOPIA zombies-fps SDK example.
      // setViewModelHiddenNodes hides those nodes on the first-person view model only.
      // No setForwardOffset / setFilmOffset — those are NOT in the SDK example and break the camera.
      player.camera.setMode(PlayerCameraMode.FIRST_PERSON);
      player.camera.setOffset({ x: 0, y: PLAYER_EYE_Y_OFFSET, z: 0 });
      player.camera.setViewModelHiddenNodes(["head", "neck", "torso", "leg_right", "leg_left"]);
    } else {
      player.camera.setMode(PlayerCameraMode.THIRD_PERSON);
      player.camera.setOffset({ x: 0, y: 0, z: 0 });
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
    const now = performance.now();
    const reloading  = now < this._reloadUntilMs;
    const reloadFrac = reloading
      ? 1 - (this._reloadUntilMs - now) / RELOAD_DURATION_MS
      : 0;

    const payload: GehennaHudPayload = {
      type:           "gehennaHud",
      health:         this._health,
      maxHealth:      PLAYER_MAX_HEALTH,
      hostiles:       this._zombies.length,
      score:          this._points,
      weapon:         this.weaponDisplayName(),
      magAmmo:        this._mag,
      reserveAmmo:    this._reserve,
      caliber:        this._packTier > 0 ? `PaP ×${this._packTier}` : "9×19mm",
      reloadFraction: Math.max(0, Math.min(1, reloadFrac)),
      wave:           this._round,
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

    const dtS = tickDeltaMs / 1000;

    this.tickWaveDirector(dtS, w, host, pe);
    this.tickMysteryResolve(host, w);
    this.tickZombies(dtS, pe, host, w);

    // endRun() inside tickZombies sets _sessionStarted = false — bail if so
    if (!this._sessionStarted) return;

    this.tickGun(host, pe, w);
    this.tickInteract(host, pe, w);
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

    // Wave-cleared detection: all queued spawns done AND no zombies alive
    if (this._waveActive && this._queuedSpawns === 0 && this._zombies.length === 0) {
      this._waveActive = false;
      world.chatManager.sendPlayerMessage(
        host,
        `Wave ${this._round} cleared!`,
        "88FF88"
      );
      this._intermissionTimer = WAVE_INTERMISSION_S;
    }
  }

  private startNextWave(world: World, host: Player): void {
    this._round += 1;
    const w = this._round;

    // Every DOG_WAVE_INTERVAL rounds spawn a dog wave instead of zombies.
    this._isDogWave = (w % DOG_WAVE_INTERVAL === 0);

    // Scale zombie health / speed with wave number (exact legacy formulas).
    this._waveZombieHealth = Z_BASE_HEALTH + (w - 1) * Z_HEALTH_PER_WAVE;
    this._waveZombieSpeed  = Z_BASE_SPEED  + (w - 1) * Z_SPEED_PER_WAVE;

    if (this._isDogWave) {
      this._queuedSpawns = DOG_WAVE_COUNT;
    } else {
      this._queuedSpawns = WAVE_STARTING_COUNT + (w - 1) * WAVE_ADDITIONAL_PER_WAVE;
    }

    this._spawnCooldownS = 0;
    this._waveActive     = true;

    this.pushRoundToPlayer(host);
    if (this._isDogWave) {
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

  private spawnOneZombie(world: World, pe: PlayerEntity): void {
    const base = pe.position;
    const ang  = Math.random() * Math.PI * 2;
    const dist = SPAWN_RING_MIN + Math.random() * (SPAWN_RING_MAX - SPAWN_RING_MIN);

    const spawnPos: Vector3Like = {
      x: base.x + Math.sin(ang) * dist,
      y: base.y,
      z: base.z + Math.cos(ang) * dist
    };

    const zEnt = new Entity({
      name:       `Zombie-W${this._round}-${(Date.now() % 100_000)}`,
      tag:        "gehenna-zombie",
      modelUri:   "models/enemies/zombie.gltf",
      modelScale: 1.0,
      rigidBodyOptions: {
        type: RigidBodyType.KINEMATIC_VELOCITY,
        colliders: [
          {
            shape:      ColliderShape.CAPSULE,
            halfHeight: 0.45,
            radius:     0.28,
            tag:        "body"
          }
        ]
      }
    });
    zEnt.spawn(world, spawnPos);

    // Wave-scaled animation: walk (slow traumatic shamble) → run as speed increases.
    // Wave 1 starts at 0.5× playback (dragging lurch), ramps to 1.0 by wave 5,
    // then switches to the "run" clip from wave 6 onward (speed > RUN_THRESHOLD).
    const RUN_THRESHOLD = Z_BASE_SPEED + 5 * Z_SPEED_PER_WAVE; // ≈ 1.80 m/s, wave 6
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
        // Speed range Z_BASE_SPEED → RUN_THRESHOLD maps to rate 0.50 → 1.0.
        // Wave 1 = 0.50× (traumatic slow shamble), wave 5 ≈ 1.0× (normal trudge).
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
      isDog:           false
    });
  }

  private spawnOneDog(world: World, pe: PlayerEntity): void {
    const base = pe.position;
    const ang  = Math.random() * Math.PI * 2;
    const dist = SPAWN_RING_MIN + Math.random() * (SPAWN_RING_MAX - SPAWN_RING_MIN);

    const spawnPos: Vector3Like = {
      x: base.x + Math.sin(ang) * dist,
      y: base.y,
      z: base.z + Math.cos(ang) * dist
    };

    const dEnt = new Entity({
      name:       `HellHound-W${this._round}-${(Date.now() % 100_000)}`,
      tag:        "gehenna-zombie",
      modelUri:   "models/npcs/animals/dog-german-shepherd.gltf",
      modelScale: 1.0,
      rigidBodyOptions: {
        type: RigidBodyType.KINEMATIC_VELOCITY,
        colliders: [
          {
            shape:      ColliderShape.CAPSULE,
            halfHeight: 0.18,
            radius:     0.22,
            tag:        "body"
          }
        ]
      }
    });
    dEnt.spawn(world, spawnPos);

    // Dogs sprint — run animation, rate scales with wave number (frantic from wave 5+).
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
      isDog:           true
    });
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
      const attackDmg    = row.isDog ? DOG_ATTACK_DAMAGE   : Z_ATTACK_DAMAGE;
      const attackCooldown = row.isDog ? DOG_ATTACK_COOLDOWN_S : Z_ATTACK_COOLDOWN_S;

      if (len <= attackRange) {
        // In melee range — stop and swing when cooldown allows
        row.entity.setLinearVelocity({ x: 0, y: 0, z: 0 });

        if (row.attackCooldownS === 0) {
          row.attackCooldownS = attackCooldown;
          this._health = Math.max(0, this._health - attackDmg);
          hudDirty = true;

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

          // Rotate the entity to face the player on the XZ plane.
          // atan2(dx, dz) gives the Y-axis angle from +Z toward the player.
          const angle = Math.atan2(dx, dz);
          const hs = Math.sin(angle / 2);
          const hc = Math.cos(angle / 2);
          row.entity.setRotation({ x: 0, y: hs, z: 0, w: hc });
        }
      }
    }

    if (hudDirty) this.syncHud(host);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Hitscan gun tick
  // ─────────────────────────────────────────────────────────────────────────────

  private tickGun(host: Player, pe: PlayerEntity, world: World): void {
    const now = performance.now();
    const inp = host.input;

    // Left-mouse edge detection
    const ml      = !!(inp as { ml?: boolean }).ml;
    const mlRise  = ml && !this._prevMl;
    this._prevMl  = ml;

    // R key edge detection
    const rPress = !!(inp as { r?: boolean }).r;
    const rRise  = rPress && !this._prevR;
    this._prevR  = rPress;

    // Reload
    if (now >= this._reloadUntilMs && rRise && this._mag < this._magMax && this._reserve > 0) {
      const need = this._magMax - this._mag;
      const take = Math.min(need, this._reserve);
      this._mag     += take;
      this._reserve -= take;
      this._reloadUntilMs = now + RELOAD_DURATION_MS;
      this.syncHud(host);
      return;
    }

    // Blocked while reloading
    if (now < this._reloadUntilMs) return;

    // Only process fresh trigger-pull
    if (!mlRise) return;

    // Rate limit
    if (now < this._nextFireAllowedMs) return;

    // Dry fire
    if (this._mag <= 0) {
      world.chatManager.sendPlayerMessage(host, "Dry — press R to reload.", "CCCCCC");
      return;
    }

    // Fire!
    this._mag -= 1;
    this._nextFireAllowedMs = now + FIRE_INTERVAL_MS;
    this._shotsFired += 1;

    const hit = this.sphereHitscan(host, pe);
    if (hit) {
      this._shotsHit += 1;
      this.applyHitToZombie(hit.row, hit.headshot, world, host);
    }

    this.syncHud(host);
  }

  /**
   * Cast a ray from the player's eye through all live zombie body and head spheres.
   * Returns the closest hit (head sphere wins ties), or null.
   */
  private sphereHitscan(
    host: Player,
    pe: PlayerEntity
  ): { row: ZombieRow; headshot: boolean } | null {
    const { pitch, yaw } = host.camera.orientation;
    const f = PLAYER_EYE_FORWARD_OFFSET;
    const ox =
      pe.position.x - Math.sin(yaw) * f;
    const oy = pe.position.y + PLAYER_EYE_Y_OFFSET;
    const oz =
      pe.position.z - Math.cos(yaw) * f;

    // Direction from camera pitch/yaw (already used in legacy codebase)
    const cp   = Math.cos(pitch);
    const rawX = -Math.sin(yaw) * cp;
    const rawY =  Math.sin(pitch);
    const rawZ = -Math.cos(yaw) * cp;
    const dlen = Math.hypot(rawX, rawY, rawZ) || 1;
    const dx   = rawX / dlen;
    const dy   = rawY / dlen;
    const dz   = rawZ / dlen;

    let bestT    = RAY_MAX_RANGE;
    let bestRow: ZombieRow | null = null;
    let bestHead = false;

    for (const row of this._zombies) {
      if (!row.entity.isSpawned) continue;
      const zp = row.entity.position;

      const headCy = row.isDog ? DOG_HEAD_CENTER_Y : HEAD_CENTER_Y;
      const headR  = row.isDog ? DOG_HEAD_RADIUS   : HEAD_RADIUS;
      const bodyCy = row.isDog ? DOG_BODY_CENTER_Y : BODY_CENTER_Y;
      const bodyR  = row.isDog ? DOG_BODY_RADIUS   : BODY_RADIUS;

      // Test head sphere first — headshot wins a tie with body sphere
      const ht = raySphere(
        ox, oy, oz,
        dx, dy, dz,
        zp.x, zp.y + headCy, zp.z,
        headR
      );
      if (ht >= 0 && ht < bestT) {
        bestT    = ht;
        bestRow  = row;
        bestHead = true;
      }

      // Test body sphere
      const bt = raySphere(
        ox, oy, oz,
        dx, dy, dz,
        zp.x, zp.y + bodyCy, zp.z,
        bodyR
      );
      if (bt >= 0 && bt < bestT) {
        bestT    = bt;
        bestRow  = row;
        bestHead = false;
      }
    }

    return bestRow ? { row: bestRow, headshot: bestHead } : null;
  }

  private applyHitToZombie(
    row: ZombieRow,
    headshot: boolean,
    world: World,
    host: Player
  ): void {
    const tierMul = Math.pow(PAP_DAMAGE_FACTOR, this._packTier);
    const baseDmg = Math.round(this._weaponDamage * tierMul);
    const dmg     = headshot ? Math.round(baseDmg * HEADSHOT_MULTIPLIER) : baseDmg;

    row.hp -= dmg;

    if (row.hp <= 0) {
      // ── Kill ──
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
    this.clearZombies();
    this.destroyPropEntities();
    this.resetWaveDirector();

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
    this._weaponName             = pick.name;
    this._magMax                 = pick.mag;
    this._mag                    = pick.mag;
    this._reserve                = pick.reserve;
    this._mysteryCooldownUntilMs = now + MYSTERY_COOLDOWN_MS;
    world.chatManager.sendPlayerMessage(host, `Mystery weapon: ${pick.name}`, "FFD700");
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
    if (performance.now() < this._reloadUntilMs) return;

    const p      = pe.position;
    const nearPap = this._papEntity?.isSpawned
      ? this.distXZ(p, this._papEntity.position) < INTERACT_RADIUS
      : false;
    const nearMy  = this._mysteryEntity?.isSpawned
      ? this.distXZ(p, this._mysteryEntity.position) < INTERACT_RADIUS
      : false;

    const now = performance.now();

    if (nearPap) {
      if (this._packTier >= PAP_MAX_TIER) {
        this._mag     = this._magMax;
        this._reserve = Math.max(this._reserve, RESERVE_START);
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
        this._mag      = this._magMax;
        this._reserve  = Math.max(this._reserve, RESERVE_START);
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
      const pick = MYSTERY_POOL[Math.floor(Math.random() * MYSTERY_POOL.length)]!;
      this._pendingMysteryWeapon = pick;
      this._mysteryBusyUntilMs  = now + MYSTERY_SPIN_MS;
      world.chatManager.sendPlayerMessage(host, "Mystery Chest — rolling…", "FFD700");
      this.syncHud(host);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // State helpers
  // ─────────────────────────────────────────────────────────────────────────────

  private resetRunState(): void {
    this.clearZombies();
    this.destroyPropEntities();
    this.resetWaveDirector();

    this._health     = PLAYER_MAX_HEALTH;
    this._points     = 0;
    this._runStartMs = performance.now();

    this._kills     = 0;
    this._headshots = 0;
    this._shotsFired = 0;
    this._shotsHit   = 0;
    this._downs      = 0;
    this._revives    = 0;

    this._weaponName   = "Assault Rifle";
    this._weaponDamage = WEAPON_DAMAGE;
    this._mag          = MAG_SIZE;
    this._magMax       = MAG_SIZE;
    this._reserve      = RESERVE_START;
    this._packTier     = 0;

    this._reloadUntilMs     = 0;
    this._nextFireAllowedMs = 0;
    this._prevMl = false;
    this._prevF  = false;
    this._prevR  = false;

    this._mysteryBusyUntilMs     = 0;
    this._mysteryCooldownUntilMs = 0;
    this._pendingMysteryWeapon   = null;

    // Wave 1 fires after 1.8 s
    this._intermissionTimer = WAVE_FIRST_INTERMISSION_S;
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
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Props
  // ─────────────────────────────────────────────────────────────────────────────

  private spawnWorldProps(world: World): void {
    this.destroyPropEntities();

    this._papEntity = new Entity({
      name:       "Pack-a-Punch",
      tag:        "gehenna-pap",
      modelUri:   "models/props/pack-a-punch-machine.gltf",
      modelScale: 1.05,
      rigidBodyOptions: { type: RigidBodyType.FIXED }
    });
    this._papEntity.spawn(world, PROP_PAP_POS);

    this._mysteryEntity = new Entity({
      name:       "Mystery Chest",
      tag:        "gehenna-mystery",
      modelUri:   "models/props/mystery-chest.gltf",
      modelScale: 1.0,
      rigidBodyOptions: { type: RigidBodyType.FIXED }
    });
    this._mysteryEntity.spawn(world, PROP_MYSTERY_POS);
  }

  private destroyPropEntities(): void {
    if (this._papEntity?.isSpawned)     this._papEntity.despawn();
    if (this._mysteryEntity?.isSpawned) this._mysteryEntity.despawn();
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
    return `${this._weaponName}${pap}`;
  }

  private distXZ(a: Vector3Like, b: Vector3Like): number {
    return Math.hypot(a.x - b.x, a.z - b.z);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Debug fetch (preserved from existing session instrumentation)
  // ─────────────────────────────────────────────────────────────────────────────

  private debugFetch(
    location: string,
    message: string,
    hypothesisId: string,
    data: Record<string, unknown>
  ): void {
    void fetch(
      "http://127.0.0.1:7457/ingest/ed9b07e2-465a-482e-b5a8-7dd1854cf52a",
      {
        method:  "POST",
        headers: {
          "Content-Type":       "application/json",
          "X-Debug-Session-Id": "de4214"
        },
        body: JSON.stringify({
          sessionId:    "de4214",
          hypothesisId,
          location,
          message,
          data,
          timestamp:    Date.now()
        })
      }
    ).catch(() => {});
  }
}
