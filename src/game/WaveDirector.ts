import * as pc from "playcanvas";
import { GAME_CONFIG } from "./config";

type SpawnRequest = {
  position: pc.Vec3;
  wave: number;
  health: number;
  speed: number;
};

type SpawnPicker = (playerPosition: pc.Vec3) => pc.Vec3 | null;

type WaveCallbacks = {
  onSpawn: (request: SpawnRequest) => void;
  onWaveStarted: (wave: number) => void;
  onWaveCleared: (wave: number) => void;
  onIntermission: (wave: number, seconds: number) => void;
};

/**
 * Wave scheduler: intermission countdown → spawn quota per wave → clears when all dead.
 * Spawn **positions** come from `Map.pickRandomActiveSpawnPosition` via injected `spawnPicker`.
 */
export class WaveDirector {
  currentWave = 0;

  private queuedSpawns = 0;
  private intermission = 1.8;
  private spawnCooldown = 0;
  private waveActive = false;
  private readonly callbacks: WaveCallbacks;
  private readonly spawnPicker: SpawnPicker;

  constructor(_arenaSize: number, callbacks: WaveCallbacks, spawnPicker: SpawnPicker) {
    this.callbacks = callbacks;
    this.spawnPicker = spawnPicker;
  }

  reset(): void {
    this.currentWave = 0;
    this.queuedSpawns = 0;
    this.intermission = 1.8;
    this.spawnCooldown = 0;
    this.waveActive = false;
  }

  // --- Wave tick: intermission HUD → staggered spawns → wave cleared detection ---

  update(dt: number, activeZombieCount: number, playerPosition: pc.Vec3): void {
    this.spawnCooldown = Math.max(0, this.spawnCooldown - dt);

    if (this.intermission > 0) {
      this.intermission = Math.max(0, this.intermission - dt);
      this.callbacks.onIntermission(
        this.currentWave,
        Math.max(1, Math.ceil(this.intermission))
      );

      if (this.intermission === 0) {
        this.startWave();
      }

      return;
    }

    let attempts = 0;
    while (
      this.queuedSpawns > 0 &&
      activeZombieCount < GAME_CONFIG.waves.maxAliveAtOnce &&
      this.spawnCooldown === 0 &&
      attempts < 4
    ) {
      attempts += 1;

      const position = this.spawnPicker(playerPosition);
      if (!position) {
        break;
      }

      this.queuedSpawns -= 1;
      this.spawnCooldown = 0.45;

      this.callbacks.onSpawn({
        position,
        wave: this.currentWave,
        health:
          GAME_CONFIG.zombie.baseHealth +
          (this.currentWave - 1) * GAME_CONFIG.zombie.healthPerWave,
        speed:
          GAME_CONFIG.zombie.baseSpeed +
          (this.currentWave - 1) * GAME_CONFIG.zombie.speedPerWave
      });
    }

    if (this.waveActive && this.queuedSpawns === 0 && activeZombieCount === 0) {
      this.waveActive = false;
      this.callbacks.onWaveCleared(this.currentWave);
      this.intermission = GAME_CONFIG.waveIntermissionSeconds;
    }
  }

  getQueuedSpawns(): number {
    return this.queuedSpawns;
  }

  getIntermissionSeconds(): number {
    return Math.max(0, Math.ceil(this.intermission));
  }

  private startWave(): void {
    this.currentWave += 1;
    this.queuedSpawns =
      GAME_CONFIG.waves.startingCount +
      (this.currentWave - 1) * GAME_CONFIG.waves.additionalPerWave;
    this.spawnCooldown = 0;
    this.waveActive = true;
    this.callbacks.onWaveStarted(this.currentWave);
  }
}
