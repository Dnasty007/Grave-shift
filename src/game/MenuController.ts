import type { Settings, SettingsState } from "./Settings";

export type GameOverStats = {
  wave: number;
  points: number;
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  survivedSeconds: number;
};

export type MenuCallbacks = {
  onStart: () => void;
  onResume: () => void;
  onRestart: () => void;
  onReturnToTitle: () => void;
  onPauseToggleRequested: () => void;
};

type MenuName = "title" | "pause" | "settings" | "controls" | "gameOver" | "none";

export class MenuController {
  private readonly root: HTMLElement;
  private readonly settings: Settings;
  private readonly callbacks: MenuCallbacks;
  private readonly settingsBackTarget: { current: "pause" | "title" } = { current: "title" };

  private readonly screens: Record<Exclude<MenuName, "none">, HTMLElement>;
  private currentScreen: MenuName = "none";

  constructor(root: HTMLElement, settings: Settings, callbacks: MenuCallbacks) {
    this.root = root;
    this.settings = settings;
    this.callbacks = callbacks;

    const titleScreen = root.querySelector<HTMLElement>("#title-screen");
    const pauseScreen = root.querySelector<HTMLElement>("#pause-screen");
    const settingsScreen = root.querySelector<HTMLElement>("#settings-screen");
    const controlsScreen = root.querySelector<HTMLElement>("#controls-screen");
    const gameOverScreen = root.querySelector<HTMLElement>("#game-over-screen");

    if (!titleScreen || !pauseScreen || !settingsScreen || !controlsScreen || !gameOverScreen) {
      throw new Error("MenuController: menu screens missing.");
    }

    this.screens = {
      title: titleScreen,
      pause: pauseScreen,
      settings: settingsScreen,
      controls: controlsScreen,
      gameOver: gameOverScreen
    };

    this.bindMenuButtons();
    this.bindSettingsControls();

    settings.subscribe((state) => this.syncSettingsUI(state));
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
    return this.currentScreen === "pause" || this.currentScreen === "settings" || this.currentScreen === "controls";
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
      this.callbacks.onStart();
      this.hide();
    });
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

    const setToggle = (id: string, value: boolean) => {
      const input = this.root.querySelector<HTMLInputElement>(`#${id}`);
      if (input) input.checked = value;
    };

    setToggle("setting-invert-y", state.invertY);
    setToggle("setting-shake", state.screenShake);
    setToggle("setting-vignette", state.damageVignette);
    setToggle("setting-blood", state.bloodFx);
    setToggle("setting-hitmarker", state.showHitMarker);
  }

  private updateSliderLabel(id: string, value: number): void {
    const label = this.root.querySelector<HTMLElement>(`#${id}-value`);
    if (!label) return;

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
