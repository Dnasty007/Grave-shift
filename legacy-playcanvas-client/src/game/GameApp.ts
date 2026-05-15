import * as pc from "playcanvas";
import type { AnimTrack } from "playcanvas";
import { GAME_CONFIG, MAP_CONFIG, applyMapPreset, type MapPresetId } from "./config";
import { AudioEngine } from "./AudioEngine";
import { CollisionWorld } from "./CollisionWorld";
import { Effects } from "./Effects";
import { Hud } from "./Hud";
import { InputManager } from "./InputManager";
import { InteractionController } from "./Interactable";
import { Map as ZoneMap, type MapBuildResult } from "./Map";
import { MenuController } from "./MenuController";
import { PlayerController } from "./PlayerController";
import { ScreenEffects } from "./ScreenEffects";
import { Settings } from "./Settings";
import { WaveDirector } from "./WaveDirector";
import { formatWaveRound } from "./waveDisplay";
import { applySceneSkybox, getSceneSkyboxConfig } from "./sceneSkybox";
import {
  Weapon,
  WEAPON_DEFINITIONS,
  WEAPON_IDS,
  WeaponInventory,
  STARTER_WEAPON_SLOTS,
  type WeaponId
} from "./Weapon";
import { WeaponWheel } from "./WeaponWheel";
import { Zombie, type EnemyModelKit } from "./Zombie";
import { DragonBoss } from "./DragonBoss";
import { AiAlly } from "./AiAlly";
import { NineTailsPet } from "./NineTailsPet";
import { MaxAmmoDrop } from "./PowerupDrop";
import { JetpackPickup, type JetpackVariant } from "./JetpackPickup";
import { MysteryBox, MYSTERY_BOX_POOL, MYSTERY_BOX_POOL_NAMES } from "./MysteryBox";
import { PackAPunchMachine } from "./PackAPunch";
import { RoundSkipperBlock } from "./RoundSkipperBlock";
import { PlayerStash } from "./PlayerStash";
import { WorldItemDrop } from "./WorldItemDrop";
import type { Door } from "./Door";
import {
  applyPlayerModelPreset,
  getPlayerVisualRuntime,
  type PlayerModelId
} from "./runSession";
import { LETHAL_PARAMS, LETHAL_PHYSICS, type LoadoutData, type LethalId } from "./LoadoutStore";
import { PlayerAccount, getLevelForXp } from "./PlayerAccount";
import { TeddyBearEasterEgg } from "./TeddyBearEasterEgg";

/**
 * Top-level game shell: owns the PlayCanvas `Application`, wires every subsystem, and runs the frame loop.
 *
 * | Area in this file          | What you feel in-game                          |
 * | -------------------------- | ---------------------------------------------- |
 * | Constructor + load map     | Boot, imported GLB, initial camera clip      |
 * | `update()`                 | Player, zombies, waves, interact prompt       |
 * | Open-world terrain blocks  | Feet stay on mesh; optional gravity drop      |
 * | `handleShot`               | Hits, kills, points, kill FX                   |
 * | `beginRunWithSetup` / `endRun`… | Lobby → play, game over, pause, title   |
 * | `configureScene`           | Fog / ambient / exposure look                  |
 */
type GamePhase = "title" | "playing" | "paused" | "gameOver";

type RunStats = {
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  startTime: number;
};

const ZONE_FOR_DOOR_INDEX = ["loadingBay", "office", "powerYard"] as const;

/** Max C4 bricks in the world at once (in flight + planted). */
const C4_MAX_ACTIVE = 4;
/** Hold G this long to detonate all planted C4. */
const C4_DETONATE_HOLD_SECONDS = 0.45;
/** Max S-MINE 44 units placed at once (matches charge count). */
const SMINE_MAX_ACTIVE = 2;

function kitFromContainerAsset(asset: pc.Asset): EnemyModelKit {
  const res = asset.resource as pc.ContainerResource & { animations?: pc.Asset[] };
  const byName = new Map<string, AnimTrack>();
  for (const animAsset of res.animations ?? []) {
    const tr = animAsset.resource as AnimTrack | undefined;
    if (tr && typeof tr.name === "string") {
      byName.set(tr.name, tr);
    }
  }
  return {
    instantiate: () => res.instantiateRenderEntity(),
    getAnimTrack: (name: string) => byName.get(name),
    listAnimClipNames: () => Array.from(byName.keys())
  };
}

type C4FlightState = {
  position: pc.Vec3;
  velocity: pc.Vec3;
  visual: pc.Entity;
};

type C4ArmedState = {
  position: pc.Vec3;
  visual: pc.Entity;
};

type ActiveSmine =
  | {
      kind: "arming";
      x: number;
      z: number;
      groundY: number;
      t: number;
      armDuration: number;
      pulseAcc: number;
      visual: pc.Entity;
      bodyMat: pc.StandardMaterial;
      baseEm: pc.Color;
    }
  | { kind: "armed"; x: number; z: number; groundY: number; visual: pc.Entity; triggerR: number }
  | {
      kind: "rising";
      x: number;
      z: number;
      groundY: number;
      riseT: number;
      riseDur: number;
      popH: number;
      visual: pc.Entity;
    };

type SmineShrapnelPiece = {
  pos: pc.Vec3;
  vel: pc.Vec3;
  life: number;
  hitR: number;
  dmg: number;
  visual: pc.Entity;
};

type PendingFlyingLethal = {
  lethalKind: LethalId;
  position: pc.Vec3;
  velocity: pc.Vec3;
  fuseRemaining: number;
  fuseTotal: number;
  blastRadius: number;
  colliderRadius: number;
  visual: pc.Entity;
  glowMat: pc.StandardMaterial;
  glowBase: pc.Color;
  visualBaseScale: number;
  preheatAcc: number;
  /** N 74 ST: glued to surface / zombie, no more flight. */
  stuck: boolean;
  stuckZombie: Zombie | null;
  /** When stuck to a zombie, track head vs body capsule for re-snap each frame. */
  stuckUseHead: boolean;
};

export class GameApp {
  private readonly app: pc.Application;
  private readonly canvas: HTMLCanvasElement;
  private readonly settings: Settings;
  private readonly audio: AudioEngine;
  private readonly effects: Effects;
  private readonly screenEffects: ScreenEffects;
  private readonly menus: MenuController;
  private readonly hud: Hud;
  private readonly input: InputManager;
  private readonly inventory: WeaponInventory;
  private readonly player: PlayerController;
  private readonly waveDirector: WaveDirector;
  private readonly collision: CollisionWorld;
  private readonly map: ZoneMap;
  private readonly interactions: InteractionController;
  private readonly doors: Door[] = [];

  // ── ADS HUD overlays ──────────────────────────────────────────────────────
  private readonly scopeOverlay: HTMLElement | null;
  private readonly crosshairEl: HTMLElement | null;
  private lastScopeState = false;
  private lastAdsState = false;

  private zombies: Zombie[] = [];
  /** Active Ice Dragon boss — managed separately so we can draw its HP bar. */
  private dragonBoss: DragonBoss | null = null;
  private ally: AiAlly | null = null;
  private nineTailsPet: NineTailsPet | null = null;
  private nineTailsPetKit: EnemyModelKit | null = null;
  private readonly nineTailsPetAssetPromise: Promise<void>;
  private maxAmmoDrops: MaxAmmoDrop[] = [];
  private jetpackDrops: JetpackPickup[] = [];
  private jetpackVariantCursor: JetpackVariant = "valkyrie";
  /** Loaded once per variant; {@link ensureJetpackCosmeticAttached} attaches to the hero. */
  private jetpackCosmeticAssets: Partial<Record<JetpackVariant, pc.Asset>> = {};
  private mysteryBox: MysteryBox | null = null;
  private packAPunch: PackAPunchMachine | null = null;
  private devRoundSkipper: RoundSkipperBlock | null = null;
  private readonly stash = new PlayerStash();
  private worldDrops: WorldItemDrop[] = [];
  private inventorySelectedSlot = 0;
  private points = 0;
  private phase: GamePhase = "title";
  private stats: RunStats = this.makeStats();
  /** Dev / test: click HUD button to pause all AI movement and attacks. */
  private terrainFollowTimer = 0;
  private zombieTerrainTimer = 0;
  private zombieTerrainCursor = 0;
  private playerGravityDropActive = false;
  private playerGravityDropVelocity = 0;
  private playerGravityDropTargetY: number | null = null;

  private readonly enemyModelKits: EnemyModelKit[] = [];
  private hellhoundKit: EnemyModelKit | null = null;
  private bossKit: EnemyModelKit | null = null;
  private readonly weaponViewAssetEntries: ReadonlyMap<WeaponId, { asset: pc.Asset }>;

  /** Last lobby picks (restart / Run it back skips map & operator screens). */
  private lastMapId: MapPresetId = "castle";
  private lastPlayerId: PlayerModelId = "soldier";
  /** Active loadout — set when the player clicks Deploy. Re-applied on Restart. */
  private activeLoadout: LoadoutData | null = null;
  /** Persistent player account — souls, XP, owned mods. */
  private readonly account = new PlayerAccount();

  // ── In-run level tracking ──────────────────────────────────────────────────
  /** XP accumulated THIS run (not yet persisted — used for in-run level-up detection). */
  private runXpGained = 0;
  /** Simulated level at start of run (or last level-up). Used to detect new level-ups. */
  private inRunLevel = 0;
  /** weapon-id → kills this run — fed to PlayerAccount at end of run. */
  private runWeaponKills: Record<string, number> = {};
  /** Active 3-D level-up visual effects (pillar + ring). */
  private levelUpFx: Array<{
    pillar: pc.Entity;
    ring: pc.Entity;
    pillarMat: pc.StandardMaterial;
    ringMat: pc.StandardMaterial;
    age: number;
    readonly duration: number;
  }> = [];

  /** Hidden WW2 teddy GLBs — shoot all three for a one-per-run reward track. */
  private teddyBearEasterEgg: TeddyBearEasterEgg | null = null;

  // ── Lethal system ──────────────────────────────────────────────────────────
  private lethalCharges = 0;
  /** C4 (loadout id `satchel`): up to {@link C4_MAX_ACTIVE} bricks in flight and/or planted. */
  private c4Flights: C4FlightState[] = [];
  private c4Armed: C4ArmedState[] = [];
  private c4HoldDetonateSeconds = 0;
  private c4HoldDetonateFired = false;

  /** S-MINE 44: Bouncing Betty — arm, proximity, pop, air burst, shrapnel. */
  private activeSmines: ActiveSmine[] = [];
  private smineShrapnel: SmineShrapnelPiece[] = [];
  /** Timed grenades in flight (frag, N 74 ST). S-MINE 44 uses {@link activeSmines}. */
  private pendingLethalDetonations: PendingFlyingLethal[] = [];
  private lethalGlowPulseTime = 0;
  private playerVisualLoadSerial = 0;
  private sunEntity: pc.Entity | null = null;
  private skyFillEntity: pc.Entity | null = null;
  private skyboxTexture: pc.Texture | null = null;

  private readonly weaponWheel: WeaponWheel;
  private weaponWheelWasOpen = false;
  private weaponWheelHighlight = 0;

  constructor(canvas: HTMLCanvasElement, hudRoot: HTMLElement) {
    this.canvas = canvas;
    this.app = new pc.Application(canvas, {
      mouse: new pc.Mouse(canvas),
      touch: new pc.TouchDevice(canvas),
      keyboard: new pc.Keyboard(window)
    });

    this.app.start();
    this.app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);
    this.app.setCanvasResolution(pc.RESOLUTION_AUTO);
    this.app.graphicsDevice.maxPixelRatio = this.targetPixelRatio();

    this.settings = new Settings();
    this.audio = new AudioEngine(this.settings);
    void Promise.resolve().then(() => this.audio.prefetchMenuAndUiSamples());
    /** Unlock Web Audio on first gesture anywhere (menu sits above canvas; canvas-only unlock missed most clicks). */
    const unlockWebAudioOnce = () => {
      this.audio.unlock();
    };
    document.addEventListener("pointerdown", unlockWebAudioOnce, { capture: true, once: true });
    document.addEventListener("keydown", unlockWebAudioOnce, { capture: true, once: true });
    this.effects = new Effects(this.app);
    this.screenEffects = new ScreenEffects(canvas, document.body, this.settings);

    if (GAME_CONFIG.enemyVisual.useGltf) {
      for (let i = 0; i < GAME_CONFIG.enemyVisual.gltfUrls.length; i++) {
        const url = GAME_CONFIG.enemyVisual.gltfUrls[i];
        const asset = new pc.Asset(`enemy-visual-${i}`, "container", { url });
        this.app.assets.add(asset);
        asset.on("error", (err: string) => {
          console.warn(`[GameApp] Enemy glTF failed (${url}):`, err);
        });
        asset.ready(() => {
          this.enemyModelKits.push(kitFromContainerAsset(asset));
        });
        this.app.assets.load(asset);
      }
    }

    if (GAME_CONFIG.hellhoundWave.enabled && GAME_CONFIG.enemyVisual.useGltf) {
      const hUrl = GAME_CONFIG.hellhoundWave.gltfUrl;
      const asset = new pc.Asset("hellhound-wolf", "container", { url: hUrl });
      this.app.assets.add(asset);
      asset.on("error", (err: string) => {
        console.warn(`[GameApp] Hellhound glTF failed (${hUrl}):`, err);
      });
      asset.ready(() => {
        this.hellhoundKit = kitFromContainerAsset(asset);
      });
      this.app.assets.load(asset);
    }

    if (GAME_CONFIG.bossWave.enabled && GAME_CONFIG.enemyVisual.useGltf) {
      const bUrl = GAME_CONFIG.bossContent.gltfUrl;
      const asset = new pc.Asset("boss-dragon-v3", "container", { url: bUrl });
      this.app.assets.add(asset);
      asset.on("error", (err: string) => {
        console.warn(`[GameApp] Boss glTF failed (${bUrl}):`, err);
      });
      asset.ready(() => {
        this.bossKit = kitFromContainerAsset(asset);
      });
      this.app.assets.load(asset);
    }

    this.nineTailsPetAssetPromise = new Promise<void>((resolve) => {
      if (!GAME_CONFIG.nineTailsPet.enabled) {
        resolve();
        return;
      }
      const url = GAME_CONFIG.nineTailsPet.glbUrl;
      const asset = new pc.Asset("nine-tails-pet", "container", { url });
      asset.on("error", (err: string) => {
        console.warn(`[GameApp] Nine-Tails pet glTF failed (${url}):`, err);
        resolve();
      });
      asset.ready(() => {
        this.nineTailsPetKit = kitFromContainerAsset(asset);
        resolve();
      });
      this.app.assets.add(asset);
      this.app.assets.load(asset);
    });

    this.weaponViewAssetEntries = this.createWeaponViewAssetEntries();

    this.collision = new CollisionWorld();
    this.inventory = new WeaponInventory(STARTER_WEAPON_SLOTS);
    this.map = new ZoneMap(this.app, this.collision);

    this.hud = new Hud(hudRoot);
    this.weaponWheel = new WeaponWheel(hudRoot.querySelector("#weapon-wheel"));
    this.scopeOverlay = hudRoot.querySelector<HTMLElement>("#scope-overlay");
    this.crosshairEl = hudRoot.querySelector<HTMLElement>("#crosshair");
    this.input = new InputManager(canvas, hudRoot, this.settings);
    this.player = new PlayerController(
      this.input,
      this.settings,
      this.inventory,
      this.collision,
      this.map,
      this.weaponViewAssetEntries,
      this.audio
    );
    for (const id of WEAPON_IDS) {
      const row = this.weaponViewAssetEntries.get(id);
      if (row) {
        row.asset.ready(() => {
          this.player.refreshWeaponViewmodel();
        });
      }
    }

    this.menus = new MenuController(
      document.body,
      this.settings,
      this.account,
      {
        onBeginRun: (sel) => {
          this.lastMapId = sel.mapId;
          this.lastPlayerId = sel.playerId;
          this.activeLoadout = sel.loadout;
          void this.beginRunWithSetup();
        },
        onResume: () => this.resume(),
        onRestart: () => void this.beginRunWithSetup(),
        onReturnToTitle: () => this.returnToTitle(),
        onPauseToggleRequested: () => this.togglePause()
      },
      this.audio
    );

    this.input.setCallbacks({
      onPauseRequested: () => this.togglePause(),
      onInteractRequested: () => this.attemptInteraction(),
      onWeaponCycleRequested: (dir) => this.attemptWeaponCycle(dir),
      onWeaponWheelSlotPick: (slot) => this.pickWeaponWheelSlot(slot),
      onInventoryToggleRequested: () => this.toggleInventory()
    });

    this.hud.setInventoryActions({
      onSlotSelect: (i) => this.onInventorySlotSelect(i),
      onUseSelected: () => this.useSelectedStashAmmo(),
      onDropSelected: () => this.dropSelectedStashAmmo()
    });

    this.interactions = new InteractionController();

    this.waveDirector = new WaveDirector(
      0,
      {
        onSpawn: ({ position, health, speed, hellhound }) => {
          const kit =
            hellhound && this.hellhoundKit ? this.hellhoundKit : this.pickEnemyModelKit();
          const isHellhoundVisual = Boolean(hellhound && this.hellhoundKit);
          const zombie = new Zombie(
            position,
            {
              health,
              speed,
              hellhound: isHellhoundVisual && GAME_CONFIG.hellhoundWave.enabled
            },
            this.collision,
            kit
          );
          this.zombies.push(zombie);
          this.app.root.addChild(zombie.root);
          if (MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround) {
            this.map.snapEntityFeetToImportedGround(zombie.root, position.x, position.z, position.y);
          }
        },
        onWaveStarted: (wave, hellhoundWave) => {
          const isBoss = GAME_CONFIG.bossWave.enabled && wave === GAME_CONFIG.bossWave.waveNumber;
          if (isBoss) {
            this.screenEffects.showWaveBanner(`ICE DRAGON — ${formatWaveRound(wave)}`);
            this.audio.play("waveStart");
            this.spawnBossForWave(wave);
          } else if (hellhoundWave) {
            this.screenEffects.showWaveBanner(`HELLHOUNDS — ${formatWaveRound(wave)}`);
            this.audio.playHellhoundWaveIntro();
          } else {
            this.screenEffects.showWaveBanner(formatWaveRound(wave));
            this.audio.play("waveStart");
          }
          this.audio.setDroneIntensity(Math.min(1, wave * 0.18));
          this.map.triggerFlicker(0.85);
        },
        onWaveCleared: (wave) => {
          this.screenEffects.showWaveBanner(`${formatWaveRound(wave)} CLEARED`, 2.5);
          this.audio.play("waveCleared");
          this.map.triggerFlicker(0.5);
        },
        onIntermission: (_wave, _seconds) => {}
      },
      (playerPos) => this.map.pickRandomActiveSpawnPosition(playerPos, 10)
    );

    this.app.root.addChild(this.player.root);

    this.configureScene();

    if (MAP_CONFIG.importVisual.enabled) {
      this.collision.clear();
    }
    const built = this.map.build();
    this.wireArenaFromBuilt(built);
    void this.map.loadImportedVisual(this.app).then(() => {
      if (MAP_CONFIG.importVisual.enabled) {
        this.player.setCameraFarClip(MAP_CONFIG.importVisual.cameraFarClip);
        if (MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround) {
          if (this.map.snapPlayerFeetToImportedGround(this.player.root)) {
            this.renderHud();
          }
        }
      }
    });

    this.menus.showTitle();
    this.input.setInputBlocked(true);
    this.renderHud();
    this.syncMenuAmbientAudio();

    canvas.addEventListener("pointerdown", () => {
      this.audio.unlock();
    });
    document.body.addEventListener(
      "keydown",
      () => this.audio.unlock(),
      { once: true }
    );

    window.addEventListener("resize", () => {
      this.app.resizeCanvas(canvas.width, canvas.height);
    });

    this.app.on("update", (dt: number) => {
      this.update(dt);
    });
  }

  // --- Main loop: simulation order (input → player → zombies → waves → HUD) ---

  private update(dt: number): void {
    this.input.syncGamepads(dt);

    if (this.input.consumeGamepadStartEdge()) {
      if (this.phase === "playing" || this.phase === "paused") {
        this.togglePause();
      }
    }

    if (this.phase === "title" || this.phase === "paused") {
      this.effects.update(dt);
      this.screenEffects.update(dt);
      this.map.update(dt);
      this.input.setWeaponWheelOpen(false);
      void this.weaponWheel.sync(false, [], 0, 0, 0);
      this.weaponWheelWasOpen = false;
      return;
    }

    if (this.input.consumeRestartRequest() && this.phase === "gameOver") {
      void this.beginRunWithSetup();
      return;
    }

    if (this.phase === "gameOver") {
      this.effects.update(dt);
      this.screenEffects.update(dt);
      this.map.update(dt);
      this.input.setWeaponWheelOpen(false);
      void this.weaponWheel.sync(false, [], 0, 0, 0);
      this.weaponWheelWasOpen = false;
      this.renderHud();
      return;
    }

    const wantWeaponWheel =
      !this.settings.get().flyMode &&
      (!this.input.isTouchMode() || this.input.hasGamepad()) &&
      !this.input.isInventoryOpen() &&
      this.inventory.getOwnedCount() > 2 &&
      (this.input.isKeyHeld("KeyV") || this.input.isGamepadWeaponWheelHeld());

    this.input.setWeaponWheelOpen(wantWeaponWheel);

    if (wantWeaponWheel) {
      if (!this.weaponWheelWasOpen && document.pointerLockElement === this.canvas) {
        document.exitPointerLock();
      }
      if (!this.weaponWheelWasOpen) {
        this.weaponWheelHighlight = this.inventory.getCurrentSlotIndex();
      }
      const ptr = this.input.getPointerClient();
      this.weaponWheelHighlight = this.weaponWheel.sync(
        true,
        this.inventory.getSlots(),
        this.weaponWheelHighlight,
        ptr.x,
        ptr.y
      );
    } else {
      void this.weaponWheel.sync(false, [], 0, 0, 0);
      if (this.weaponWheelWasOpen) {
        const changed = this.inventory.setCurrentSlotIndex(this.weaponWheelHighlight);
        if (changed) {
          this.player.notifyWeaponInventoryChanged();
          this.audio.play("weaponSwap");
        }
        this.renderHud();
      }
    }
    this.weaponWheelWasOpen = wantWeaponWheel;

    const simDt = wantWeaponWheel ? dt * GAME_CONFIG.fx.weaponWheelTimeScale : dt;

    this.effects.update(simDt);
    this.screenEffects.update(simDt);
    this.map.update(simDt);

    this.input.update(dt);

    const wasReloading = this.player.isCurrentlyReloading();
    const shot = this.player.update(
      simDt,
      this.zombies,
      this.teddyBearEasterEgg?.getShotTargets() ?? []
    );

    this.applyPlayerGravityDrop(simDt);

    if (this.player.isCurrentlyReloading() && !wasReloading) {
      this.audio.play("reload");
    }
    if (!this.player.isCurrentlyReloading() && wasReloading) {
      this.audio.play("reloadDone");
    }

    if (shot) {
      this.handleShot(shot);
    }

    // Lethal: G key + fuse timers
    if (this.input.consumeLethalRequest()) {
      this.useLethal();
    }
    this.tickLethalDetonations(simDt);
    this.tickC4Flight(simDt);
    this.tickC4HoldDetonate(simDt);
    this.tickSmines(simDt);
    this.tickLevelUpFx(simDt);
    this.tickSmineShrapnel(simDt);

    if (this.ally) {
      this.ally.update(simDt, this.player.root, this.map, false);
      const allyShot = this.ally.tryEngage(simDt, this.zombies);
      this.handleAllyShot(allyShot);
    }

    if (this.nineTailsPet) {
      this.nineTailsPet.update(simDt, this.player.root, this.map, false);
      const petTick = this.nineTailsPet.tickCombat(simDt, this.zombies);
      this.handlePetCombat(petTick);
    }

    for (const zombie of this.zombies) {
      const wasAlive = zombie.alive;
      zombie.update(
        simDt,
        this.player.getPosition(),
        this.zombies,
        (damage, sourcePosition) => {
          this.player.damage(damage, sourcePosition);
          this.audio.play("playerHit");
          this.screenEffects.triggerScreenShake(GAME_CONFIG.fx.screenShakeDamage);
          const direction = this.player.consumeDamageDirection();
          if (direction) {
            this.screenEffects.triggerDamageFlash(direction);
          } else {
            this.screenEffects.triggerDamageFlash();
          }
        },
        false
      );

      if (wasAlive && zombie.shouldMoan()) {
        this.audio.play("uiHover");
      }
    }

    this.zombies = this.zombies.filter((zombie) => zombie.alive);

    // ── Dragon boss cleanup — remove from zombies array + entity tree when dead ──
    if (this.dragonBoss && !this.dragonBoss.alive) {
      this.dragonBoss.root.destroy();
      this.dragonBoss = null;
      this.syncBossHpBar(null);
    } else if (this.dragonBoss) {
      this.syncBossHpBar(this.dragonBoss.healthFraction);
    }

    // Update power-up drops; remove picked-up ones and apply their effect
    if (this.maxAmmoDrops.length > 0) {
      const playerPos = this.player.getPosition();
      this.maxAmmoDrops = this.maxAmmoDrops.filter((drop) => {
        const pickedUp = drop.update(simDt, playerPos);
        if (pickedUp) {
          this.inventory.refillAll();
          this.audio.play("maxAmmo");
          this.screenEffects.triggerMaxAmmoNotify();
        }
        return !pickedUp;
      });
    }

    this.mysteryBox?.update(simDt);

    // Update jetpack pickups — grant ability on proximity pickup
    if (this.jetpackDrops.length > 0) {
      const playerPos = this.player.getPosition();
      this.jetpackDrops = this.jetpackDrops.filter((drop) => {
        const result = drop.update(simDt, playerPos);
        if (result === "picked") {
          this.player.grantJetpack(GAME_CONFIG.jetpack.powerupDurationSeconds, drop.variant);
          void this.ensureJetpackCosmeticAttached(drop.variant);
          this.audio.play("maxAmmo");
          this.screenEffects.triggerMaxAmmoNotify();
        }
        return result === null;
      });
    }

    if (this.worldDrops.length > 0) {
      const playerPos = this.player.getPosition();
      this.worldDrops = this.worldDrops.filter((drop) => {
        if (!drop.getAlive()) {
          return false;
        }
        const r = drop.update(simDt, playerPos);
        if (r === "picked") {
          this.stash.addAmmo(drop.payload.caliber, drop.payload.amount);
          this.audio.play("uiClick");
        }
        return drop.getAlive();
      });
    }

    this.applyOpenWorldTerrainCling(simDt);

    this.waveDirector.update(
      simDt,
      this.zombies.length,
      this.player.getPosition()
    );

    const update = this.interactions.pickTarget(
      this.player.getCameraPosition(),
      this.player.getCameraForward(),
      this.points,
      this.inventory
    );
    this.hud.setInteractPrompt(update.prompt, this.input.getInteractKeyLabel());

    const healthRatio = this.player.getHealthRatio();
    this.screenEffects.setHealthRatio(healthRatio);
    this.audio.setHeartbeatRate(
      healthRatio < 0.45 ? 1 - healthRatio / 0.45 : 0,
      healthRatio
    );

    if (this.player.health <= 0) {
      this.endRun();
    }

    this.syncAdsHud();
    this.renderHud();
  }

  // --- Open world: GLB terrain height — MAP_CONFIG.importVisual (cling + HUD “Drop to ground”) ---

  /**
   * Open world: keep feet on the GLB while moving (XZ-only locomotion) using CPU ray tests.
   */
  private applyOpenWorldTerrainCling(dt: number): void {
    if (this.settings.get().flyMode || this.settings.get().noclip) {
      return;
    }
    if (this.player.suppressesTerrainCling()) {
      return;
    }
    if (
      this.phase !== "playing" ||
      !MAP_CONFIG.importVisual.replacesArena ||
      !MAP_CONFIG.importVisual.snapFeetToGround
    ) {
      return;
    }

    const up = MAP_CONFIG.importVisual.groundSnapClearance;
    const maxStep = MAP_CONFIG.importVisual.terrainFollowMaxStepY;

    this.terrainFollowTimer += dt;
    if (
      !this.playerGravityDropActive &&
      this.terrainFollowTimer >= MAP_CONFIG.importVisual.terrainFollowIntervalSeconds
    ) {
      this.terrainFollowTimer = 0;
      const pos = this.player.root.getPosition();
      const y = this.map.sampleImportedTerrainYNearFeet(pos.x, pos.z, pos.y);
      if (y != null && this.phase === "playing") {
        const targetFeetY = y + up;
        const cur = this.player.root.getPosition();
        let newY = targetFeetY;
        if (newY > cur.y + maxStep) newY = cur.y + maxStep;
        if (newY < cur.y - maxStep) newY = cur.y - maxStep;
        this.player.root.setPosition(cur.x, newY, cur.z);
      }
    }

    this.zombieTerrainTimer += dt;
    if (
      this.zombieTerrainTimer >= MAP_CONFIG.importVisual.zombieTerrainResnapIntervalSeconds &&
      this.zombies.length > 0
    ) {
      this.zombieTerrainTimer = 0;
      const alive = this.zombies.filter((z) => z.alive);
      if (alive.length > 0) {
        const zombie = alive[this.zombieTerrainCursor % alive.length]!;
        this.zombieTerrainCursor++;
        const p = zombie.getPosition();
        const yz = this.map.sampleImportedTerrainYNearFeet(p.x, p.z, p.y);
        if (yz != null && this.phase === "playing" && zombie.alive) {
          const targetFeetY = yz + up;
          const cur = zombie.getPosition();
          let newY = targetFeetY;
          const zStep = GAME_CONFIG.zombie.terrainSnapMaxStepY;
          if (newY > cur.y + zStep) newY = cur.y + zStep;
          if (newY < cur.y - zStep) newY = cur.y - zStep;
          zombie.root.setPosition(cur.x, newY, cur.z);
        }
      }
    }
  }

  /**
   * HUD / dev: sample terrain under current XZ and accelerate downward until feet reach that height.
   */
  private beginPlayerGravityDrop(): void {
    if (this.phase !== "playing") return;
    if (this.settings.get().flyMode || this.settings.get().noclip) return;
    if (!MAP_CONFIG.importVisual.replacesArena || !MAP_CONFIG.importVisual.snapFeetToGround) return;
    if (this.playerGravityDropActive) return;

    const p = this.player.root.getPosition();
    const y = this.map.sampleImportedTerrainYNearFeet(p.x, p.z, p.y);
    if (y == null || this.phase !== "playing") return;
    const targetFeetY = y + MAP_CONFIG.importVisual.groundSnapClearance;
    const here = this.player.root.getPosition();
    if (here.y <= targetFeetY + 0.04) {
      this.player.root.setPosition(here.x, targetFeetY, here.z);
      return;
    }
    this.playerGravityDropTargetY = targetFeetY;
    this.playerGravityDropVelocity = 0;
    this.playerGravityDropActive = true;
    this.renderHud();
  }

  private applyPlayerGravityDrop(dt: number): void {
    if (this.settings.get().flyMode || this.settings.get().noclip) {
      this.playerGravityDropActive = false;
      this.playerGravityDropTargetY = null;
      this.playerGravityDropVelocity = 0;
      return;
    }

    if (!this.playerGravityDropActive || this.playerGravityDropTargetY == null) return;

    const p = this.player.root.getPosition();
    const target = this.playerGravityDropTargetY;
    if (p.y <= target + 0.04) {
      this.player.root.setPosition(p.x, target, p.z);
      this.playerGravityDropActive = false;
      this.playerGravityDropTargetY = null;
      this.playerGravityDropVelocity = 0;
      this.renderHud();
      return;
    }

    this.playerGravityDropVelocity += MAP_CONFIG.importVisual.gravityDropAcceleration * dt;
    const step = this.playerGravityDropVelocity * dt;
    const ny = Math.max(target, p.y - step);
    this.player.root.setPosition(p.x, ny, p.z);
  }

  // --- Arena: wall buys, doors (E), weapon swap — idle when replacesArena ---

  private attemptInteraction(): void {
    if (this.phase !== "playing") return;
    // `pickTarget` runs at end of frame; E/F can fire between frames — refresh target so we don't
    // interact with a stale wall-buy / door while looking at the dev skip cube.
    this.interactions.pickTarget(
      this.player.getCameraPosition(),
      this.player.getCameraForward(),
      this.points,
      this.inventory
    );
    const result = this.interactions.trigger(this.points, this.inventory);
    if (!result) return;

    if (!result.success) {
      if (result.type === "rejected") {
        this.audio.play("rejected");
      }
      return;
    }

    this.points -= result.pointsSpent;

    switch (result.type) {
      case "bought":
        this.audio.play("weaponBuy");
        this.player.notifyWeaponInventoryChanged();
        break;
      case "refilled":
        this.audio.play("weaponRefill");
        break;
      case "opened":
        this.audio.play("doorOpen");
        this.map.triggerFlicker(0.7);
        this.screenEffects.triggerScreenShake(GAME_CONFIG.fx.screenShakeBase);
        this.handleDoorOpened(result);
        break;
      case "mystery":
        // Points already deducted. Show HUD roulette; weapon granted via onWeaponReady callback.
        if (result.weaponBought) {
          this.hud.showMysteryBoxSpin(
            MYSTERY_BOX_POOL_NAMES,
            WEAPON_DEFINITIONS[result.weaponBought].name,
            3500
          );
        }
        this.audio.play("weaponBuy");
        this.map.triggerFlicker(0.5);
        break;
      case "packPunch":
        this.audio.play("weaponBuy");
        this.map.triggerFlicker(0.55);
        this.screenEffects.triggerScreenShake(GAME_CONFIG.fx.screenShakeBase * 0.65);
        this.player.notifyWeaponInventoryChanged();
        break;
      case "devRoundSkip":
        for (const z of this.zombies) {
          z.root.destroy();
        }
        this.zombies = [];
        this.waveDirector.jumpToWaveStart(
          result.devSkipToWave ?? GAME_CONFIG.devRoundSkipper.targetWave
        );
        this.map.triggerFlicker(0.75);
        this.screenEffects.triggerScreenShake(GAME_CONFIG.fx.screenShakeBase);
        break;
    }

    this.renderHud();
  }

  private handleDoorOpened(_result: { type: string }): void {
    const target = this.interactions.getCurrentTarget();
    if (!target) {
      this.activateNextZone();
      return;
    }
    const index = this.doors.findIndex((d) => d.id === target.id);
    if (index >= 0 && index < ZONE_FOR_DOOR_INDEX.length) {
      this.map.openZone(ZONE_FOR_DOOR_INDEX[index]);
    }
    this.interactions.unregister(target.id);
  }

  private activateNextZone(): void {
    for (const zone of ZONE_FOR_DOOR_INDEX) {
      if (!this.map.isZoneOpen(zone)) {
        this.map.openZone(zone);
        return;
      }
    }
  }

  private attemptWeaponCycle(dir: number): void {
    if (this.phase !== "playing") return;
    if (this.player.tryWeaponCycle(dir)) {
      this.audio.play("weaponSwap");
    }
  }

  private pickWeaponWheelSlot(slot: number): void {
    if (this.phase !== "playing") return;
    if (!this.input.isWeaponWheelOpen()) return;
    const n = this.inventory.getOwnedCount();
    if (slot < 0 || slot >= n) return;
    this.weaponWheelHighlight = slot;
  }

  private applyCompanionKillRewards(impactPoint: pc.Vec3, headshot: boolean): void {
    this.stats.kills += 1;
    const points = headshot ? GAME_CONFIG.pointsPerHeadshot : GAME_CONFIG.pointsPerKill;
    this.points += points;
    if (headshot) {
      this.stats.headshots += 1;
      this.audio.play("headshot");
    } else {
      this.audio.play("kill");
    }
    this.screenEffects.triggerKillPopup(points, headshot);
    this.effects.spawnDebris(impactPoint, this.settings.get().bloodFx);
    this.screenEffects.triggerScreenShake(GAME_CONFIG.fx.screenShakeKill * 0.55);
    const dropPos = impactPoint.clone();
    const maxAmmoChance = GAME_CONFIG.pickups.maxAmmoDropChanceOnKill;
    if (maxAmmoChance > 0 && Math.random() < maxAmmoChance) {
      this.maxAmmoDrops.push(new MaxAmmoDrop(this.app.root, dropPos));
    }
    if (
      Math.random() < GAME_CONFIG.jetpack.dropChanceOnKill &&
      this.jetpackDrops.length < GAME_CONFIG.jetpack.maxActiveDrops
    ) {
      this.spawnJetpackDrop(dropPos);
    }
  }

  private handleAllyShot(out: ReturnType<AiAlly["tryEngage"]>): void {
    if (!out.fired || !out.hit || !out.zombie) {
      return;
    }

    this.stats.shotsFired += 1;
    this.stats.shotsHit += 1;
    this.audio.play("smgShot");
    this.effects.spawnMuzzleFlash(out.muzzlePos, out.aimDir);
    this.effects.spawnTracer(out.muzzlePos, out.impactPoint);
    this.screenEffects.triggerScreenShake(GAME_CONFIG.fx.screenShakeBase * 0.35);
    this.screenEffects.triggerHitMarker();
    this.effects.spawnImpactSpark(out.impactPoint);
    this.effects.spawnBlood(out.impactPoint, this.settings.get().bloodFx);
    this.audio.play("impact");

    if (out.killed) {
      this.applyCompanionKillRewards(out.impactPoint, out.headshot);
    } else {
      this.points += GAME_CONFIG.pointsPerHit;
    }
  }

  private handlePetCombat(tick: ReturnType<NineTailsPet["tickCombat"]>): void {
    if (tick.bomb.fired && tick.bomb.hits.length > 0) {
      this.effects.spawnKuramaChakraNova(
        tick.bomb.impactPoint,
        GAME_CONFIG.nineTailsPet.tailedBeastRadius
      );
      this.audio.play("rifleShot");
      this.screenEffects.triggerScreenShake(GAME_CONFIG.fx.screenShakeBase * 0.95);
      this.screenEffects.triggerHitMarker();
      for (const h of tick.bomb.hits) {
        this.stats.shotsHit += 1;
        this.effects.spawnImpactSpark(h.impactPoint);
        this.effects.spawnBlood(h.impactPoint, this.settings.get().bloodFx);
        if (h.killed) {
          this.applyCompanionKillRewards(h.impactPoint, false);
        } else {
          this.points += GAME_CONFIG.pointsPerHit;
        }
      }
    }

    const ff = tick.foxFire;
    if (!ff.fired || !ff.hit) {
      return;
    }

    this.stats.shotsFired += 1;
    this.stats.shotsHit += 1;
    this.audio.play("smgShot");
    this.effects.spawnFoxFireFlash(ff.muzzlePos, ff.aimDir);
    this.effects.spawnFoxFireTracer(ff.muzzlePos, ff.impactPoint);
    this.screenEffects.triggerScreenShake(GAME_CONFIG.fx.screenShakeBase * 0.32);
    this.screenEffects.triggerHitMarker();
    this.effects.spawnImpactSpark(ff.impactPoint);
    this.effects.spawnBlood(ff.impactPoint, this.settings.get().bloodFx);
    this.audio.play("impact");

    if (ff.killed) {
      this.applyCompanionKillRewards(ff.impactPoint, false);
    } else {
      this.points += GAME_CONFIG.pointsPerHit;
    }
  }

  /** Spawn a jetpack pickup at `pos`, alternating Valkyrie / Marauder variants. */
  private spawnJetpackDrop(pos: pc.Vec3): void {
    const variant = this.jetpackVariantCursor;
    this.jetpackVariantCursor = variant === "valkyrie" ? "marauder" : "valkyrie";
    const drop = new JetpackPickup(
      this.app.root,
      pos,
      variant,
      GAME_CONFIG.jetpack.lifetimeSeconds
    );
    this.jetpackDrops.push(drop);
  }

  // --- Hitscan feedback: tracers, impact FX, score, kill banner ---

  private handleShot(shot: ReturnType<PlayerController["update"]>): void {
    if (!shot) return;

    if (shot.empty) {
      this.audio.play("empty");
      return;
    }

    const weapon = this.player.getCurrentWeapon();
    const def = weapon.definition;

    if (shot.fired) {
      this.stats.shotsFired += 1;
      this.audio.play(def.audio.shot);
      this.effects.spawnMuzzleFlash(this.player.getCameraPosition(), shot.direction);
      this.effects.spawnTracer(this.player.getCameraPosition(), shot.impactPoint);
      this.screenEffects.triggerScreenShake(GAME_CONFIG.fx.screenShakeBase + def.recoilKick * 4);
    }

    if (shot.fired && shot.teddyBearIndices.length > 0) {
      let allDestroyed = false;
      for (const idx of shot.teddyBearIndices) {
        const r = this.teddyBearEasterEgg?.applyHit(idx);
        if (r?.newHit) {
          this.stats.shotsHit += 1;
          this.screenEffects.triggerHitMarker();
          this.effects.spawnImpactSpark(shot.impactPoint);
          this.audio.playTeddyBearHit();
        }
        if (r?.allDestroyed) {
          allDestroyed = true;
        }
      }
      if (allDestroyed) {
        this.audio.playTeddyEasterRewardSong();
      }
    }

    if (shot.hit && shot.zombie) {
      this.stats.shotsHit += 1;
      this.screenEffects.triggerHitMarker();
      this.effects.spawnImpactSpark(shot.impactPoint);
      this.effects.spawnBlood(shot.impactPoint, this.settings.get().bloodFx);
      this.audio.play("impact");

      if (shot.killed) {
        this.stats.kills += 1;
        const points = shot.headshot
          ? GAME_CONFIG.pointsPerHeadshot
          : GAME_CONFIG.pointsPerKill;
        this.points += points;
        if (shot.headshot) {
          this.stats.headshots += 1;
          this.audio.play("headshot");
        } else {
          this.audio.play("kill");
        }
        this.screenEffects.triggerKillPopup(points, shot.headshot);
        this.effects.spawnDebris(shot.impactPoint, this.settings.get().bloodFx);
        this.screenEffects.triggerScreenShake(GAME_CONFIG.fx.screenShakeKill);

        // Bloodlust: restore 8 HP on kill
        if (this.activeLoadout?.specialAbility === "bloodlust") {
          this.player.health = Math.min(
            this.player.health + 8,
            GAME_CONFIG.player.maxHealth
          );
        }

        // Vital Harvest mod: restore HP on kill
        if (this.player.vitalHarvestHp > 0) {
          this.player.health = Math.min(
            this.player.health + this.player.vitalHarvestHp,
            GAME_CONFIG.player.maxHealth
          );
        }

        // ── Career weapon kill tracking ────────────────────────────────────
        const wid = this.inventory.getCurrent().definition.id;
        this.runWeaponKills[wid] = (this.runWeaponKills[wid] ?? 0) + 1;

        // ── In-run XP + level-up detection ────────────────────────────────
        const killXp = shot.headshot ? 45 : 30;
        this.runXpGained += killXp;
        const simulatedLevel = getLevelForXp(this.account.totalXp + this.runXpGained);
        if (simulatedLevel > this.inRunLevel) {
          this.inRunLevel = simulatedLevel;
          const playerPos = this.player.getPosition().clone();
          this.spawnLevelUpFx(playerPos, simulatedLevel);
        }

        // Max Ammo drop — base chance + Scavenger bonus
        const scavengerBonus = this.activeLoadout?.mod === "scavenger" ? 0.08 : 0;
        const maxAmmoChance = GAME_CONFIG.pickups.maxAmmoDropChanceOnKill + scavengerBonus;
        if (maxAmmoChance > 0 && Math.random() < maxAmmoChance) {
          this.maxAmmoDrops.push(new MaxAmmoDrop(this.app.root, shot.zombie.getPosition()));
        }
        // Independent 7% chance: drop a jetpack pickup (capped to prevent clutter)
        if (
          Math.random() < GAME_CONFIG.jetpack.dropChanceOnKill &&
          this.jetpackDrops.length < GAME_CONFIG.jetpack.maxActiveDrops
        ) {
          this.spawnJetpackDrop(shot.zombie.getPosition());
        }
      } else {
        this.points += GAME_CONFIG.pointsPerHit;
      }
    }
  }

  // ── Level-up 3-D FX ──────────────────────────────────────────────────────

  /**
   * Spawn the Diablo-style level-up effect:
   *  • Vertical light pillar (additive blended cylinder, ~35m tall)
   *  • Expanding ground ring (flat disc, scales outward 0 → 12m)
   *  • Enemy shockwave damage within 8m
   *  • Screen flash + cinematic banner (via ScreenEffects)
   */
  private spawnLevelUpFx(pos: pc.Vec3, level: number): void {
    const app = this.app;

    // ── 1. Light pillar ──────────────────────────────────────────────────
    const pillar = new pc.Entity("lvlup-pillar");
    pillar.addComponent("render", { type: "cylinder" });
    pillar.setPosition(pos.x, pos.y + 17.5, pos.z); // centered vertically
    pillar.setLocalScale(0.9, 35, 0.9);

    const pillarMat = new pc.StandardMaterial();
    pillarMat.emissive = new pc.Color(1.0, 0.85, 0.3);
    pillarMat.emissiveIntensity = 6;
    pillarMat.opacity = 0;
    pillarMat.blendType = pc.BLEND_ADDITIVE;
    pillarMat.depthWrite = false;
    pillarMat.cull = pc.CULLFACE_NONE;
    pillarMat.update();
    if (pillar.render && pillar.render.meshInstances.length > 0) {
      pillar.render.meshInstances[0].material = pillarMat;
    }
    app.root.addChild(pillar);

    // ── 2. Ground ring (flat cylinder expanding outward) ─────────────────
    const ring = new pc.Entity("lvlup-ring");
    ring.addComponent("render", { type: "cylinder" });
    ring.setPosition(pos.x, pos.y + 0.05, pos.z);
    ring.setLocalScale(0.1, 0.08, 0.1);

    const ringMat = new pc.StandardMaterial();
    ringMat.emissive = new pc.Color(1.0, 0.7, 0.2);
    ringMat.emissiveIntensity = 5;
    ringMat.opacity = 0.9;
    ringMat.blendType = pc.BLEND_ADDITIVE;
    ringMat.depthWrite = false;
    ringMat.cull = pc.CULLFACE_NONE;
    ringMat.update();
    if (ring.render && ring.render.meshInstances.length > 0) {
      ring.render.meshInstances[0].material = ringMat;
    }
    app.root.addChild(ring);

    // ── 3. Enemy shockwave damage ─────────────────────────────────────────
    const SHOCKWAVE_INNER = 5;   // m — lethal zone
    const SHOCKWAVE_OUTER = 12;  // m — outer damage zone
    const SHOCKWAVE_DMG_INNER = 120;
    const SHOCKWAVE_DMG_OUTER = 55;

    for (const zombie of this.zombies) {
      const zPos = zombie.getPosition();
      const dist = pos.distance(zPos);
      if (dist <= SHOCKWAVE_INNER) {
        zombie.applyDamage(SHOCKWAVE_DMG_INNER);
      } else if (dist <= SHOCKWAVE_OUTER) {
        const t = 1 - (dist - SHOCKWAVE_INNER) / (SHOCKWAVE_OUTER - SHOCKWAVE_INNER);
        zombie.applyDamage(SHOCKWAVE_DMG_OUTER * t);
      }
    }

    // ── 4. Screen effects ─────────────────────────────────────────────────
    this.screenEffects.triggerLevelUp(level);

    this.levelUpFx.push({ pillar, ring, pillarMat, ringMat, age: 0, duration: 2.8 });
  }

  /** Animate all active level-up effects each frame. */
  private tickLevelUpFx(dt: number): void {
    for (let i = this.levelUpFx.length - 1; i >= 0; i--) {
      const fx = this.levelUpFx[i];
      fx.age += dt;
      const t = Math.min(1, fx.age / fx.duration); // 0 → 1

      // ── Pillar: fade in fast (t=0→0.12), hold (t=0.12→0.55), fade out slow
      let pillarOpacity: number;
      if (t < 0.12) {
        pillarOpacity = t / 0.12;
      } else if (t < 0.55) {
        pillarOpacity = 1;
      } else {
        pillarOpacity = 1 - (t - 0.55) / 0.45;
      }
      fx.pillarMat.opacity = Math.max(0, pillarOpacity * 0.85);
      fx.pillarMat.update();

      // ── Ring: expand 0 → 12m radius, fade out
      const ringRadius = t * 12;
      fx.ring.setLocalScale(ringRadius, 0.08, ringRadius);
      fx.ringMat.opacity = Math.max(0, (1 - t) * 0.8);
      fx.ringMat.update();

      // ── Dispose when finished
      if (t >= 1) {
        fx.pillar.destroy();
        fx.ring.destroy();
        this.levelUpFx.splice(i, 1);
      }
    }
  }

  /** Remove all active level-up visual entities from the scene. */
  private clearLevelUpFx(): void {
    for (const fx of this.levelUpFx) {
      fx.pillar.destroy();
      fx.ring.destroy();
    }
    this.levelUpFx = [];
  }

  // --- Lethal system ---

  private applyLethalFromLoadout(loadout: LoadoutData | null): void {
    this.lethalCharges = 0;
    this.disposeC4();
    this.disposeSmines();
    this.disposePendingLethalFlyers();

    if (!loadout?.lethal) return;
    const params = LETHAL_PARAMS[loadout.lethal];
    this.lethalCharges = GAME_CONFIG.dev.unlimitedLethals ? 999 : params.charges;
  }

  /** Decrements lethal charge unless dev unlimited mode is on. */
  private consumeLethalChargeIfLimited(): void {
    if (GAME_CONFIG.dev.unlimitedLethals) return;
    this.lethalCharges = Math.max(0, this.lethalCharges - 1);
  }

  /** Called when the player presses G. */
  private useLethal(): void {
    const loadout = this.activeLoadout;
    if (!loadout?.lethal) return;

    const params = LETHAL_PARAMS[loadout.lethal];

    // C4 (`satchel` id): tap G to throw (up to C4_MAX_ACTIVE live). Hold G to detonate all.
    if (loadout.lethal === "satchel") {
      const live = this.c4Flights.length + this.c4Armed.length;
      if (live >= C4_MAX_ACTIVE) return;
      if (!GAME_CONFIG.dev.unlimitedLethals && this.lethalCharges <= 0) return;

      const phys = LETHAL_PHYSICS;
      const origin = this.player.getCameraPosition();
      const forward = this.player.getCameraForward();
      const lobDir = forward
        .clone()
        .add(new pc.Vec3(0, phys.arcUpBias * 0.62, 0))
        .normalize();
      const spawn = origin.clone().add(lobDir.clone().mulScalar(phys.spawnForward));
      spawn.y -= phys.spawnDown;
      const velocity = lobDir.clone().mulScalar(params.throwSpeed);

      const visual = this.createC4BrickEntity();
      visual.setPosition(spawn);
      const yaw = this.player.root.getEulerAngles().y;
      visual.setEulerAngles(0, yaw, 0);

      this.c4Flights.push({ position: spawn.clone(), velocity, visual });
      this.consumeLethalChargeIfLimited();
      this.audio.play("uiClick");
      this.renderHud();
      return;
    }

    // S-MINE 44: place on ground; arms ~3s; enemy proximity pops it up then air burst + shrapnel.
    if (loadout.lethal === "smine44") {
      if (this.activeSmines.length >= SMINE_MAX_ACTIVE) return;
      if (!GAME_CONFIG.dev.unlimitedLethals && this.lethalCharges <= 0) return;
      this.placeSmine();
      this.consumeLethalChargeIfLimited();
      this.audio.play("uiClick");
      this.renderHud();
      return;
    }

    if (!GAME_CONFIG.dev.unlimitedLethals && this.lethalCharges <= 0) return;
    this.consumeLethalChargeIfLimited();

    if (params.remote) {
      const throwPos = this.getLethalThrowPoint(12);
      this.triggerLethalExplosion(throwPos, params.blastRadius, {
        damageMultiplier: params.explosionDamageMultiplier,
        megaExplosion: params.megaExplosion
      });
    } else if (params.fuseSeconds > 0) {
      const phys = LETHAL_PHYSICS;
      const origin = this.player.getCameraPosition();
      const forward = this.player.getCameraForward();
      const lobDir = forward
        .clone()
        .add(new pc.Vec3(0, phys.arcUpBias, 0))
        .normalize();
      const spawn = origin.clone().add(lobDir.clone().mulScalar(phys.spawnForward));
      spawn.y -= phys.spawnDown;
      const colliderR = params.stickyColliderRadius ?? LETHAL_PHYSICS.colliderRadius;
      const velocity = lobDir.clone().mulScalar(params.throwSpeed);

      const { entity, glowMat, glowBase } = this.createFlyingLethalVisual(loadout.lethal, colliderR);
      entity.setPosition(spawn);

      const baseScale = colliderR * 2;
      this.pendingLethalDetonations.push({
        lethalKind: loadout.lethal,
        position: spawn.clone(),
        velocity,
        fuseRemaining: params.fuseSeconds,
        fuseTotal: params.fuseSeconds,
        blastRadius: params.blastRadius,
        colliderRadius: colliderR,
        visual: entity,
        glowMat,
        glowBase,
        visualBaseScale: baseScale,
        preheatAcc: 0,
        stuck: false,
        stuckZombie: null,
        stuckUseHead: false
      });
      this.audio.play("uiClick");
    } else {
      const throwPos = this.getLethalThrowPoint(12);
      this.triggerLethalExplosion(throwPos, params.blastRadius, {
        damageMultiplier: params.explosionDamageMultiplier,
        megaExplosion: params.megaExplosion
      });
    }

    this.renderHud();
  }

  /** Returns world Y of ground under a flying lethal (arena floor or imported terrain). */
  private getLethalGroundY(wx: number, wz: number, referenceY: number): number {
    if (MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround) {
      const y = this.map.sampleImportedTerrainYNearFeet(wx, wz, referenceY);
      if (y != null) {
        return y + MAP_CONFIG.importVisual.groundSnapClearance;
      }
    }
    return 0;
  }

  private createFlyingLethalVisual(
    lethalId: LethalId,
    colliderRadius: number
  ): {
    entity: pc.Entity;
    glowMat: pc.StandardMaterial;
    glowBase: pc.Color;
  } {
    const mat = new pc.StandardMaterial();
    let glowBase: pc.Color;
    if (lethalId === "frag") {
      mat.diffuse = new pc.Color(0.04, 0.22, 0.06);
      glowBase = new pc.Color(0.12, 0.92, 0.22);
    } else if (lethalId === "n74st") {
      mat.diffuse = new pc.Color(0.4, 0.14, 0.02);
      glowBase = new pc.Color(1.0, 0.38, 0.04);
    } else {
      mat.diffuse = new pc.Color(0.16, 0.16, 0.18);
      glowBase = new pc.Color(0.45, 0.42, 0.38);
    }
    mat.emissive = glowBase.clone();
    mat.update();

    const ent = new pc.Entity(`lethal-${lethalId}-inflight`);
    ent.addComponent("render", { type: "sphere", material: mat });
    const d = colliderRadius * 2;
    ent.setLocalScale(d, d, d);
    this.app.root.addChild(ent);
    return { entity: ent, glowMat: mat, glowBase };
  }

  private disposeC4(): void {
    for (const f of this.c4Flights) {
      f.visual.destroy();
    }
    this.c4Flights = [];
    for (const a of this.c4Armed) {
      a.visual.destroy();
    }
    this.c4Armed = [];
    this.c4HoldDetonateSeconds = 0;
    this.c4HoldDetonateFired = false;
  }

  private disposeSmines(): void {
    for (const m of this.activeSmines) {
      m.visual.destroy();
    }
    this.activeSmines = [];
    for (const s of this.smineShrapnel) {
      s.visual.destroy();
    }
    this.smineShrapnel = [];
  }

  private getC4LiveCount(): number {
    return this.c4Flights.length + this.c4Armed.length;
  }

  /** Destroy every C4 visual and trigger one mega blast per charge position. */
  private detonateAllC4(): void {
    if (this.activeLoadout?.lethal !== "satchel") return;
    const nLive = this.getC4LiveCount();
    if (nLive === 0) return;

    const params = LETHAL_PARAMS.satchel;
    const positions: pc.Vec3[] = [];
    for (const f of this.c4Flights) {
      positions.push(f.position.clone());
      f.visual.destroy();
    }
    this.c4Flights = [];
    for (const a of this.c4Armed) {
      positions.push(a.position.clone());
      a.visual.destroy();
    }
    this.c4Armed = [];

    positions.forEach((p, i) => {
      this.triggerLethalExplosion(p, params.blastRadius, {
        damageMultiplier: params.explosionDamageMultiplier,
        megaExplosion: params.megaExplosion,
        skipSfx: true,
        softenPresentation: i > 0
      });
    });
    this.audio.play("kill");
    this.c4HoldDetonateSeconds = 0;
    this.renderHud();
  }

  private tickC4HoldDetonate(dt: number): void {
    if (this.phase !== "playing" || this.activeLoadout?.lethal !== "satchel") {
      this.c4HoldDetonateSeconds = 0;
      this.c4HoldDetonateFired = false;
      return;
    }
    if (!this.input.isLethalHeld()) {
      this.c4HoldDetonateSeconds = 0;
      this.c4HoldDetonateFired = false;
      return;
    }
    if (this.getC4LiveCount() === 0) {
      this.c4HoldDetonateSeconds = 0;
      return;
    }
    this.c4HoldDetonateSeconds += dt;
    if (this.c4HoldDetonateSeconds >= C4_DETONATE_HOLD_SECONDS && !this.c4HoldDetonateFired) {
      this.c4HoldDetonateFired = true;
      this.detonateAllC4();
    }
  }

  /** C4 never arms on player or zombie flesh — only world/prop geometry and ground. */
  private c4OverlapsExcludedActors(pos: pc.Vec3, c4R: number): boolean {
    const pfeet = this.player.getPosition();
    const pRad = 0.48;
    const dx = pos.x - pfeet.x;
    const dz = pos.z - pfeet.z;
    if (dx * dx + dz * dz < (pRad + c4R) ** 2 && pos.y >= pfeet.y - 0.25 && pos.y <= pfeet.y + 2.3) {
      return true;
    }
    for (const z of this.zombies) {
      if (!z.alive) continue;
      if (this.c4OverlapsZombieCapsule(pos, c4R, z)) return true;
    }
    return false;
  }

  private c4OverlapsZombieCapsule(pos: pc.Vec3, c4R: number, z: Zombie): boolean {
    const headC = z.getHeadTarget();
    const headR = z.getHeadRadius();
    if (pos.distance(headC) < headR + c4R) return true;

    const bodyC = z.getAimTarget();
    const bodyR = z.getHitRadius() + 0.32;
    return pos.distance(bodyC) < bodyR + c4R;
  }

  private placeSmine(): void {
    const p = this.getSminePlacePoint();
    const params = LETHAL_PARAMS.smine44;
    const armT = params.armSeconds ?? 3;
    const { visual, bodyMat, baseEm } = this.createSmineDeployedVisual();
    visual.setPosition(p.x, p.y, p.z);
    this.activeSmines.push({
      kind: "arming",
      x: p.x,
      z: p.z,
      groundY: p.y,
      t: armT,
      armDuration: armT,
      pulseAcc: 0,
      visual,
      bodyMat,
      baseEm
    });
  }

  private getSminePlacePoint(): pc.Vec3 {
    const p = this.player.getPosition();
    const fwd = this.player.root.forward.clone();
    fwd.y = 0;
    if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, 1);
    else fwd.normalize();
    const x = p.x + fwd.x * 0.95;
    const z = p.z + fwd.z * 0.95;
    const gy = this.getLethalGroundY(x, z, p.y);
    return new pc.Vec3(x, gy + 0.05, z);
  }

  private createSmineDeployedVisual(): {
    visual: pc.Entity;
    bodyMat: pc.StandardMaterial;
    baseEm: pc.Color;
  } {
    const root = new pc.Entity("smine44-mine");
    const bodyMat = new pc.StandardMaterial();
    bodyMat.diffuse = new pc.Color(0.14, 0.2, 0.08);
    bodyMat.specular = new pc.Color(0.04, 0.05, 0.03);
    const baseEm = new pc.Color(0.05, 0.1, 0.02);
    bodyMat.emissive = baseEm.clone();
    bodyMat.update();
    const cyl = new pc.Entity("smine-body");
    cyl.addComponent("render", { type: "cylinder", material: bodyMat });
    cyl.setLocalScale(0.36, 0.11, 0.36);
    root.addChild(cyl);

    const pin = new pc.StandardMaterial();
    pin.diffuse = new pc.Color(0.26, 0.22, 0.08);
    pin.emissive = new pc.Color(0.08, 0.06, 0.02);
    pin.update();
    const cap = new pc.Entity("smine-cap");
    cap.addComponent("render", { type: "cylinder", material: pin });
    cap.setLocalScale(0.14, 0.06, 0.14);
    cap.setLocalPosition(0, 0.085, 0);
    root.addChild(cap);

    this.app.root.addChild(root);
    return { visual: root, bodyMat, baseEm };
  }

  private tickSmines(dt: number): void {
    if (this.phase !== "playing" || this.activeSmines.length === 0) return;

    const params = LETHAL_PARAMS.smine44;
    const trig = params.triggerRadius ?? 2.45;

    for (let i = this.activeSmines.length - 1; i >= 0; i--) {
      const m = this.activeSmines[i]!;

      if (m.kind === "arming") {
        m.t -= dt;
        const armDur = m.armDuration;
        const u = Math.max(0, 1 - m.t / armDur);
        m.pulseAcc += dt;
        if (m.pulseAcc >= 0.48) {
          m.pulseAcc = 0;
          this.effects.spawnGrenadeArmingPulse(
            new pc.Vec3(m.x, m.groundY + 0.1, m.z),
            0.35 + u * 0.55
          );
        }
        m.bodyMat.emissive.set(
          Math.min(2.2, m.baseEm.r + 1.35 * u),
          Math.min(2.1, m.baseEm.g + 0.45 * u),
          Math.min(0.35, m.baseEm.b + 0.08 * u)
        );
        m.bodyMat.update();
        const ang = m.visual.getEulerAngles();
        m.visual.setEulerAngles(0, ang.y + dt * 125, 0);

        if (m.t <= 0) {
          m.bodyMat.emissive.set(m.baseEm.r, m.baseEm.g, m.baseEm.b);
          m.bodyMat.update();
          this.activeSmines[i] = {
            kind: "armed",
            x: m.x,
            z: m.z,
            groundY: m.groundY,
            visual: m.visual,
            triggerR: trig
          };
        }
        continue;
      }

      if (m.kind === "armed") {
        let close = false;
        for (const z of this.zombies) {
          if (!z.alive) continue;
          const zp = z.getPosition();
          if (Math.hypot(zp.x - m.x, zp.z - m.z) < m.triggerR) {
            close = true;
            break;
          }
        }

        if (close) {
          const riseDur = params.popDuration ?? 0.38;
          const popH = params.popHeight ?? 2.05;
          this.activeSmines[i] = {
            kind: "rising",
            x: m.x,
            z: m.z,
            groundY: m.groundY,
            riseT: 0,
            riseDur,
            popH,
            visual: m.visual
          };
        }
        continue;
      }

      if (m.kind === "rising") {
        m.riseT += dt;
        const p = Math.min(1, m.riseT / m.riseDur);
        const h = m.popH * Math.sin(p * Math.PI * 0.5);
        m.visual.setPosition(m.x, m.groundY + h, m.z);
        const ang = m.visual.getEulerAngles();
        m.visual.setEulerAngles(ang.x + dt * 520, ang.y + dt * 240, ang.z + dt * 180);

        if (m.riseT >= m.riseDur) {
          this.fireSmineBouncingBetty(m);
          this.activeSmines.splice(i, 1);
        }
      }
    }
  }

  private fireSmineBouncingBetty(m: Extract<ActiveSmine, { kind: "rising" }>): void {
    const params = LETHAL_PARAMS.smine44;
    const burst = new pc.Vec3(m.x, m.groundY + m.popH, m.z);
    m.visual.destroy();

    this.triggerLethalExplosion(burst, params.blastRadius, {
      damageMultiplier: params.explosionDamageMultiplier ?? 1,
      megaExplosion: false,
      softenPresentation: true,
      skipSfx: true
    });

    const n = params.shrapnelCount ?? 16;
    const spd = params.shrapnelSpeed ?? 24;
    const life = params.shrapnelLife ?? 0.42;
    const hitR = params.shrapnelHitRadius ?? 0.42;
    const dmg = params.shrapnelDamage ?? 62;

    for (let k = 0; k < n; k++) {
      const ang = (k / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.35;
      const pitch = 0.08 + Math.random() * 0.28;
      const c = Math.cos(pitch);
      const vx = Math.cos(ang) * c * spd;
      const vz = Math.sin(ang) * c * spd;
      const vy = Math.sin(pitch) * spd + 2.2;

      const mat = new pc.StandardMaterial();
      mat.diffuse = new pc.Color(0, 0, 0);
      mat.emissive = new pc.Color(2.1, 0.65 + Math.random() * 0.2, 0.08);
      mat.useLighting = false;
      mat.blendType = pc.BLEND_ADDITIVE;
      mat.opacity = 0.88;
      mat.update();
      const ent = new pc.Entity(`smine-shrap-${k}`);
      ent.addComponent("render", { type: "box", material: mat });
      const sc = 0.07 + Math.random() * 0.04;
      ent.setLocalScale(sc, sc * 2.2, sc);
      ent.setPosition(burst);
      this.app.root.addChild(ent);

      this.smineShrapnel.push({
        pos: burst.clone(),
        vel: new pc.Vec3(vx, vy, vz),
        life,
        hitR,
        dmg,
        visual: ent
      });
    }

    this.effects.spawnDebris(burst, true, 14, 1.45);
    this.screenEffects.triggerScreenShake(0.22);
    this.map.triggerFlicker(0.62);
    this.audio.play("kill");
  }

  private tickSmineShrapnel(dt: number): void {
    if (this.phase !== "playing" || this.smineShrapnel.length === 0) return;

    for (let i = this.smineShrapnel.length - 1; i >= 0; i--) {
      const s = this.smineShrapnel[i]!;
      s.life -= dt;
      s.vel.y -= 26 * dt;
      s.pos.x += s.vel.x * dt;
      s.pos.y += s.vel.y * dt;
      s.pos.z += s.vel.z * dt;
      s.visual.setPosition(s.pos);
      const e = s.visual.getLocalEulerAngles();
      s.visual.setLocalEulerAngles(e.x + dt * 720, e.y + dt * 500, e.z + dt * 300);

      let remove = s.life <= 0 || s.pos.y < -0.5;
      if (!remove) {
        for (const z of this.zombies) {
          if (!z.alive) continue;
          if (z.getPosition().distance(s.pos) < 0.48 + s.hitR) {
            const killed = z.applyDamage(s.dmg);
            if (killed) {
              this.stats.kills += 1;
              this.points += GAME_CONFIG.pointsPerKill;
              this.screenEffects.triggerKillPopup(GAME_CONFIG.pointsPerKill, false);
            }
            this.effects.spawnImpactSpark(s.pos.clone());
            remove = true;
            break;
          }
        }
      }

      if (remove) {
        s.visual.destroy();
        this.smineShrapnel.splice(i, 1);
      }
    }
  }

  private disposePendingLethalFlyers(): void {
    for (const d of this.pendingLethalDetonations) {
      d.visual.destroy();
    }
    this.pendingLethalDetonations = [];
  }

  /** Flat brick mesh for C4 (loadout id `satchel`). */
  private createC4BrickEntity(): pc.Entity {
    const root = new pc.Entity("c4-brick");
    const bodyMat = new pc.StandardMaterial();
    bodyMat.diffuse = new pc.Color(0.24, 0.21, 0.19);
    bodyMat.specular = new pc.Color(0.06, 0.06, 0.06);
    bodyMat.update();
    const body = new pc.Entity("c4-body");
    body.addComponent("render", { type: "box", material: bodyMat });
    body.setLocalScale(0.34, 0.09, 0.27);
    root.addChild(body);

    const stripeMat = new pc.StandardMaterial();
    stripeMat.diffuse = new pc.Color(0.52, 0.2, 0.04);
    stripeMat.emissive = new pc.Color(0.12, 0.04, 0.01);
    stripeMat.update();
    const stripe = new pc.Entity("c4-stripe");
    stripe.addComponent("render", { type: "box", material: stripeMat });
    stripe.setLocalScale(0.35, 0.035, 0.09);
    stripe.setLocalPosition(0, 0.02, 0.02);
    root.addChild(stripe);

    this.app.root.addChild(root);
    return root;
  }

  private armC4FromFlightAt(index: number): void {
    const f = this.c4Flights[index]!;
    f.visual.setPosition(f.position);
    this.c4Armed.push({ position: f.position.clone(), visual: f.visual });
    this.c4Flights.splice(index, 1);
  }

  private tickC4Flight(dt: number): void {
    if (this.c4Flights.length === 0) return;

    const phys = LETHAL_PHYSICS;
    const colliderR = 0.11;
    const halfY = 0.045;

    for (let i = this.c4Flights.length - 1; i >= 0; i--) {
      const f = this.c4Flights[i]!;

      f.velocity.y -= phys.gravity * dt;
      f.position.x += f.velocity.x * dt;
      f.position.y += f.velocity.y * dt;
      f.position.z += f.velocity.z * dt;

      if (this.collision.overlapsAnyColliderXZ(f.position.x, f.position.z, colliderR)) {
        this.collision.resolveAgainstAllColliders(f.position, colliderR);
        if (this.c4OverlapsExcludedActors(f.position, colliderR)) {
          f.velocity.mulScalar(-0.32);
          f.position.y += 0.015;
          f.visual.setPosition(f.position);
          continue;
        }
        f.velocity.set(0, 0, 0);
        this.armC4FromFlightAt(i);
        continue;
      }

      const groundY = this.getLethalGroundY(f.position.x, f.position.z, f.position.y);
      const restY = groundY + halfY;
      if (f.position.y < restY) {
        f.position.y = restY;
        if (this.c4OverlapsExcludedActors(f.position, colliderR)) {
          f.velocity.y = 3.8;
          f.velocity.x += (Math.random() - 0.5) * 2.8;
          f.velocity.z += (Math.random() - 0.5) * 2.8;
          f.visual.setPosition(f.position);
          continue;
        }
        f.velocity.set(0, 0, 0);
        this.armC4FromFlightAt(i);
        continue;
      }

      f.visual.setPosition(f.position);
    }
  }

  /** Returns a world position ~distance metres in front of the camera. */
  private getLethalThrowPoint(distance: number): pc.Vec3 {
    const origin = this.player.getCameraPosition();
    const forward = this.player.getCameraForward();
    return origin.clone().add(forward.clone().mulScalar(distance));
  }

  /** AOE damage blast: damages all zombies within blastRadius metres. */
  private triggerLethalExplosion(
    position: pc.Vec3,
    blastRadius: number,
    opts?: { damageMultiplier?: number; megaExplosion?: boolean; skipSfx?: boolean; softenPresentation?: boolean }
  ): void {
    const dmgMul = opts?.damageMultiplier ?? 1;
    const mega = opts?.megaExplosion ?? false;
    const soft = opts?.softenPresentation ?? false;
    if (mega) {
      const debrisCount = soft ? 7 : 16;
      const speedScale = soft ? 1.2 : 1.75;
      this.effects.spawnDebris(position, true, debrisCount, speedScale);
      if (!soft) {
        this.effects.spawnC4BlastCore(position);
      }
      this.effects.spawnImpactSpark(position);
      if (!soft) {
        this.effects.spawnImpactSpark(
          position.clone().add(new pc.Vec3(0.35 * (Math.random() - 0.5), 0.1, 0.35 * (Math.random() - 0.5)))
        );
      }
      if (!soft) {
        this.screenEffects.triggerScreenShake(0.52);
        this.map.triggerFlicker(1.12);
      }
    } else {
      this.effects.spawnDebris(position, true);
      if (!soft) {
        this.screenEffects.triggerScreenShake(0.14);
      }
    }
    if (!opts?.skipSfx) {
      this.audio.play("kill"); // reuse as boom sfx placeholder
    }

    for (const zombie of this.zombies) {
      if (!zombie.alive) continue;
      const dist = zombie.getPosition().distance(position);
      if (dist > blastRadius) continue;
      // Damage falls off linearly from center (full) to edge (25%)
      const falloff = Math.max(0.25, 1 - dist / blastRadius);
      const damage = 300 * falloff * dmgMul;
      const killed = zombie.applyDamage(damage);
      if (killed) {
        this.stats.kills += 1;
        this.points += GAME_CONFIG.pointsPerKill;
        this.screenEffects.triggerKillPopup(GAME_CONFIG.pointsPerKill, false);
      }
    }
  }

  /**
   * N 74 ST: if the sphere overlaps a zombie capsule, snap to surface and freeze.
   */
  private tryStickN74stToZombies(det: PendingFlyingLethal): boolean {
    const r = det.colliderRadius;
    for (const z of this.zombies) {
      if (!z.alive) continue;

      const headC = z.getHeadTarget();
      const headR = z.getHeadRadius();
      let dist = det.position.distance(headC);
      if (dist < headR + r) {
        const n = det.position.clone().sub(headC);
        if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
        else n.normalize();
        det.position.copy(headC).add(n.clone().mulScalar(headR + r * 0.9));
        det.velocity.set(0, 0, 0);
        det.stuck = true;
        det.stuckZombie = z;
        det.stuckUseHead = true;
        return true;
      }

      const bodyC = z.getAimTarget();
      const bodyR = z.getHitRadius() + 0.32;
      dist = det.position.distance(bodyC);
      if (dist < bodyR + r) {
        const n = det.position.clone().sub(bodyC);
        if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
        else n.normalize();
        det.position.copy(bodyC).add(n.clone().mulScalar(bodyR + r * 0.9));
        det.velocity.set(0, 0, 0);
        det.stuck = true;
        det.stuckZombie = z;
        det.stuckUseHead = false;
        return true;
      }
    }
    return false;
  }

  /** Integrate flying grenades: gravity, ground bounce, wall nudge, fuse. */
  private tickLethalDetonations(dt: number): void {
    if (this.pendingLethalDetonations.length === 0) {
      return;
    }

    const phys = LETHAL_PHYSICS;
    this.lethalGlowPulseTime += dt;

    const remaining: PendingFlyingLethal[] = [];
    for (const det of this.pendingLethalDetonations) {
      det.fuseRemaining -= dt;
      if (det.fuseRemaining <= 0) {
        det.visual.destroy();
        const lp = LETHAL_PARAMS[det.lethalKind];
        this.triggerLethalExplosion(det.position, det.blastRadius, {
          damageMultiplier: lp.explosionDamageMultiplier,
          megaExplosion: lp.megaExplosion
        });
        continue;
      }

      if (det.lethalKind === "n74st") {
        if (det.stuck) {
          if (det.stuckZombie) {
            if (!det.stuckZombie.alive) {
              det.visual.destroy();
              const lp = LETHAL_PARAMS[det.lethalKind];
              this.triggerLethalExplosion(det.position, det.blastRadius, {
                damageMultiplier: lp.explosionDamageMultiplier,
                megaExplosion: lp.megaExplosion
              });
              continue;
            }
            const z = det.stuckZombie;
            const c = det.stuckUseHead ? z.getHeadTarget() : z.getAimTarget();
            const capR = det.stuckUseHead
              ? z.getHeadRadius()
              : z.getHitRadius() + 0.32;
            const n = det.position.clone().sub(c);
            if (n.lengthSq() < 1e-8) n.set(0, 1, 0);
            else n.normalize();
            det.position
              .copy(c)
              .add(n.clone().mulScalar(capR + det.colliderRadius * 0.9));
          }
        } else {
          det.velocity.y -= phys.gravity * dt;
          det.position.x += det.velocity.x * dt;
          det.position.y += det.velocity.y * dt;
          det.position.z += det.velocity.z * dt;

          if (!this.tryStickN74stToZombies(det)) {
            if (
              this.collision.overlapsBlockingXZ(
                det.position.x,
                det.position.z,
                det.colliderRadius
              )
            ) {
              this.collision.resolveZombiePosition(det.position, det.colliderRadius);
              det.velocity.set(0, 0, 0);
              det.stuck = true;
              det.stuckZombie = null;
              det.stuckUseHead = false;
            } else {
              const groundY = this.getLethalGroundY(
                det.position.x,
                det.position.z,
                det.position.y
              );
              const restY = groundY + det.colliderRadius;
              if (det.position.y < restY) {
                det.position.y = restY;
                det.velocity.set(0, 0, 0);
                det.stuck = true;
                det.stuckZombie = null;
                det.stuckUseHead = false;
              }
            }
          }
        }
      } else {
        det.velocity.y -= phys.gravity * dt;
        det.position.x += det.velocity.x * dt;
        det.position.y += det.velocity.y * dt;
        det.position.z += det.velocity.z * dt;

        this.collision.resolveZombiePosition(det.position, det.colliderRadius);

        const groundY = this.getLethalGroundY(det.position.x, det.position.z, det.position.y);
        const restY = groundY + det.colliderRadius;
        if (det.position.y < restY) {
          det.position.y = restY;
          if (det.velocity.y < 0) {
            det.velocity.y *= -phys.groundRestitution;
            det.velocity.x *= phys.groundFriction;
            det.velocity.z *= phys.groundFriction;
            if (Math.abs(det.velocity.y) < 0.65) {
              det.velocity.y = 0;
            }
          }
        }
      }

      det.visual.setPosition(det.position);

      const warnWindow = Math.min(
        det.fuseTotal,
        Math.max(
          phys.fuseWarningMinSeconds,
          Math.min(phys.fuseWarningMaxSeconds, det.fuseTotal * phys.fuseWarningPortion)
        )
      );
      const warnUrgency =
        det.fuseTotal > 0 && det.fuseRemaining <= warnWindow
          ? 1 - det.fuseRemaining / warnWindow
          : 0;

      const pulseHz = phys.glowPulseHz * (1 + warnUrgency * 6.5);
      const pulse =
        0.78 + 0.22 * Math.sin(this.lethalGlowPulseTime * Math.PI * 2 * pulseHz);
      const emissiveBoost = 1 + warnUrgency * warnUrgency * 2.8;
      const meshScale = det.visualBaseScale * (1 + warnUrgency * 0.62);
      det.visual.setLocalScale(meshScale, meshScale, meshScale);

      det.glowMat.emissive.set(
        Math.min(2.35, det.glowBase.r * pulse * emissiveBoost),
        Math.min(2.35, det.glowBase.g * pulse * emissiveBoost),
        Math.min(2.35, det.glowBase.b * pulse * emissiveBoost)
      );
      det.glowMat.update();

      if (warnUrgency > 0.35) {
        det.preheatAcc += dt;
        const burstInterval = Math.max(0.045, 0.13 - warnUrgency * 0.07);
        if (det.preheatAcc >= burstInterval) {
          det.preheatAcc = 0;
          this.effects.spawnGrenadeArmingPulse(det.position.clone(), warnUrgency);
          this.screenEffects.triggerScreenShake(0.055 + 0.11 * warnUrgency);
        }
      } else {
        det.preheatAcc = 0;
      }

      remaining.push(det);
    }
    this.pendingLethalDetonations = remaining;
  }

  // --- Session: start run, game over, pause, return to title ---

  private wireArenaFromBuilt(built: MapBuildResult): void {
    this.doors.length = 0;
    if (MAP_CONFIG.importVisual.enabled) {
      return;
    }
    this.doors.push(...built.doors);
    for (const wallBuy of built.wallBuys) {
      this.interactions.register(wallBuy);
    }
    for (const door of built.doors) {
      this.interactions.register(door);
    }
  }

  private loadPlayerCharacterModel(): Promise<void> {
    const cfg = getPlayerVisualRuntime();
    if (!cfg.useGltf) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const serial = ++this.playerVisualLoadSerial;
      const asset = new pc.Asset(`player-v-${serial}`, "container", { url: cfg.gltfUrl });
      asset.on("error", (err: string) => {
        console.warn(`[GameApp] Player glTF failed (${cfg.gltfUrl}):`, err);
        resolve();
      });
      asset.ready(() => {
        if (serial !== this.playerVisualLoadSerial) {
          resolve();
          return;
        }
        this.player.attachCharacterModel(kitFromContainerAsset(asset));
        void this.loadPlayerJetpackCosmetic().then(() => resolve());
      });
      this.app.assets.add(asset);
      this.app.assets.load(asset);
    });
  }

  private loadPlayerJetpackCosmetic(): Promise<void> {
    const jp = GAME_CONFIG.playerVisual.jetpackCosmetic;
    if (!jp.enabled) {
      return Promise.resolve();
    }
    return this.ensureJetpackCosmeticAttached("marauder");
  }

  /** Ensure `variant` glTF is loaded and parented on the hero (pickup swaps valkyrie vs marauder). */
  private ensureJetpackCosmeticAttached(variant: JetpackVariant): Promise<void> {
    const jp = GAME_CONFIG.playerVisual.jetpackCosmetic;
    const spec = jp.variants?.[variant];
    if (!jp.enabled || !spec) {
      return Promise.resolve();
    }

    const cached = this.jetpackCosmeticAssets[variant];
    if (cached?.resource) {
      this.player.attachJetpackCosmetic(kitFromContainerAsset(cached), variant);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const asset = new pc.Asset(`jetpack-cosmetic-${variant}`, "container", { url: spec.gltfUrl });
      asset.on("error", (err: string) => {
        console.warn(`[GameApp] Jetpack glTF failed (${spec.gltfUrl}):`, err);
        resolve();
      });
      asset.ready(() => {
        this.jetpackCosmeticAssets[variant] = asset;
        this.player.attachJetpackCosmetic(kitFromContainerAsset(asset), variant);
        resolve();
      });
      this.app.assets.add(asset);
      this.app.assets.load(asset);
    });
  }

  private teardownAlly(): void {
    if (this.ally) {
      this.ally.destroy();
      this.ally = null;
    }
  }

  private teardownNineTailsPet(): void {
    if (this.nineTailsPet) {
      this.nineTailsPet.destroy();
      this.nineTailsPet = null;
    }
  }

  private teardownTeddyBearEasterEgg(): void {
    if (this.teddyBearEasterEgg) {
      this.teddyBearEasterEgg.destroy();
      this.teddyBearEasterEgg = null;
    }
  }

  private teardownDevRoundSkipper(): void {
    if (this.devRoundSkipper) {
      this.interactions.unregister(this.devRoundSkipper.id);
      this.devRoundSkipper.destroy();
      this.devRoundSkipper = null;
    }
  }

  /**
   * Spawn the Ice Dragon as a {@link DragonBoss} — flies in from above, then lands.
   * Director sets spawn quota to 0 for this wave so no normal zombies appear.
   */
  private spawnBossForWave(wave: number): void {
    const bw = GAME_CONFIG.bossWave;
    if (!bw.enabled || wave !== bw.waveNumber) {
      return;
    }

    // Tear down any existing dragon from a prior run/debug restart
    if (this.dragonBoss) {
      this.dragonBoss.root.destroy();
      this.dragonBoss = null;
    }

    const position = this.map.pickRandomActiveSpawnPosition(
      this.player.getPosition(),
      bw.spawnMinDistance,
      { requireMinDistance: true }
    ) ?? new pc.Vec3(
      this.player.getPosition().x + 20,
      0,
      this.player.getPosition().z + 20
    );

    const baseHealth =
      GAME_CONFIG.zombie.baseHealth + (wave - 1) * GAME_CONFIG.zombie.healthPerWave;
    const health = Math.max(1, Math.floor(baseHealth * bw.healthMultiplier));

    const dragon = new DragonBoss(
      position,
      health,
      this.bossKit,
      /* onLand — screen shake + banner */ () => {
        this.screenEffects.triggerScreenShake(0.6);
        this.screenEffects.showWaveBanner("ICE DRAGON HAS LANDED");
        this.audio.play("impact");
      },
      /* onIceBomb — spawn ice impact FX */ (bombPos: pc.Vec3) => {
        this.effects.spawnDebris(bombPos, this.settings.get().bloodFx);
        this.screenEffects.triggerScreenShake(0.18);
      }
    );

    this.dragonBoss = dragon;
    this.app.root.addChild(dragon.root);

    // Also register in zombies[] so PlayerController hit detection picks it up
    this.zombies.push(dragon as unknown as Zombie);

    console.log("[GameApp] Ice Dragon spawned — descending from altitude.");
  }

  private resolveTeddyBearGroundY(x: number, z: number, refY: number): number {
    if (MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround) {
      const y = this.map.sampleImportedTerrainYNearFeet(x, z, refY);
      if (y != null) {
        return y + MAP_CONFIG.importVisual.groundSnapClearance;
      }
    }
    return 0;
  }

  private async spawnTeddyBearEasterEgg(): Promise<void> {
    this.teardownTeddyBearEasterEgg();
    if (!GAME_CONFIG.teddyBearEasterEgg.enabled) {
      return;
    }
    const egg = new TeddyBearEasterEgg(this.app, (x, z, refY) =>
      this.resolveTeddyBearGroundY(x, z, refY)
    );
    this.teddyBearEasterEgg = egg;
    await egg.loadAndSpawn();
  }

  private async beginRunWithSetup(): Promise<void> {
    this.audio.resetTeddyEasterEggAudioState();
    this.teardownTeddyBearEasterEgg();
    for (const zombie of this.zombies) {
      zombie.root.destroy();
    }
    this.zombies = [];
    // Destroy any active dragon boss from a previous run
    if (this.dragonBoss) {
      this.dragonBoss.root.destroy();
      this.dragonBoss = null;
    }
    this.syncBossHpBar(null);
    this.teardownAlly();
    this.teardownNineTailsPet();
    if (this.mysteryBox) {
      this.mysteryBox.destroy();
      this.mysteryBox = null;
    }
    if (this.packAPunch) {
      this.packAPunch.destroy();
      this.packAPunch = null;
    }
    this.teardownDevRoundSkipper();
    for (const drop of this.maxAmmoDrops) {
      drop.destroy();
    }
    this.maxAmmoDrops = [];
    for (const d of this.worldDrops) {
      d.destroy();
    }
    this.worldDrops = [];
    this.disposeC4();
    this.disposeSmines();
    this.disposePendingLethalFlyers();
    this.stash.clear();
    this.inventorySelectedSlot = 0;
    this.input.setInventoryOpen(false);
    this.points = 0;
    this.stats = this.makeStats();
    this.runXpGained = 0;
    this.runWeaponKills = {};
    this.inRunLevel = this.account.level;
    this.clearLevelUpFx();
    this.terrainFollowTimer = 0;
    this.zombieTerrainTimer = 0;
    this.zombieTerrainCursor = 0;
    this.playerGravityDropActive = false;
    this.playerGravityDropVelocity = 0;
    this.playerGravityDropTargetY = null;

    applyMapPreset(this.lastMapId);
    applyPlayerModelPreset(this.lastPlayerId);

    const built = await this.map.rebuildWorld(this.app);
    this.configureScene();

    if (MAP_CONFIG.importVisual.enabled) {
      this.player.setCameraFarClip(MAP_CONFIG.importVisual.cameraFarClip);
    }

    // ── Apply loadout ───────────────────────────────────────────────────────
    const loadout = this.activeLoadout;

    // Starter weapon: chosen pistol only (no main gun unless loadout says otherwise)
    const starterSlots: WeaponId[] = [loadout?.primary ?? "pistol"];
    this.inventory.reset(starterSlots);

    // Reset all PlayerController loadout flags before applying new ones
    this.player.resetLoadoutFlags();

    // Special Ability
    if (loadout?.specialAbility === "ghost_mags") {
      this.player.ghostMags = true;
    } else if (loadout?.specialAbility === "iron_will") {
      this.player.ironWillActive = true;
    } else if (loadout?.specialAbility === "dead_sprint") {
      this.player.deadSprint = true;
    }
    // "bloodlust" is handled per-kill in handleShot

    // Mod: Quick Hands — faster reload
    if (loadout?.mod === "quick_hands") {
      this.player.reloadSpeedMultiplier = 0.65;
    }

    // Mod: Stopping Power — damage multiplier
    if (loadout?.mod === "stopping_power") {
      this.player.damageMultiplier = 1.25;
    }

    // Mod: Extended Mag — double the starting magazine
    if (loadout?.mod === "extended_mag") {
      const w = this.inventory.getCurrent?.();
      if (w) {
        w.ammoMag = Math.min(w.ammoMag * 2, 999);
        w.ammoReserve = Math.min(w.ammoReserve * 2, 9999);
      }
    }

    // Mod: Iron Trigger — 20% faster fire rate
    if (loadout?.mod === "iron_trigger") {
      this.player.fireCooldownMultiplier = 0.8;
    }

    // Mod: Dead Eye — +40% headshot damage bonus
    if (loadout?.mod === "dead_eye") {
      this.player.headshotBonus = 0.4;
    }

    // Mod: Thick Skin — 15% damage reduction
    if (loadout?.mod === "thick_skin") {
      this.player.incomingDamageMultiplier = 0.85;
    }

    // Mod: Fleet Foot — +12% move speed
    if (loadout?.mod === "fleet_foot") {
      this.player.moveSpeedBonus = 0.12;
    }

    // Mod: Mag Swapper — instant reload on weapon swap
    if (loadout?.mod === "mag_swapper") {
      this.player.magSwapperActive = true;
    }

    // Mod: Vital Harvest — restore 12 HP per kill (handled in handleShot)
    if (loadout?.mod === "vital_harvest") {
      this.player.vitalHarvestHp = 12;
    }

    // Lethal — load charges (stored on instance for in-game use via G key)
    this.applyLethalFromLoadout(loadout);

    this.player.reset();
    this.weaponWheelWasOpen = false;
    this.weaponWheelHighlight = 0;
    this.input.setWeaponWheelOpen(false);
    void this.weaponWheel.sync(false, [], 0, 0, 0);
    await this.loadPlayerCharacterModel();
    this.player.notifyWeaponInventoryChanged();
    this.waveDirector.reset();
    this.map.reset();

    this.interactions.clear();
    this.wireArenaFromBuilt(built);
    this.rebuildInteractions();

    const mbp = GAME_CONFIG.mysteryBox.position;
    const mbPos = new pc.Vec3(mbp.x, mbp.y, mbp.z);
    this.mysteryBox = new MysteryBox(this.app.root, mbPos, (weaponId, _name) => {
      this.inventory.buyOrRefill(weaponId);
      this.audio.play("weaponBuy");
      this.player.notifyWeaponInventoryChanged();
      this.renderHud();
    });
    if (MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround) {
      this.map.snapEntityFeetToImportedGround(this.mysteryBox.getRoot(), mbp.x, mbp.z, mbp.y);
    }
    this.interactions.register(this.mysteryBox);

    this.packAPunch = new PackAPunchMachine(this.app, this.app.root);
    if (MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround) {
      const pp = GAME_CONFIG.packAPunch.position;
      this.map.snapEntityFeetToImportedGround(this.packAPunch.getRoot(), pp.x, pp.z, pp.y);
    }
    this.interactions.register(this.packAPunch);

    this.teardownDevRoundSkipper();
    if (GAME_CONFIG.devRoundSkipper.enabled) {
      this.devRoundSkipper = new RoundSkipperBlock(this.app, this.app.root);
      if (MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround) {
        const rs = GAME_CONFIG.devRoundSkipper.position;
        this.map.snapEntityFeetToImportedGround(this.devRoundSkipper.getRoot(), rs.x, rs.z, rs.y);
      }
      this.interactions.register(this.devRoundSkipper);
    }

    await this.spawnTeddyBearEasterEgg();

    this.phase = "playing";
    this.input.setGameOver(false);
    this.input.setPaused(false);
    this.input.setInputBlocked(false);

    this.audio.unlock();
    this.audio.setDroneIntensity(0.18);
    this.audio.setHeartbeatRate(0);

    this.hud.setInteractPrompt(null);

    this.menus.hide();
    this.input.requestPointerLockIfNeeded();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    this.renderHud();

    this.syncMenuAmbientAudio();

    if (MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround) {
      if (this.map.snapPlayerFeetToImportedGround(this.player.root)) {
        this.renderHud();
      }
    }

    await this.nineTailsPetAssetPromise;
    if (GAME_CONFIG.nineTailsPet.enabled && this.nineTailsPetKit) {
      const p = this.player.getPosition().clone();
      this.nineTailsPet = new NineTailsPet(p, this.collision, this.nineTailsPetKit);
      this.app.root.addChild(this.nineTailsPet.root);
      if (MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround) {
        this.map.snapEntityFeetToImportedGround(
          this.nineTailsPet.root,
          p.x,
          p.z,
          p.y
        );
      }
    }

    if (this.settings.get().aiAllyEnabled) {
      const p = this.player.getPosition().clone();
      this.ally = new AiAlly(p, this.collision, this.pickEnemyModelKit());
      this.app.root.addChild(this.ally.root);
    }
  }

  private rebuildInteractions(): void {
    for (const door of this.doors) {
      if ((door as unknown as { isAvailable: () => boolean }).isAvailable()) {
        this.interactions.register(door);
      }
    }
  }

  private endRun(): void {
    this.clearLevelUpFx();
    this.teardownAlly();
    this.teardownNineTailsPet();
    this.input.setInventoryOpen(false);
    this.phase = "gameOver";
    this.input.setGameOver(true);
    this.input.setInputBlocked(true);
    this.audio.play("gameOver");
    this.audio.setDroneIntensity(0.05);
    this.audio.stopHeartbeat();
    this.audio.stopTeddyEasterRewardSong();
    this.screenEffects.triggerScreenShake(GAME_CONFIG.fx.screenShakeDamage);
    this.hud.setInteractPrompt(null);

    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }

    const survived = (performance.now() - this.stats.startTime) / 1000;
    const reward = this.account.awardRunResults({
      kills: this.stats.kills,
      wave: this.waveDirector.currentWave,
      survivedSeconds: survived,
      headshots: this.stats.headshots,
      weaponKills: this.runWeaponKills
    });
    this.menus.showGameOver({
      wave: this.waveDirector.currentWave,
      points: this.points,
      kills: this.stats.kills,
      headshots: this.stats.headshots,
      shotsFired: this.stats.shotsFired,
      shotsHit: this.stats.shotsHit,
      survivedSeconds: survived,
      reward
    });
    this.syncMenuAmbientAudio();
  }

  private togglePause(): void {
    if (this.phase === "playing") {
      if (this.input.isInventoryOpen()) {
        this.input.setInventoryOpen(false);
        this.renderHud();
        this.input.requestPointerLockIfNeeded();
        return;
      }
      this.input.setInventoryOpen(false);
      this.phase = "paused";
      this.input.setPaused(true);
      this.input.setInputBlocked(true);
      this.audio.setDroneIntensity(0.05);
      this.audio.stopHeartbeat();
      this.menus.showPause();
      this.syncMenuAmbientAudio();
    } else if (this.phase === "paused") {
      this.resume();
    }
  }

  private resume(): void {
    if (this.phase !== "paused") return;
    this.phase = "playing";
    this.input.setPaused(false);
    this.input.setInputBlocked(false);
    this.audio.setDroneIntensity(Math.min(1, this.waveDirector.currentWave * 0.18));
    this.menus.hide();
    this.input.requestPointerLockIfNeeded();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    this.syncMenuAmbientAudio();
  }

  private returnToTitle(): void {
    for (const zombie of this.zombies) {
      zombie.root.destroy();
    }
    this.zombies = [];
    this.teardownAlly();
    this.teardownNineTailsPet();
    if (this.mysteryBox) {
      this.mysteryBox.destroy();
      this.mysteryBox = null;
    }
    if (this.packAPunch) {
      this.packAPunch.destroy();
      this.packAPunch = null;
    }
    this.teardownDevRoundSkipper();
    for (const drop of this.maxAmmoDrops) {
      drop.destroy();
    }
    this.maxAmmoDrops = [];
    for (const drop of this.jetpackDrops) {
      drop.destroy();
    }
    this.jetpackDrops = [];
    this.jetpackVariantCursor = "valkyrie";
    for (const d of this.worldDrops) {
      d.destroy();
    }
    this.worldDrops = [];
    this.disposeC4();
    this.disposeSmines();
    this.disposePendingLethalFlyers();
    this.teardownTeddyBearEasterEgg();
    this.audio.stopTeddyEasterRewardSong();
    this.stash.clear();
    this.inventorySelectedSlot = 0;
    this.input.setInventoryOpen(false);
    this.phase = "title";
    this.input.setGameOver(false);
    this.input.setPaused(false);
    this.input.setInputBlocked(true);
    this.audio.setDroneIntensity(0.07);
    this.audio.stopHeartbeat();
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
    this.inventory.reset(STARTER_WEAPON_SLOTS);
    this.player.reset();
    this.player.notifyWeaponInventoryChanged();
    this.waveDirector.reset();
    this.map.reset();
    this.interactions.clear();
    this.rebuildInteractions();
    this.points = 0;
    this.stats = this.makeStats();
    this.runXpGained = 0;
    this.runWeaponKills = {};
    this.inRunLevel = this.account.level;
    this.clearLevelUpFx();
    this.playerGravityDropActive = false;
    this.playerGravityDropVelocity = 0;
    this.playerGravityDropTargetY = null;
    this.weaponWheelWasOpen = false;
    this.weaponWheelHighlight = 0;
    this.input.setWeaponWheelOpen(false);
    void this.weaponWheel.sync(false, [], 0, 0, 0);
    this.hud.setInteractPrompt(null);
    this.renderHud();
    this.syncMenuAmbientAudio();
  }

  /** Loop {@link GAME_CONFIG.audio.menuMusicUrl} whenever menus are up; stop during rounds. */
  private syncMenuAmbientAudio(): void {
    if (this.phase === "title" || this.phase === "paused" || this.phase === "gameOver") {
      this.audio.startMenuMusicLoop();
    } else {
      this.audio.stopMenuMusicLoop();
    }
  }

  // --- Boss HP bar ───────────────────────────────────────────────────────────

  private syncBossHpBar(fraction: number | null): void {
    const wrap = document.getElementById("boss-hp-wrap");
    const fill = document.getElementById("boss-hp-fill");
    const label = document.getElementById("boss-hp-label");
    if (!wrap || !fill) return;

    if (fraction === null) {
      wrap.classList.remove("is-visible");
      return;
    }
    wrap.classList.add("is-visible");
    fill.style.width = `${Math.max(0, fraction * 100).toFixed(1)}%`;
    if (label) {
      label.textContent = `ICE DRAGON — ${Math.ceil(fraction * 100)}%`;
    }
  }

  // --- DOM HUD: vitals, ammo, dev toggles (snapshotted each playing frame) ---

  private renderHud(): void {
    const weapon: Weapon = this.player.getCurrentWeapon();
    const lethal = this.activeLoadout?.lethal;
    const c4Live = this.getC4LiveCount();
    const c4HoldHint =
      this.phase === "playing" &&
      this.input.isLethalHeld() &&
      c4Live > 0 &&
      this.c4HoldDetonateSeconds > C4_DETONATE_HOLD_SECONDS * 0.3;
    this.hud.render({
      health: this.player.health,
      points: this.points,
      wave: this.waveDirector.currentWave,
      activeZombies: this.zombies.length,
      queuedZombies: this.waveDirector.getQueuedSpawns(),
      weapon,
      isReloading: this.player.isCurrentlyReloading(),
      reloadProgress: this.player.getReloadProgress(),
      lethalCharges: lethal ? this.lethalCharges : undefined,
      lethalName: lethal
        ? lethal === "satchel"
          ? c4HoldHint
            ? "HOLD"
            : c4Live > 0
              ? `C4×${c4Live}`
              : "C4"
          : lethal === "smine44"
            ? this.activeSmines.some((m) => m.kind === "arming")
              ? "ARM"
              : this.activeSmines.length > 0
                ? `BB×${this.activeSmines.length}`
                : "BB"
          : lethal.toUpperCase()
        : undefined
    });
    const invOpen = this.phase === "playing" && this.input.isInventoryOpen();
    this.hud.syncInventoryPanel(invOpen, weapon, this.stash.getStacks(), this.inventorySelectedSlot);
    this.hud.setJetpackStatus(
      this.player.hasJetpack,
      this.player.getJetpackRemaining(),
      this.player.getThrusterFuelRatio()
    );
    this.syncAdsHud();
  }

  /** Toggle scope overlay and crosshair ADS class each frame (or whenever HUD rerenders). */
  private syncAdsHud(): void {
    const isPlaying = this.phase === "playing";
    const scoping = isPlaying && this.player.isSnipingScope;
    const ads = isPlaying && this.player.adsActive;

    if (scoping !== this.lastScopeState) {
      this.lastScopeState = scoping;
      this.scopeOverlay?.classList.toggle("is-visible", scoping);
      this.crosshairEl?.classList.toggle("is-scope-hidden", scoping);
    }

    if (ads !== this.lastAdsState) {
      this.lastAdsState = ads;
      if (!scoping) {
        this.crosshairEl?.classList.toggle("is-ads", ads);
      }
    }
  }

  private toggleInventory(): void {
    if (this.phase !== "playing" || this.menus.isOpen()) {
      return;
    }
    const next = !this.input.isInventoryOpen();
    this.input.setInventoryOpen(next);
    if (next) {
      this.input.setWeaponWheelOpen(false);
      this.weaponWheelWasOpen = false;
      void this.weaponWheel.sync(false, [], 0, 0, 0);
      this.clampInventorySelection();
    } else {
      this.input.requestPointerLockIfNeeded();
    }
    this.renderHud();
  }

  private clampInventorySelection(): void {
    const n = this.stash.getStacks().length;
    if (n <= 0) {
      this.inventorySelectedSlot = 0;
      return;
    }
    this.inventorySelectedSlot = Math.max(0, Math.min(this.inventorySelectedSlot, n - 1));
  }

  private onInventorySlotSelect(index: number): void {
    if (this.phase !== "playing") return;
    const n = this.stash.getStacks().length;
    if (index >= 0 && index < n) {
      this.inventorySelectedSlot = index;
      this.renderHud();
    }
  }

  private useSelectedStashAmmo(): void {
    if (this.phase !== "playing" || !this.input.isInventoryOpen()) return;
    this.clampInventorySelection();
    const applied = this.stash.applyStackToWeapons(this.inventorySelectedSlot, this.inventory);
    if (applied > 0) {
      this.audio.play("reloadDone");
      this.clampInventorySelection();
      this.player.notifyWeaponInventoryChanged();
      this.renderHud();
    }
  }

  private dropSelectedStashAmmo(): void {
    if (this.phase !== "playing" || !this.input.isInventoryOpen()) return;
    this.clampInventorySelection();
    const taken = this.stash.takeStackAt(this.inventorySelectedSlot);
    if (!taken) return;
    const pos = this.getDropSpawnPosition();
    this.worldDrops.push(
      new WorldItemDrop(this.app.root, pos, { caliber: taken.caliber, amount: taken.amount })
    );
    this.clampInventorySelection();
    this.audio.play("weaponSwap");
    this.renderHud();
  }

  private getDropSpawnPosition(): pc.Vec3 {
    const p = this.player.getPosition();
    const fwd = this.player.root.forward.clone();
    fwd.y = 0;
    if (fwd.lengthSq() > 1e-6) {
      fwd.normalize();
    } else {
      fwd.set(0, 0, 1);
    }
    return new pc.Vec3(p.x + fwd.x * 0.85, p.y, p.z + fwd.z * 0.85);
  }

  private makeStats(): RunStats {
    return {
      kills: 0,
      headshots: 0,
      shotsFired: 0,
      shotsHit: 0,
      startTime: performance.now()
    };
  }

  // --- Scene look: ambient, fog ranges, sun key light (open-world vs arena) ---

  /**
   * Ambient / fog / directional sun plus Hytopia cubemap sky ({@link applySceneSkybox}).
   * Called on boot and when switching import vs arena after a run restart.
   */
  private configureScene(): void {
    if (this.sunEntity) {
      this.sunEntity.destroy();
      this.sunEntity = null;
    }
    if (this.skyFillEntity) {
      this.skyFillEntity.destroy();
      this.skyFillEntity = null;
    }

    const openImport =
      MAP_CONFIG.importVisual.enabled && MAP_CONFIG.importVisual.replacesArena;
    const space = GAME_CONFIG.sceneLook.outerSpaceSky;

    if (MAP_CONFIG.importVisual.enabled) {
      if (space) {
        // Orbital / deep-space key: cool starlight + visible voxels
        this.app.scene.ambientLight = new pc.Color(0.12, 0.14, 0.22);
        this.app.scene.exposure = 1.58;
        this.app.scene.fog.type = pc.FOG_LINEAR;
        if (openImport) {
          this.app.scene.fog.start = 220;
          this.app.scene.fog.end = 1050;
        } else {
          this.app.scene.fog.start = 50;
          this.app.scene.fog.end = 270;
        }
        this.app.scene.fog.color = new pc.Color(0.03, 0.04, 0.09);
      } else {
        // Open world: bright midday sky — high ambient so Hytopia voxel meshes read clearly.
        this.app.scene.ambientLight = new pc.Color(0.74, 0.8, 0.88);
        this.app.scene.exposure = 1.72;
        this.app.scene.fog.type = pc.FOG_LINEAR;
        if (openImport) {
          this.app.scene.fog.start = 140;
          this.app.scene.fog.end = 950;
        } else {
          this.app.scene.fog.start = 55;
          this.app.scene.fog.end = 260;
        }
        this.app.scene.fog.color = new pc.Color(0.68, 0.78, 0.9);
      }
    } else if (space) {
      // Arena under a starfield: slightly brighter so the yard reads
      this.app.scene.ambientLight = new pc.Color(0.16, 0.18, 0.26);
      this.app.scene.exposure = 1.45;
      this.app.scene.fog.type = pc.FOG_LINEAR;
      this.app.scene.fog.start = 48;
      this.app.scene.fog.end = 230;
      this.app.scene.fog.color = new pc.Color(0.05, 0.06, 0.12);
    } else {
      // Procedural arena: daytime outdoor light (readable, bright horizon)
      this.app.scene.ambientLight = new pc.Color(0.58, 0.66, 0.78);
      this.app.scene.exposure = 1.52;
      this.app.scene.fog.type = pc.FOG_LINEAR;
      this.app.scene.fog.start = 50;
      this.app.scene.fog.end = 220;
      this.app.scene.fog.color = new pc.Color(0.62, 0.74, 0.88);
    }

    // Key sun (distant blue-white in space; warm daylight otherwise)
    const sun = new pc.Entity("sun");
    if (MAP_CONFIG.importVisual.enabled) {
      sun.addComponent("light", {
        type: "directional",
        castShadows: false,
        color: space
          ? new pc.Color(0.78, 0.9, 1.0)
          : new pc.Color(1.0, 0.96, 0.86),
        intensity: space ? 3.05 : 2.85
      });
      sun.setEulerAngles(44, -30, 0);
    } else {
      sun.addComponent("light", {
        type: "directional",
        castShadows: false,
        color: space
          ? new pc.Color(0.76, 0.88, 1.0)
          : new pc.Color(0.98, 0.94, 0.82),
        intensity: space ? 2.65 : 2.25
      });
      sun.setEulerAngles(48, -35, 0);
    }
    this.app.root.addChild(sun);
    this.sunEntity = sun;

    // Fill: cool bounce from the sky (space) or soft sky haze (day)
    const fill = new pc.Entity("sky-fill");
    fill.addComponent("light", {
      type: "directional",
      castShadows: false,
      color: space
        ? MAP_CONFIG.importVisual.enabled
          ? new pc.Color(0.22, 0.26, 0.42)
          : new pc.Color(0.2, 0.24, 0.38)
        : MAP_CONFIG.importVisual.enabled
          ? new pc.Color(0.55, 0.68, 0.9)
          : new pc.Color(0.5, 0.64, 0.88),
      intensity: space
        ? MAP_CONFIG.importVisual.enabled
          ? 0.62
          : 0.55
        : MAP_CONFIG.importVisual.enabled
          ? 1.05
          : 0.78
    });
    fill.setEulerAngles(-80, 0, 0); // pointing down from sky
    this.app.root.addChild(fill);
    this.skyFillEntity = fill;

    void applySceneSkybox(this.app, getSceneSkyboxConfig(), this.skyboxTexture).then((tex) => {
      this.skyboxTexture = tex;
    });

    this.player.syncCameraClearForMap();
  }

  private targetPixelRatio(): number {
    const openImport =
      MAP_CONFIG.importVisual.enabled && MAP_CONFIG.importVisual.replacesArena;
    if (window.matchMedia("(pointer: coarse)").matches) {
      return Math.min(window.devicePixelRatio, openImport ? 1.15 : 1.3);
    }
    return Math.min(window.devicePixelRatio, openImport ? 1.45 : 1.8);
  }

  private createWeaponViewAssetEntries(): Map<WeaponId, { asset: pc.Asset }> {
    const m = new Map<WeaponId, { asset: pc.Asset }>();
    for (const id of WEAPON_IDS) {
      const url = WEAPON_DEFINITIONS[id].viewModelGltf?.url;
      if (!url) continue;
      const asset = new pc.Asset(`weapon-vm-${id}`, "container", { url });
      this.app.assets.add(asset);
      asset.on("error", (err: string) => {
        console.warn(`[GameApp] Weapon view glTF (${url}):`, err);
      });
      m.set(id, { asset });
      this.app.assets.load(asset);
    }
    return m;
  }

  private pickEnemyModelKit(): EnemyModelKit | null {
    if (!GAME_CONFIG.enemyVisual.useGltf || this.enemyModelKits.length === 0) {
      return null;
    }
    const kits = this.enemyModelKits;
    if (GAME_CONFIG.enemyVisual.randomizeVariant && kits.length > 1) {
      return kits[Math.floor(Math.random() * kits.length)]!;
    }
    return kits[0]!;
  }
}
