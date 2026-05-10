import * as pc from "playcanvas";
import { GAME_CONFIG, MAP_CONFIG } from "./config";
import { AudioEngine } from "./AudioEngine";
import { CollisionWorld } from "./CollisionWorld";
import { Effects } from "./Effects";
import { Hud } from "./Hud";
import { InputManager } from "./InputManager";
import { InteractionController } from "./Interactable";
import { Map as ZoneMap } from "./Map";
import { MenuController } from "./MenuController";
import { PlayerController } from "./PlayerController";
import { ScreenEffects } from "./ScreenEffects";
import { Settings } from "./Settings";
import { WaveDirector } from "./WaveDirector";
import { Weapon, WEAPON_DEFINITIONS, WeaponInventory } from "./Weapon";
import { Zombie } from "./Zombie";
import type { Door } from "./Door";

type GamePhase = "title" | "playing" | "paused" | "gameOver";

type RunStats = {
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  startTime: number;
};

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

    this.collision = new CollisionWorld();
    this.inventory = new WeaponInventory("pistol");

    this.hud = new Hud(hudRoot, {
      onZombieFreezeToggle: () => {
        this.zombiesFrozen = !this.zombiesFrozen;
        this.renderHud();
      },
      onDropToGroundClick: () => this.beginPlayerGravityDrop()
    });
    this.input = new InputManager(canvas, hudRoot);
    this.player = new PlayerController(this.input, this.settings, this.inventory, this.collision);

    this.menus = new MenuController(document.body, this.settings, {
      onStart: () => this.startRun(),
      onResume: () => this.resume(),
      onRestart: () => this.startRun(),
      onReturnToTitle: () => this.returnToTitle(),
      onPauseToggleRequested: () => this.togglePause()
    });

    this.input.setCallbacks({
      onPauseRequested: () => this.togglePause(),
      onInteractRequested: () => this.attemptInteraction(),
      onWeaponSwapRequested: () => this.attemptWeaponSwap()
    });

    this.interactions = new InteractionController();
    this.map = new ZoneMap(this.app, this.collision);

    this.waveDirector = new WaveDirector(
      0,
      {
        onSpawn: ({ position, health, speed }) => {
          const zombie = new Zombie(position, { health, speed }, this.collision);
          this.zombies.push(zombie);
          this.app.root.addChild(zombie.root);
          if (MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround) {
            void this.map.snapEntityFeetToImportedGround(this.app, zombie.root, position.x, position.z);
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
                ? "Stay moving. Use distance. Geometry is still pass-through for now."
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
    const built = this.map.build();
    void this.map.loadImportedVisual(this.app).then(async () => {
      if (MAP_CONFIG.importVisual.enabled) {
        this.player.setCameraFarClip(MAP_CONFIG.importVisual.cameraFarClip);
        if (MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround) {
          const ok = await this.map.snapPlayerFeetToImportedGround(this.app, this.player.root);
          if (ok) {
            this.renderHud();
          }
        }
      }
    });
    this.doors.push(...built.doors);
    for (const wallBuy of built.wallBuys) {
      this.interactions.register(wallBuy);
    }
    for (const door of built.doors) {
      this.interactions.register(door);
    }

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

  private update(dt: number): void {
    this.effects.update(dt);
    this.screenEffects.update(dt);
    this.map.update(dt);

    if (this.phase === "title" || this.phase === "paused") {
      return;
    }

    if (this.input.consumeRestartRequest() && this.phase === "gameOver") {
      this.startRun();
      return;
    }

    if (this.phase === "gameOver") {
      this.renderHud();
      return;
    }

    this.input.update(dt);

    const wasReloading = this.player.isCurrentlyReloading();
    const shot = this.player.update(dt, this.zombies);

    this.applyPlayerGravityDrop(dt);

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
        dt,
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

    this.applyOpenWorldTerrainCling(dt);

    this.waveDirector.update(
      dt,
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

  /**
   * Open world: keep feet on the GLB while moving (XZ-only locomotion) using periodic depth samples.
   */
  private applyOpenWorldTerrainCling(dt: number): void {
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
      void this.map.sampleImportedTerrainY(this.app, pos.x, pos.z).then((y) => {
        if (y == null || this.phase !== "playing") return;
        const targetFeetY = y + up;
        const cur = this.player.root.getPosition();
        let newY = targetFeetY;
        if (newY > cur.y + maxStep) newY = cur.y + maxStep;
        if (newY < cur.y - maxStep) newY = cur.y - maxStep;
        this.player.root.setPosition(cur.x, newY, cur.z);
      });
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
        void this.map.sampleImportedTerrainY(this.app, p.x, p.z).then((y) => {
          if (y == null || this.phase !== "playing" || !zombie.alive) return;
          const targetFeetY = y + up;
          const cur = zombie.getPosition();
          let newY = targetFeetY;
          if (newY > cur.y + maxStep) newY = cur.y + maxStep;
          if (newY < cur.y - maxStep) newY = cur.y - maxStep;
          zombie.root.setPosition(cur.x, newY, cur.z);
        });
      }
    }
  }

  /**
   * HUD / dev: sample terrain under current XZ and accelerate downward until feet reach that height.
   */
  private beginPlayerGravityDrop(): void {
    if (this.phase !== "playing") return;
    if (!MAP_CONFIG.importVisual.replacesArena || !MAP_CONFIG.importVisual.snapFeetToGround) return;
    if (this.playerGravityDropActive) return;

    const p = this.player.root.getPosition();
    void this.map.sampleImportedTerrainY(this.app, p.x, p.z).then((y) => {
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
    });
  }

  private applyPlayerGravityDrop(dt: number): void {
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

  private attemptWeaponSwap(): void {
    if (this.phase !== "playing") return;
    if (this.player.tryWeaponSwap()) {
      this.audio.play("weaponSwap");
    }
  }

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

  private startRun(): void {
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
    this.inventory.reset("pistol");
    this.player.reset();
    this.player.notifyWeaponInventoryChanged();
    this.waveDirector.reset();
    this.map.reset();

    this.interactions.clear();
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
          : "Click to lock the mouse. WASD to move. R to reload. Q swaps weapons."
        : this.input.isTouchMode()
          ? "Hold Fire. Tap Reload. Walk up to wall buys and tap Use."
          : "Click to lock the mouse. R to reload. E to buy. Q to swap weapons."
    );
    this.hud.setInteractPrompt(null);

    this.menus.hide();
    this.input.requestPointerLockIfNeeded();
    this.renderHud();

    if (MAP_CONFIG.importVisual.replacesArena && MAP_CONFIG.importVisual.snapFeetToGround) {
      void this.map.snapPlayerFeetToImportedGround(this.app, this.player.root).then((ok) => {
        if (ok) {
          this.renderHud();
        }
      });
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

  private makeStats(): RunStats {
    return {
      kills: 0,
      headshots: 0,
      shotsFired: 0,
      shotsHit: 0,
      startTime: performance.now()
    };
  }

  private configureScene(): void {
    this.app.scene.ambientLight = new pc.Color(0.13, 0.1, 0.08);
    this.app.scene.exposure = 1.05;
    this.app.scene.fog.type = pc.FOG_LINEAR;
    if (MAP_CONFIG.importVisual.enabled && MAP_CONFIG.importVisual.replacesArena) {
      this.app.scene.fog.start = 85;
      this.app.scene.fog.end = 780;
    } else if (MAP_CONFIG.importVisual.enabled) {
      this.app.scene.fog.start = 38;
      this.app.scene.fog.end = 210;
    } else {
      this.app.scene.fog.start = 22;
      this.app.scene.fog.end = 70;
    }
    this.app.scene.fog.color = new pc.Color(0.04, 0.03, 0.04);

    const sun = new pc.Entity("sun");
    sun.addComponent("light", {
      type: "directional",
      castShadows: false,
      color: new pc.Color(0.7, 0.4, 0.22),
      intensity: 0.45
    });
    sun.setEulerAngles(58, 32, 0);
    this.app.root.addChild(sun);
  }

  private targetPixelRatio(): number {
    if (window.matchMedia("(pointer: coarse)").matches) {
      return Math.min(window.devicePixelRatio, 1.3);
    }
    return Math.min(window.devicePixelRatio, 1.8);
  }
}

void WEAPON_DEFINITIONS;
