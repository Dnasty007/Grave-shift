import { GAME_CONFIG } from "./config";

export type SettingsState = {
  mouseSensitivity: number;
  touchSensitivity: number;
  invertY: boolean;
  fov: number;
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  screenShake: boolean;
  damageVignette: boolean;
  bloodFx: boolean;
  showHitMarker: boolean;
  /** Multiplier on GAME_CONFIG.player.sprintSpeed (slider 50%–200%). */
  sprintSpeedMultiplier: number;
  /** Fly mode: hold V / Ctrl (Space = jump); skips terrain cling and gravity drop. */
  flyMode: boolean;
  /** Skip CollisionWorld + imported mesh collision; ignore terrain cling helpers. */
  noclip: boolean;
  /** When imported map replaces arena, block player with horizontal mesh raycasts. */
  importMeshCollision: boolean;
};

const STORAGE_KEY = "grave-shift.settings.v1";

export type SettingsListener = (state: SettingsState) => void;

export class Settings {
  private state: SettingsState;
  private readonly listeners = new Set<SettingsListener>();

  constructor() {
    this.state = this.load();
  }

  get(): SettingsState {
    return { ...this.state };
  }

  update(patch: Partial<SettingsState>): void {
    this.state = { ...this.state, ...patch };
    this.persist();
    for (const listener of this.listeners) {
      listener(this.get());
    }
  }

  resetToDefaults(): void {
    this.state = this.defaults();
    this.persist();
    for (const listener of this.listeners) {
      listener(this.get());
    }
  }

  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    listener(this.get());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private defaults(): SettingsState {
    return {
      mouseSensitivity: 1,
      touchSensitivity: 1,
      invertY: false,
      fov: 78,
      masterVolume: GAME_CONFIG.audio.defaultMaster,
      sfxVolume: GAME_CONFIG.audio.defaultSfx,
      musicVolume: GAME_CONFIG.audio.defaultMusic,
      screenShake: true,
      damageVignette: true,
      bloodFx: true,
      showHitMarker: true,
      sprintSpeedMultiplier: 1,
      flyMode: false,
      noclip: false,
      importMeshCollision: true
    };
  }

  private load(): SettingsState {
    const defaults = this.defaults();

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return defaults;
      }
      const parsed = JSON.parse(raw) as Partial<SettingsState>;
      return { ...defaults, ...parsed };
    } catch {
      return defaults;
    }
  }

  private persist(): void {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
    } catch {
      // ignore storage failures
    }
  }
}
