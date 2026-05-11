import type { Settings, SettingsState } from "./Settings";
import type { MapPresetId } from "./config";
import {
  LOBBY_MAP_ENTRIES,
  LOBBY_PLAYER_ORDER,
  PLAYER_MODEL_PRESETS,
  type PlayerModelId
} from "./runSession";

export type GameOverStats = {
  wave: number;
  points: number;
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  survivedSeconds: number;
};

export type BeginRunSelection = {
  mapId: MapPresetId;
  playerId: PlayerModelId;
};

export type MenuCallbacks = {
  onBeginRun: (selection: BeginRunSelection) => void;
  onResume: () => void;
  onRestart: () => void;
  onReturnToTitle: () => void;
  onPauseToggleRequested: () => void;
};

type MenuName =
  | "title"
  | "mapSelect"
  | "playerSelect"
  | "pause"
  | "settings"
  | "controls"
  | "gameOver"
  | "none";

export class MenuController {
  private readonly root: HTMLElement;
  private readonly settings: Settings;
  private readonly callbacks: MenuCallbacks;
  private readonly settingsBackTarget: { current: "pause" | "title" } = { current: "title" };

  private readonly screens: Record<Exclude<MenuName, "none">, HTMLElement>;
  private currentScreen: MenuName = "none";

  /** Map chosen on the lobby flow (player screen needs it for `onBeginRun`). */
  private pendingMapId: MapPresetId = "castle";

  constructor(root: HTMLElement, settings: Settings, callbacks: MenuCallbacks) {
    this.root = root;
    this.settings = settings;
    this.callbacks = callbacks;

    const titleScreen = root.querySelector<HTMLElement>("#title-screen");
    const mapSelectScreen = root.querySelector<HTMLElement>("#map-select-screen");
    const playerSelectScreen = root.querySelector<HTMLElement>("#player-select-screen");
    const pauseScreen = root.querySelector<HTMLElement>("#pause-screen");
    const settingsScreen = root.querySelector<HTMLElement>("#settings-screen");
    const controlsScreen = root.querySelector<HTMLElement>("#controls-screen");
    const gameOverScreen = root.querySelector<HTMLElement>("#game-over-screen");

    if (
      !titleScreen ||
      !mapSelectScreen ||
      !playerSelectScreen ||
      !pauseScreen ||
      !settingsScreen ||
      !controlsScreen ||
      !gameOverScreen
    ) {
      throw new Error("MenuController: menu screens missing.");
    }

    this.screens = {
      title: titleScreen,
      mapSelect: mapSelectScreen,
      playerSelect: playerSelectScreen,
      pause: pauseScreen,
      settings: settingsScreen,
      controls: controlsScreen,
      gameOver: gameOverScreen
    };

    this.populateLobbyCards();
    this.bindMenuButtons();
    this.bindSettingsControls();

    settings.subscribe((state) => this.syncSettingsUI(state));
  }

  private populateLobbyCards(): void {
    const mapHost = this.root.querySelector<HTMLElement>("#lobby-map-cards");
    const playerHost = this.root.querySelector<HTMLElement>("#lobby-player-cards");
    if (!mapHost || !playerHost) return;

    mapHost.replaceChildren();
    for (const m of LOBBY_MAP_ENTRIES) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lobby-card";
      btn.dataset.mapId = m.id;
      btn.innerHTML = `
        <div class="lobby-card-visual"><img src="${m.previewUrl}" alt="" loading="lazy" /></div>
        <div class="lobby-card-body">
          <h3 class="lobby-card-title">${m.title}</h3>
          <p class="lobby-card-desc">${m.description}</p>
          <span class="lobby-card-cta">Select</span>
        </div>`;
      mapHost.appendChild(btn);
    }

    playerHost.replaceChildren();
    for (const id of LOBBY_PLAYER_ORDER) {
      const p = PLAYER_MODEL_PRESETS[id];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "lobby-card";
      btn.dataset.playerId = id;
      btn.innerHTML = `
        <div class="lobby-card-visual"><img src="${p.previewUrl}" alt="" loading="lazy" /></div>
        <div class="lobby-card-body">
          <h3 class="lobby-card-title">${p.label}</h3>
          <p class="lobby-card-desc">${p.description}</p>
          <span class="lobby-card-cta">Deploy</span>
        </div>`;
      playerHost.appendChild(btn);
    }
  }

  showTitle(): void {
    this.show("title");
  }

  showPause(): void {
    this.show("pause");
  }

  showGameOver(stats: GameOverStats): void {
    const accuracy =
      stats.shotsFired > 0 ? Math.round((stats.shotsHit / stats.shotsFired) * 100) : 0;
    const minutes = Math.floor(stats.survivedSeconds / 60);
    const seconds = Math.floor(stats.survivedSeconds % 60);

    const map: Record<string, string> = {
      "go-wave": `${stats.wave}`,
      "go-points": `${stats.points}`,
      "go-kills": `${stats.kills}`,
      "go-headshots": `${stats.headshots}`,
      "go-accuracy": `${accuracy}%`,
      "go-time": `${minutes}:${seconds.toString().padStart(2, "0")}`
    };

    for (const [id, value] of Object.entries(map)) {
      const node = this.root.querySelector<HTMLElement>(`#${id}`);
      if (node) node.textContent = value;
    }

    this.show("gameOver");
  }

  hide(): void {
    this.show("none");
  }

  isOpen(): boolean {
    return this.currentScreen !== "none";
  }

  isBlockingPause(): boolean {
    return (
      this.currentScreen === "pause" ||
      this.currentScreen === "settings" ||
      this.currentScreen === "controls" ||
      this.currentScreen === "mapSelect" ||
      this.currentScreen === "playerSelect"
    );
  }

  private show(name: MenuName): void {
    this.currentScreen = name;
    document.body.classList.toggle("menu-open", name !== "none");
    document.body.dataset.menu = name;

    for (const [key, screen] of Object.entries(this.screens)) {
      screen.classList.toggle("is-visible", key === name);
      screen.setAttribute("aria-hidden", key === name ? "false" : "true");
    }
  }

  private bindMenuButtons(): void {
    const bind = (id: string, handler: () => void) => {
      const element = this.root.querySelector<HTMLButtonElement>(`#${id}`);
      if (!element) return;
      element.addEventListener("click", () => handler());
    };

    bind("btn-start", () => {
      this.show("mapSelect");
    });

    const mapScreen = this.root.querySelector<HTMLElement>("#map-select-screen");
    if (mapScreen) {
      mapScreen.addEventListener("click", (e) => {
        const t = (e.target as HTMLElement).closest("[data-map-id]");
        if (!t || !(t instanceof HTMLElement)) return;
        const id = t.dataset.mapId as MapPresetId | undefined;
        if (!id) return;
        this.pendingMapId = id;
        this.show("playerSelect");
      });
    }

    const playerScreen = this.root.querySelector<HTMLElement>("#player-select-screen");
    if (playerScreen) {
      playerScreen.addEventListener("click", (e) => {
        const t = (e.target as HTMLElement).closest("[data-player-id]");
        if (!t || !(t instanceof HTMLElement)) return;
        const id = t.dataset.playerId as PlayerModelId | undefined;
        if (!id) return;
        this.callbacks.onBeginRun({ mapId: this.pendingMapId, playerId: id });
        this.hide();
      });
    }

    bind("btn-lobby-map-back", () => this.show("title"));
    bind("btn-lobby-player-back", () => this.show("mapSelect"));
    bind("btn-title-settings", () => {
      this.settingsBackTarget.current = "title";
      this.show("settings");
    });
    bind("btn-title-controls", () => {
      this.show("controls");
    });

    bind("btn-resume", () => {
      this.callbacks.onResume();
      this.hide();
    });
    bind("btn-pause-settings", () => {
      this.settingsBackTarget.current = "pause";
      this.show("settings");
    });
    bind("btn-pause-controls", () => {
      this.show("controls");
    });
    bind("btn-pause-restart", () => {
      this.callbacks.onRestart();
      this.hide();
    });
    bind("btn-pause-title", () => {
      this.callbacks.onReturnToTitle();
      this.show("title");
    });

    bind("btn-settings-back", () => {
      if (this.settingsBackTarget.current === "title") {
        this.show("title");
      } else {
        this.show("pause");
      }
    });
    bind("btn-settings-reset", () => {
      this.settings.resetToDefaults();
    });

    bind("btn-controls-back", () => {
      if (this.settingsBackTarget.current === "title") {
        this.show("title");
      } else {
        this.show("pause");
      }
    });

    bind("btn-game-over-restart", () => {
      this.callbacks.onRestart();
      this.hide();
    });
    bind("btn-game-over-title", () => {
      this.callbacks.onReturnToTitle();
      this.show("title");
    });
  }

  private bindSettingsControls(): void {
    const slider = (id: string, key: keyof SettingsState, scale = 1) => {
      const input = this.root.querySelector<HTMLInputElement>(`#${id}`);
      if (!input) return;
      input.addEventListener("input", () => {
        const value = parseFloat(input.value) / scale;
        this.settings.update({ [key]: value } as Partial<SettingsState>);
        this.updateSliderLabel(id, value);
      });
    };

    slider("setting-mouse-sens", "mouseSensitivity", 100);
    slider("setting-touch-sens", "touchSensitivity", 100);
    slider("setting-fov", "fov");
    slider("setting-master", "masterVolume", 100);
    slider("setting-sfx", "sfxVolume", 100);
    slider("setting-music", "musicVolume", 100);
    slider("setting-sprint-mult", "sprintSpeedMultiplier", 100);

    const toggle = (id: string, key: keyof SettingsState) => {
      const input = this.root.querySelector<HTMLInputElement>(`#${id}`);
      if (!input) return;
      input.addEventListener("change", () => {
        this.settings.update({ [key]: input.checked } as Partial<SettingsState>);
      });
    };

    toggle("setting-invert-y", "invertY");
    toggle("setting-shake", "screenShake");
    toggle("setting-vignette", "damageVignette");
    toggle("setting-blood", "bloodFx");
    toggle("setting-hitmarker", "showHitMarker");
    toggle("setting-fly-mode", "flyMode");
    toggle("setting-noclip", "noclip");
    toggle("setting-import-mesh-collision", "importMeshCollision");
    toggle("setting-third-person-toggle", "allowThirdPersonToggle");
    toggle("setting-ai-ally", "aiAllyEnabled");
  }

  private syncSettingsUI(state: SettingsState): void {
    const setSlider = (id: string, value: number, scale = 1) => {
      const input = this.root.querySelector<HTMLInputElement>(`#${id}`);
      if (input) {
        input.value = `${value * scale}`;
        this.updateSliderLabel(id, value);
      }
    };

    setSlider("setting-mouse-sens", state.mouseSensitivity, 100);
    setSlider("setting-touch-sens", state.touchSensitivity, 100);
    setSlider("setting-fov", state.fov);
    setSlider("setting-master", state.masterVolume, 100);
    setSlider("setting-sfx", state.sfxVolume, 100);
    setSlider("setting-music", state.musicVolume, 100);
    setSlider("setting-sprint-mult", state.sprintSpeedMultiplier, 100);

    const setToggle = (id: string, value: boolean) => {
      const input = this.root.querySelector<HTMLInputElement>(`#${id}`);
      if (input) input.checked = value;
    };

    setToggle("setting-invert-y", state.invertY);
    setToggle("setting-shake", state.screenShake);
    setToggle("setting-vignette", state.damageVignette);
    setToggle("setting-blood", state.bloodFx);
    setToggle("setting-hitmarker", state.showHitMarker);
    setToggle("setting-fly-mode", state.flyMode);
    setToggle("setting-noclip", state.noclip);
    setToggle("setting-import-mesh-collision", state.importMeshCollision);
    setToggle("setting-third-person-toggle", state.allowThirdPersonToggle);
    setToggle("setting-ai-ally", state.aiAllyEnabled);
  }

  private updateSliderLabel(id: string, value: number): void {
    const label = this.root.querySelector<HTMLElement>(`#${id}-value`);
    if (!label) return;

    if (id === "setting-sprint-mult") {
      label.textContent = `${Math.round(value * 100)}%`;
      return;
    }

    if (id === "setting-fov") {
      label.textContent = `${Math.round(value)}°`;
      return;
    }

    if (id.includes("master") || id.includes("sfx") || id.includes("music")) {
      label.textContent = `${Math.round(value * 100)}%`;
      return;
    }

    label.textContent = `${value.toFixed(2)}x`;
  }
}
