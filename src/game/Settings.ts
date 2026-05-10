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
      showHitMarker: true
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
