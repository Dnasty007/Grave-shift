import { GAME_CONFIG } from "./config";

export type SettingsState = {
  mouseSensitivity: number;
  touchSensitivity: number;
  /** Right-stick look scale when a gamepad is steering (1 = same baseline as mouse multiplier). */
  gamepadLookSensitivity: number;
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
  /**
   * Desktop: press C to toggle first / third person (ignored in touch UI mode).
   */
  allowThirdPersonToggle: boolean;
  /** Rule-based friendly shooter (not an LLM). See Settings → AI squadmate. */
  aiAllyEnabled: boolean;
};

const STORAGE_KEY = "project-gehenna.settings.v1";
const LEGACY_STORAGE_KEYS = [
  "lazarus-protocol.settings.v1",
  "grave-shift.settings.v1"
] as const;

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
      gamepadLookSensitivity: 1,
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
      importMeshCollision: true,
      allowThirdPersonToggle: true,
      aiAllyEnabled: false
    };
  }

  private load(): SettingsState {
    const defaults = this.defaults();

    try {
      let raw = window.localStorage.getItem(STORAGE_KEY);
      let fromLegacy = false;
      if (!raw) {
        for (const key of LEGACY_STORAGE_KEYS) {
          raw = window.localStorage.getItem(key);
          if (raw) {
            fromLegacy = true;
            break;
          }
        }
      }
      if (!raw) {
        return defaults;
      }
      const parsed = JSON.parse(raw) as Partial<SettingsState>;
      const merged = { ...defaults, ...parsed };
      if (fromLegacy) {
        try {
          for (const key of LEGACY_STORAGE_KEYS) {
            window.localStorage.removeItem(key);
          }
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
        } catch {
          /* ignore */
        }
      }
      return merged;
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
