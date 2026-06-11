import {
  Audio,
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
import { createGun, GUN_DISPLAY_NAME, isGunId, type GunEntity, type GunId } from "./guns";
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
// scaled by the zombie's per-row model scale. (Official zombies are 0.5–0.7 scale.)
const HEADSHOT_Y_THRESHOLD = 0.3; // × row.scale, above entity.position.y

// Zombie body-centre offset for explosion distance checks, per 1.0 of model scale.
const BODY_CENTER_Y = -0.27;  // × row.scale — offset from capsule centre → mid-torso

/** Third-person orbit behind the player (+Z is back in Hytopia). */
const THIRD_PERSON_CAMERA_OFFSET: Vector3Like = { x: 0, y: 0.4, z: 2.5 };
// First-person camera: the OFFICIAL zombies-fps value — a single y offset, nothing else.
const FIRST_PERSON_CAMERA_OFFSET: Vector3Like = { x: 0, y: 0.5, z: 0 };

// Dog explosion body offset (per 1.0 scale, same convention as BODY_CENTER_Y)
const DOG_BODY_CENTER_Y = -0.05;

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
const INTERACT_RADIUS              = 3.2;
const PROP_PAP_POS: Vector3Like    = { x: -12, y: 3.8, z: -8 };
const PROP_MYSTERY_POS: Vector3Like = { x: -30, y: 3.8, z: 4  };

// Test Map decorations
const TEDDY_POSITIONS: Vector3Like[] = [
  { x: -8,  y: 1.2, z: 20 },
  { x: -12, y: 1.2, z: 22 },
  { x: -6,  y: 1.2, z: 17 },
];

// Explosion safety: Never destroy blocks at or below this Y to protect the main floor of the map.
const WORLD_FLOOR_PROTECTION_Y = 1;

// C4 Jump perk (fun rocket jump when standing on your own C4)
const C4_JUMP_RADIUS = 3.8;
const C4_JUMP_FORCE = 32;        // very strong upward when right on top
const C4_JUMP_HORIZONTAL = 7;    // allows some creative movement (directional jumps)

// Lethal Testing Pickups (physical objects on Test Map)
// Spread out and away from the teddy bears for easy access.
const LETHAL_PICKUP_XZ: { x: number; z: number; lethalId: LethalId; label: string; model: string; scale: number }[] = [
  { x: -18, z: 12, lethalId: "frag",    label: "Frag Grenade",   model: "models/particles/green-sphere.glb", scale: 1.1 },
  { x: -20, z: 8,  lethalId: "n74st",   label: "N 74 ST (Sticky)", model: "models/particles/sticky-bomb.glb",  scale: 1.0 },
  { x: -16, z: 5,  lethalId: "satchel", label: "C4 Satchel",     model: "models/particles/c4-block.glb",     scale: 1.25 },
  { x: -22, z: 10, lethalId: "smine44", label: "S-Mine 44",      model: "models/particles/smine.glb",        scale: 1.15 },
];

// Weapons Testing Range (Test Map): ALL six official zombies-fps guns laid out on
// the floor. Run into one to equip it — verifies every gun sits correctly in the
// player's hands. Mirrors the lethal pickup pattern.
const WEAPON_PICKUP_XZ: { x: number; z: number; weaponKey: GunId; label: string; model: string; scale: number }[] = [
  { x: -6, z: 12, weaponKey: "pistol",       label: "Pistol",       model: "models/items/pistol.glb",       scale: 0.8 },
  { x: -3, z: 12, weaponKey: "auto-pistol",  label: "Auto Pistol",  model: "models/items/auto-pistol.glb",  scale: 0.8 },
  { x:  0, z: 12, weaponKey: "shotgun",      label: "Shotgun",      model: "models/items/shotgun.glb",      scale: 0.8 },
  { x:  3, z: 12, weaponKey: "auto-shotgun", label: "Auto Shotgun", model: "models/items/auto-shotgun.glb", scale: 0.8 },
  { x:  6, z: 12, weaponKey: "ar15",         label: "AR-15",        model: "models/items/ar-15.glb",        scale: 0.8 },
  { x:  9, z: 12, weaponKey: "ak47",         label: "AK-47",        model: "models/items/ak-47.glb",        scale: 0.8 },
];

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
  lethalCharges?: number;
  lethalName?: string;
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
  scale:           number; // per-zombie modelScale (official: 0.5 + rand*0.2) — used for headshot height + explosion offsets
};

// Mystery box rolls among the official zombies-fps guns (minus whatever you're holding).
const MYSTERY_POOL: GunId[] = ["pistol", "auto-pistol", "shotgun", "auto-shotgun", "ar15", "ak47"];

// ─────────────────────────────────────────────────────────────────────────────
// GehennaDirector
// ─────────────────────────────────────────────────────────────────────────────

export class GehennaDirector {
  private _world: World | null = null;
  private _sessionStarted = false;

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

  // Props
  private _papEntity: Entity | null = null;
  private _mysteryEntity: Entity | null = null;
  private _teddyEntities: Entity[] = [];
  private _launchedTeddies: { entity: Entity; despawnAt: number }[] = [];
  private _lethalPickupEntities: { entity: Entity; lethalId: LethalId; label: string }[] = [];
  private _weaponPickupEntities: { entity: Entity; weaponKey: GunId; label: string }[] = [];
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
  private _prevR  = false;
  private _prevC  = false;
  /** Edge detect for lethal throw (wire key **n**; local client maps **G** → n). */
  private _prevN  = false;
  /** Timestamp of the last accepted lethal-use — used to debounce the double-fire from UI + input poll. */
  private _lethalUsedAtMs = 0;

  /** Desktop: press C to toggle first / third person during a run. */
  private _thirdPersonActive = false;

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
    // Restore Test Map before we lose the world reference
    this.restoreAndClearTestMapBlocks();

    if (this._world) {
      this._world.loop.off(WorldLoopEvent.TICK_START, this._onTick);
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
    this.teleportHostToMapSpawn(world, player, mapId);
    this.spawnWorldProps(world);

    // Equip the starting rifle (official GunEntity — parented to the hand anchor)
    const peStart = this.getHostPlayerEntity(world, player);
    if (peStart) this.equipGun(world, peStart, this._gunId);

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
      ? "Test Zone active — 999 lethals, press G to throw. LMB fire · R reload · F interact · C camera."
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
    if (pe) this.equipGun(this._world, pe, this._gunId);
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

    this.stopTeddyVictorySong(); // Stop victory song on restart / new game
    this.resetRunState();
    this.teleportHostToMapSpawn(world, player, mapId);
    this.spawnWorldProps(world);

    // Equip the starting rifle for the new run
    const peRestart = this.getHostPlayerEntity(world, player);
    if (peRestart) this.equipGun(world, peRestart, this._gunId);

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
      hostiles:       this._zombies.length,
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

    this.tickCameraToggle(host, w);
    this.tickGun(host, pe, w);
    this.tickAds(host, dtS);
    this.tickLethalInput(host, w, dtS);
    this.tickLethalBlasts(w, host, pe, dtS);
    this.tickTeddyBears(w);
    this.tickLethalPickups(w, pe);
    this.tickWeaponPickups(w, pe);
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

    const targetX = base.x + Math.sin(ang) * dist;
    const targetZ = base.z + Math.cos(ang) * dist;

    // Find actual ground level so zombies don't spawn floating in the air
    const groundY = this.findGroundY(world, targetX, targetZ);

    const spawnPos: Vector3Like = {
      x: targetX,
      y: groundY + 0.1, // small extra offset for the capsule collider + model
      z: targetZ
    };

    // Official zombies-fps zombie scale: 0.5 + rand*0.2 — matches the soldier-player
    // rig @ 0.5 so player and horde are correctly proportioned. Slight per-zombie
    // variation also makes the horde look more organic.
    const zScale = 0.5 + Math.random() * 0.2;

    const zEnt = new Entity({
      name:       `Zombie-W${this._round}-${(Date.now() % 100_000)}`,
      tag:        "gehenna-zombie",
      modelUri:   "models/enemies/zombie.gltf",
      modelScale: zScale,
      rigidBodyOptions: {
        type: RigidBodyType.KINEMATIC_VELOCITY,
        colliders: [
          {
            // Capsule scaled to match the model (base values were tuned at scale 1.0)
            shape:      ColliderShape.CAPSULE,
            halfHeight: 0.45 * zScale,
            radius:     0.28 * zScale,
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
      isDog:           false,
      scale:           zScale
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

    // Scaled to fit the official world proportions (player 0.5, zombies 0.5–0.7)
    const dogScale = 0.6;

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
            halfHeight: 0.18 * dogScale,
            radius:     0.22 * dogScale,
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
      isDog:           true,
      scale:           dogScale
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
      const attackDmg    = row.isDog ? DOG_ATTACK_DAMAGE   : Z_ATTACK_DAMAGE; // 35 / 50 dmg → very punishing without Jug perk
      const attackCooldown = row.isDog ? DOG_ATTACK_COOLDOWN_S : Z_ATTACK_COOLDOWN_S;

      if (len <= attackRange) {
        // In melee range — stop and swing when cooldown allows
        row.entity.setLinearVelocity({ x: 0, y: 0, z: 0 });

        if (row.attackCooldownS === 0) {
          row.attackCooldownS = attackCooldown;
          this._health = Math.max(0, this._health - attackDmg);
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

    const res = this._lethalSystem.useLethal(world, player, pe, this._activeLethal, origin, dir);
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
  private tickLethalBlasts(world: World, host: Player, pe: PlayerEntity | undefined, dtS = 1 / 60): void {
    if (!this._lethalSystem) return;
    // Gather live zombie positions so S-Mine proximity check triggers on enemies, not the player.
    const zombiePositions = this._zombies
      .filter(z => z.entity.isSpawned)
      .map(z => z.entity.position);
    this._lethalSystem.tick(dtS, world, host, pe?.position, zombiePositions);
  }

  /** Updates any teddy bears that have been shot and are flying away. */
  private tickTeddyBears(world: World): void {
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

      // Already holding this weapon? do nothing.
      if (this._gunId === pickup.weaponKey && this._gun) break;

      this.equipGun(world, pe, pickup.weaponKey as GunId);
      world.chatManager.sendPlayerMessage(
        this._hostPlayer,
        `Equipped: ${GUN_DISPLAY_NAME[pickup.weaponKey as GunId]}`,
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
      onAmmoChanged: () => { if (this._hostPlayer) this.syncHud(this._hostPlayer); },
    });
    gun.spawn(world, { x: 0, y: 0, z: -0.2 }, Quaternion.fromEuler(-90, 0, 0));
    this._gun = gun;

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
  private tickGun(host: Player, pe: PlayerEntity, world: World): void {
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

  /** Raycast hit resolution — zombies (damage/points/headshots) and teddies (test map). */
  private onGunHit(hitEntity: Entity, hitPoint: Vector3Like, baseDamage: number): void {
    const world = this._world;
    const host  = this._hostPlayer;
    if (!world || !host) return;

    // Test-map teddy bears launch when shot
    if (this._teddyEntities.includes(hitEntity)) {
      this.launchTeddyBear(hitEntity, world);
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
    this._prevR  = false;
    this._prevC  = false;
    this._prevN  = false;
    this._lethalUsedAtMs  = 0;
    this._thirdPersonActive = false;

    this._mysteryBusyUntilMs     = 0;
    this._mysteryCooldownUntilMs = 0;
    this._pendingMysteryWeapon   = null;

    this.applyLoadoutLethals();
    if (this._lethalSystem) this._lethalSystem.reset();

    // Reset teddy bear victory song so it can play again on next run
    this._teddyVictorySongPlayed = false;

    // Wave 1 fires after 1.8 s
    this._intermissionTimer = WAVE_FIRST_INTERMISSION_S;
  }

  /** Grant starting lethal charges from the deploy loadout (all maps). */
  private applyLoadoutLethals(): void {
    this._activeLethal   = this._deployLoadout.lethal;

    // On the Test Map, give the player EVERY lethal with 999 charges so they can freely test all of them
    if (this._currentMapId === "test_zone") {
      this._lethalCharges = 999; // They can switch lethals in the loadout and always have full charges
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

    // Spawn Test Map specific decorations and testing tools
    if (this._currentMapId === "test_zone") {
      this.spawnTeddyBears(world);
      this.spawnLethalPickups(world);
      this.spawnWeaponPickups(world);
    }
  }

  private spawnTeddyBears(world: World): void {
    this._teddyEntities = [];

    TEDDY_POSITIONS.forEach((pos, index) => {
      const teddy = new Entity({
        name:       `TeddyBear-${index + 1}`,
        tag:        "gehenna-decoration",
        modelUri:   "models/teddy_bear.glb",
        modelScale: 1.0,
        rigidBodyOptions: { type: RigidBodyType.FIXED }
      });
      teddy.spawn(world, pos);
      this._teddyEntities.push(teddy);
    });
  }

  /** Spawns physical lethal pickups around the Test Map for easy testing of all 4 lethals */
  private spawnLethalPickups(world: World): void {
    this._lethalPickupEntities = [];

    LETHAL_PICKUP_XZ.forEach((data) => {
      const groundY = this.findGroundY(world, data.x, data.z);
      // Nice floating height above the actual floor
      const spawnPos: Vector3Like = { x: data.x, y: groundY + 0.9, z: data.z };

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
        "Test Map: 4 Lethal Pickups spawned (Frag / Sticky / C4 / S-Mine). Run into them to equip with 999 charges. They stay for repeated testing!",
        "00FFAA"
      );
    }
  }

  /** Spawns physical weapon pickups (the weapons test range) on the Test Map. */
  private spawnWeaponPickups(world: World): void {
    this._weaponPickupEntities = [];

    WEAPON_PICKUP_XZ.forEach((data) => {
      const groundY = this.findGroundY(world, data.x, data.z);
      const spawnPos: Vector3Like = { x: data.x, y: groundY + 1.0, z: data.z };

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

    console.log(`[Test Map] Spawned ${WEAPON_PICKUP_XZ.length} weapon pickups`);

    if (this._hostPlayer) {
      world.chatManager.sendPlayerMessage(
        this._hostPlayer,
        `Weapons Range: all ${WEAPON_PICKUP_XZ.length} guns on the floor — walk into one to hold it. LMB fire · R reload · RMB aim.`,
        "FFD700"
      );
    }
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
    const name = this._gun?.name || GUN_DISPLAY_NAME[this._gunId];
    return `${name}${pap}`;
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

  /**
   * Finds the highest solid block at the given X/Z coordinates and returns
   * a Y value so the zombie's feet sit on the ground instead of spawning in the air.
   */
  private findGroundY(world: World, x: number, z: number, startY = 50): number {
    const cx = Math.floor(x);
    const cz = Math.floor(z);

    for (let y = startY; y >= -2; y--) {
      try {
        const blockId = world.chunkLattice.getBlockId({ x: cx, y, z: cz });
        if (blockId !== 0) {
          // Return a safe height above the block top.
          // The zombie capsule + model needs a bit of extra clearance.
          return y + 1.35;
        }
      } catch {
        // Chunk may not be loaded yet — continue searching
      }
    }

    return 1.0; // safe fallback
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
              // Record destroyed blocks so we can restore them on Test Map restart
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
