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
import { Weapon, WEAPON_DEFINITIONS, WEAPON_IDS, WeaponInventory, type WeaponId } from "./Weapon";
import { WeaponWheel } from "./WeaponWheel";
import { Zombie, type EnemyModelKit } from "./Zombie";
import type { Door } from "./Door";
import {
  applyPlayerModelPreset,
  getPlayerVisualRuntime,
  type PlayerModelId
} from "./runSession";

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
    getAnimTrack: (name: string) => byName.get(name)
  };
}

const ZONE_FOR_DOOR_INDEX = ["loadingBay", "office", "powerYard"] as const;

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

  private zombies: Zombie[] = [];
  private points = 0;
  private phase: GamePhase = "title";
  private stats: RunStats = this.makeStats();
  /** Dev / test: click HUD button to pause all AI movement and attacks. */
  private zombiesFrozen = false;
  private terrainFollowTimer = 0;
  private zombieTerrainTimer = 0;
  private zombieTerrainCursor = 0;
  private playerGravityDropActive = false;
  private playerGravityDropVelocity = 0;
  private playerGravityDropTargetY: number | null = null;

  private readonly enemyModelKits: EnemyModelKit[] = [];
  private readonly weaponViewAssetEntries: ReadonlyMap<WeaponId, { asset: pc.Asset }>;

  /** Last lobby picks (restart / Run it back skips map & operator screens). */
  private lastMapId: MapPresetId = "castle";
  private lastPlayerId: PlayerModelId = "soldier";
  private playerVisualLoadSerial = 0;
  private sunEntity: pc.Entity | null = null;

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

    this.weaponViewAssetEntries = this.createWeaponViewAssetEntries();

    this.collision = new CollisionWorld();
    this.inventory = new WeaponInventory("pistol");
    this.map = new ZoneMap(this.app, this.collision);

    this.hud = new Hud(hudRoot, {
      onZombieFreezeToggle: () => {
        this.zombiesFrozen = !this.zombiesFrozen;
        this.renderHud();
      },
      onDropToGroundClick: () => this.beginPlayerGravityDrop()
    });
    this.weaponWheel = new WeaponWheel(hudRoot.querySelector("#weapon-wheel"));
    this.input = new InputManager(canvas, hudRoot);
    this.player = new PlayerController(
      this.input,
      this.settings,
      this.inventory,
      this.collision,
      this.map,
      this.weaponViewAssetEntries
    );
    for (const id of WEAPON_IDS) {
      const row = this.weaponViewAssetEntries.get(id);
      if (row) {
        row.asset.ready(() => {
          this.player.refreshWeaponViewmodel();
        });
      }
    }

    this.menus = new MenuController(document.body, this.settings, {
      onBeginRun: (sel) => {
        this.lastMapId = sel.mapId;
        this.lastPlayerId = sel.playerId;
        void this.beginRunWithSetup();
      },
      onResume: () => this.resume(),
      onRestart: () => void this.beginRunWithSetup(),
      onReturnToTitle: () => this.returnToTitle(),
      onPauseToggleRequested: () => this.togglePause()
    });

    this.input.setCallbacks({
      onPauseRequested: () => this.togglePause(),
      onInteractRequested: () => this.attemptInteraction(),
      onWeaponCycleRequested: (dir) => this.attemptWeaponCycle(dir),
      onWeaponWheelSlotPick: (slot) => this.pickWeaponWheelSlot(slot)
    });

    this.interactions = new InteractionController();

    this.waveDirector = new WaveDirector(
      0,
      {
        onSpawn: ({ position, health, speed }) => {
          const zombie = new Zombie(position, { health, speed }, this.collision, this.pickEnemyModelKit());
          this.zombies.push(zombie);
          this.app.root.addChild(zombie.root);
          if (MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround) {
            this.map.snapEntityFeetToImportedGround(zombie.root, position.x, position.z, position.y);
          }
        },
        onWaveStarted: (wave) => {
          const open = MAP_CONFIG.importVisual.replacesArena;
          this.hud.setStatus(
            open ? `Wave ${wave} closing in from all sides.` : `Wave ${wave} pushing through the gates.`
          );
          this.hud.setMessage(
            wave === 1
              ? open
                ? "Stay moving. Use distance. Imported walls block you (disable in Settings if stuck)."
                : "Hold the line. Reload often. Aim for the head."
              : open
                ? "More of them. Keep kiting and aim for the head."
                : "The horde gets meaner. Buy doors. Stack score."
          );
          this.screenEffects.showWaveBanner(`WAVE ${wave}`, "Hold the line");
          this.audio.play("waveStart");
          this.audio.setDroneIntensity(Math.min(1, wave * 0.18));
          this.map.triggerFlicker(0.85);
        },
        onWaveCleared: (wave) => {
          this.hud.setStatus(`Wave ${wave} cleared. Catch your breath.`);
          this.screenEffects.showWaveBanner(
            `WAVE ${wave} CLEARED`,
            "Reload before the next push"
          );
          this.audio.play("waveCleared");
          this.map.triggerFlicker(0.5);
        },
        onIntermission: (wave, seconds) => {
          const nextWave = wave + 1;
          this.hud.setStatus(
            wave === 0
              ? `First contact in ${seconds}...`
              : `Wave ${nextWave} pushing in ${seconds}...`
          );
        }
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
      !this.input.isTouchMode() &&
      this.inventory.getOwnedCount() > 2 &&
      this.input.isKeyHeld("KeyV");

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
    const shot = this.player.update(simDt, this.zombies);

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
        this.zombiesFrozen
      );

      if (!this.zombiesFrozen && wasAlive && zombie.shouldMoan()) {
        this.audio.play("uiHover");
      }
    }

    this.zombies = this.zombies.filter((zombie) => zombie.alive);

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
    this.hud.setInteractPrompt(update.prompt);

    const healthRatio = this.player.getHealthRatio();
    this.screenEffects.setHealthRatio(healthRatio);
    this.audio.setHeartbeatRate(healthRatio < 0.45 ? 1 - healthRatio / 0.45 : 0);

    if (this.player.health <= 0) {
      this.endRun();
    }

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
      } else {
        this.points += GAME_CONFIG.pointsPerHit;
      }
    }
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
        resolve();
      });
      this.app.assets.add(asset);
      this.app.assets.load(asset);
    });
  }

  private async beginRunWithSetup(): Promise<void> {
    for (const zombie of this.zombies) {
      zombie.root.destroy();
    }
    this.zombies = [];
    this.points = 0;
    this.stats = this.makeStats();
    this.zombiesFrozen = false;
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

    this.inventory.reset("pistol");
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

    this.phase = "playing";
    this.input.setGameOver(false);
    this.input.setPaused(false);
    this.input.setInputBlocked(false);

    this.audio.unlock();
    this.audio.setDroneIntensity(0.18);
    this.audio.setHeartbeatRate(0);

    this.hud.setStatus(
      MAP_CONFIG.importVisual.replacesArena
        ? "You're in the export now — watch every horizon."
        : "Floodlights humming. Stay sharp."
    );
    this.hud.setMessage(
      MAP_CONFIG.importVisual.replacesArena
        ? this.input.isTouchMode()
          ? "Hold Fire. Tap Reload. Explore the map — voxel collision comes later."
          : "Click to lock the mouse. WASD to move. R to reload. Mouse wheel or Q cycles weapons. Hold V for the weapon wheel when you carry three or more guns."
        : this.input.isTouchMode()
          ? "Hold Fire. Tap Reload. Walk up to wall buys and tap Use."
          : "Click to lock the mouse. R to reload. E to buy. Mouse wheel or Q cycles weapons. Hold V for the weapon wheel with three or more guns."
    );
    this.hud.setInteractPrompt(null);

    this.menus.hide();
    this.input.requestPointerLockIfNeeded();
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    this.renderHud();

    if (MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround) {
      if (this.map.snapPlayerFeetToImportedGround(this.player.root)) {
        this.renderHud();
      }
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
    this.phase = "gameOver";
    this.input.setGameOver(true);
    this.input.setInputBlocked(true);
    this.audio.play("gameOver");
    this.audio.setDroneIntensity(0.05);
    this.audio.stopHeartbeat();
    this.screenEffects.triggerScreenShake(GAME_CONFIG.fx.screenShakeDamage);
    this.hud.setInteractPrompt(null);

    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }

    const survived = (performance.now() - this.stats.startTime) / 1000;
    this.menus.showGameOver({
      wave: this.waveDirector.currentWave,
      points: this.points,
      kills: this.stats.kills,
      headshots: this.stats.headshots,
      shotsFired: this.stats.shotsFired,
      shotsHit: this.stats.shotsHit,
      survivedSeconds: survived
    });
  }

  private togglePause(): void {
    if (this.phase === "playing") {
      this.phase = "paused";
      this.input.setPaused(true);
      this.input.setInputBlocked(true);
      this.audio.setDroneIntensity(0.05);
      this.audio.stopHeartbeat();
      this.menus.showPause();
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
  }

  private returnToTitle(): void {
    for (const zombie of this.zombies) {
      zombie.root.destroy();
    }
    this.zombies = [];
    this.phase = "title";
    this.input.setGameOver(false);
    this.input.setPaused(false);
    this.input.setInputBlocked(true);
    this.audio.setDroneIntensity(0);
    this.audio.stopHeartbeat();
    if (document.pointerLockElement === this.canvas) {
      document.exitPointerLock();
    }
    this.inventory.reset("pistol");
    this.player.reset();
    this.player.notifyWeaponInventoryChanged();
    this.waveDirector.reset();
    this.map.reset();
    this.interactions.clear();
    this.rebuildInteractions();
    this.points = 0;
    this.stats = this.makeStats();
    this.zombiesFrozen = false;
    this.playerGravityDropActive = false;
    this.playerGravityDropVelocity = 0;
    this.playerGravityDropTargetY = null;
    this.weaponWheelWasOpen = false;
    this.weaponWheelHighlight = 0;
    this.input.setWeaponWheelOpen(false);
    void this.weaponWheel.sync(false, [], 0, 0, 0);
    this.hud.setStatus(
      MAP_CONFIG.importVisual.replacesArena
        ? "Reloading world slice..."
        : "Booting yard floodlights..."
    );
    this.hud.setMessage(
      MAP_CONFIG.importVisual.replacesArena
        ? "Click PLAY to load into your Mineways world."
        : "Click PLAY to drop into the yard."
    );
    this.hud.setInteractPrompt(null);
    this.renderHud();
  }

  // --- DOM HUD: vitals, ammo, dev toggles (snapshotted each playing frame) ---

  private renderHud(): void {
    const weapon: Weapon = this.player.getCurrentWeapon();
    this.hud.render({
      health: this.player.health,
      points: this.points,
      wave: this.waveDirector.currentWave,
      activeZombies: this.zombies.length,
      queuedZombies: this.waveDirector.getQueuedSpawns(),
      weapon,
      isReloading: this.player.isCurrentlyReloading(),
      reloadProgress: this.player.getReloadProgress(),
      zombiesFrozen: this.zombiesFrozen,
      showDropToGround:
        MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround,
      playerGravityDropping: this.playerGravityDropActive
    });
  }

  // --- Per-run counters (fed into game-over modal) ---

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

  private configureScene(): void {
    if (this.sunEntity) {
      this.sunEntity.destroy();
      this.sunEntity = null;
    }

    const openImport =
      MAP_CONFIG.importVisual.enabled && MAP_CONFIG.importVisual.replacesArena;

    if (MAP_CONFIG.importVisual.enabled) {
      // Daytime readability for Mineways / large imports (was night-orange + dark fog).
      this.app.scene.ambientLight = new pc.Color(0.42, 0.48, 0.55);
      this.app.scene.exposure = 1.25;
      this.app.scene.fog.type = pc.FOG_LINEAR;
      if (openImport) {
        this.app.scene.fog.start = 120;
        this.app.scene.fog.end = 900;
      } else {
        this.app.scene.fog.start = 50;
        this.app.scene.fog.end = 240;
      }
      this.app.scene.fog.color = new pc.Color(0.62, 0.72, 0.85);
    } else {
      this.app.scene.ambientLight = new pc.Color(0.13, 0.1, 0.08);
      this.app.scene.exposure = 1.05;
      this.app.scene.fog.type = pc.FOG_LINEAR;
      this.app.scene.fog.start = 22;
      this.app.scene.fog.end = 70;
      this.app.scene.fog.color = new pc.Color(0.04, 0.03, 0.04);
    }

    const sun = new pc.Entity("sun");
    if (MAP_CONFIG.importVisual.enabled) {
      sun.addComponent("light", {
        type: "directional",
        castShadows: false,
        color: new pc.Color(1, 0.96, 0.88),
        intensity: 1.15
      });
      sun.setEulerAngles(52, -35, 0);
    } else {
      sun.addComponent("light", {
        type: "directional",
        castShadows: false,
        color: new pc.Color(0.7, 0.4, 0.22),
        intensity: 0.45
      });
      sun.setEulerAngles(58, 32, 0);
    }
    this.app.root.addChild(sun);
    this.sunEntity = sun;
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
