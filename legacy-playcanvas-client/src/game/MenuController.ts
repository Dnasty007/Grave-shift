import type { Settings, SettingsState } from "./Settings";
import type { MapPresetId } from "./config";
import {
  LOBBY_MAP_ENTRIES,
  LOBBY_PLAYER_ORDER,
  PLAYER_MODEL_PRESETS,
  type PlayerModelId
} from "./runSession";
import {
  LoadoutStore,
  MAX_LOADOUTS,
  SPECIAL_ABILITY_META,
  MOD_META,
  MOD_SHOP_PRICES,
  PRIMARY_META,
  LETHAL_META,
  type LoadoutData,
  type SpecialAbilityId,
  type ModId,
  type StarterPistolId,
  type LethalId
} from "./LoadoutStore";
import { PlayerAccount, type RunReward, getXpForCurrentLevel, getLevelForXp } from "./PlayerAccount";
import type { AudioEngine } from "./AudioEngine";
import { HYTOPIA_GUN_DEFINITIONS, HYTOPIA_MELEE_DEFINITIONS } from "./hytopiaWeaponDefs";

export type { LoadoutData };

export type GameOverStats = {
  wave: number;
  points: number;
  kills: number;
  headshots: number;
  shotsFired: number;
  shotsHit: number;
  survivedSeconds: number;
  reward?: RunReward;
};

export type BeginRunSelection = {
  mapId: MapPresetId;
  playerId: PlayerModelId;
  loadout: LoadoutData;
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
  | "modShop"
  | "pause"
  | "settings"
  | "controls"
  | "gameOver"
  | "none";

export class MenuController {
  private readonly root: HTMLElement;
  private readonly settings: Settings;
  private readonly account: PlayerAccount;
  private readonly callbacks: MenuCallbacks;
  private readonly audio: AudioEngine | null;
  private readonly settingsBackTarget: { current: "pause" | "title" } = { current: "title" };

  private readonly screens: Record<Exclude<MenuName, "none">, HTMLElement>;
  private currentScreen: MenuName = "none";

  /** Map chosen on the lobby flow. */
  private pendingMapId: MapPresetId = "castle";

  /** Operative chosen on the player select screen. */
  private pendingPlayerId: PlayerModelId | null = null;

  /** Loadout slot currently being edited. */
  private activeLoadoutId = 0;

  /** Persistent loadout store (localStorage-backed). */
  private readonly loadoutStore = new LoadoutStore();

  constructor(
    root: HTMLElement,
    settings: Settings,
    account: PlayerAccount,
    callbacks: MenuCallbacks,
    audio: AudioEngine | null = null
  ) {
    this.root = root;
    this.settings = settings;
    this.account = account;
    this.callbacks = callbacks;
    this.audio = audio;

    const titleScreen = root.querySelector<HTMLElement>("#title-screen");
    const mapSelectScreen = root.querySelector<HTMLElement>("#map-select-screen");
    const playerSelectScreen = root.querySelector<HTMLElement>("#player-select-screen");
    const modShopScreen = root.querySelector<HTMLElement>("#mod-shop-screen");
    const pauseScreen = root.querySelector<HTMLElement>("#pause-screen");
    const settingsScreen = root.querySelector<HTMLElement>("#settings-screen");
    const controlsScreen = root.querySelector<HTMLElement>("#controls-screen");
    const gameOverScreen = root.querySelector<HTMLElement>("#game-over-screen");

    if (
      !titleScreen ||
      !mapSelectScreen ||
      !playerSelectScreen ||
      !modShopScreen ||
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
      modShop: modShopScreen,
      pause: pauseScreen,
      settings: settingsScreen,
      controls: controlsScreen,
      gameOver: gameOverScreen
    };

    this.populateLobbyCards();
    this.bindMenuButtons();
    this.bindLoadoutPanel();
    this.bindSettingsControls();
    this.bindModShop();

    settings.subscribe((state) => this.syncSettingsUI(state));
  }

  // ── Lobby card population ──────────────────────────────────────────────────

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

    // Active operatives
    for (const id of LOBBY_PLAYER_ORDER) {
      const p = PLAYER_MODEL_PRESETS[id];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "operative-card";
      btn.dataset.playerId = id;
      btn.setAttribute("aria-pressed", "false");
      btn.innerHTML = `
        <div class="operative-card-portrait">
          <img src="${p.previewUrl}" alt="" loading="lazy" />
          <div class="operative-card-portrait-overlay"></div>
          <span class="operative-card-status-badge operative-card-status-badge--live">ACTIVE</span>
        </div>
        <div class="operative-card-info">
          <p class="operative-card-role">FIELD OPERATIVE</p>
          <h3 class="operative-card-name">${p.label}</h3>
          <p class="operative-card-desc">${p.description}</p>
          <span class="operative-card-cta">Select</span>
        </div>`;
      playerHost.appendChild(btn);
    }

    // Classified (coming-soon) operatives
    const classifiedSlots = [
      { codename: "GHOST-7",    role: "RECON SPECIALIST",  clearance: "LEVEL 4" },
      { codename: "WRAITH",     role: "HEAVY ASSAULT",     clearance: "LEVEL 5" },
      { codename: "BANSHEE",    role: "SUPPORT MEDIC",     clearance: "LEVEL 5" },
      { codename: "PHANTOM-X",  role: "STEALTH OPERATIVE", clearance: "LEVEL 6" },
    ];

    for (const slot of classifiedSlots) {
      const div = document.createElement("div");
      div.className = "operative-card operative-card--classified";
      div.setAttribute("aria-hidden", "true");
      div.innerHTML = `
        <div class="operative-card-portrait operative-card-portrait--classified">
          <div class="operative-card-classified-fill"></div>
          <span class="operative-card-classified-stamp">CLASSIFIED</span>
          <span class="operative-card-status-badge operative-card-status-badge--classified">LOCKED</span>
        </div>
        <div class="operative-card-info">
          <p class="operative-card-role">${slot.role}</p>
          <h3 class="operative-card-name operative-card-name--redacted">${slot.codename}</h3>
          <p class="operative-card-clearance">CLEARANCE: ${slot.clearance}</p>
          <span class="operative-card-cta operative-card-cta--classified">COMING SOON</span>
        </div>`;
      playerHost.appendChild(div);
    }
  }

  // ── Menu navigation ────────────────────────────────────────────────────────

  private sfxUiClick(): void {
    this.audio?.unlock();
    this.audio?.play("uiClick");
  }

  private sfxDeploy(): void {
    this.audio?.unlock();
    this.audio?.play("weaponBuy");
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

    // Reward panel — XP + souls + level
    if (stats.reward) {
      this.animateRunReward(stats.reward);
    }
  }

  private animateRunReward(reward: RunReward): void {
    const r = reward;

    // Populate static text
    const setText = (id: string, val: string) => {
      const el = this.root.querySelector<HTMLElement>(`#${id}`);
      if (el) el.textContent = val;
    };

    setText("go-xp-gained", `+${r.xpGained.toLocaleString()} XP`);
    setText("go-souls-gained", `+${r.soulsGained.toLocaleString()} Souls`);
    setText("go-souls-total", `${r.newTotalSouls.toLocaleString()} Souls`);
    setText("go-level-before", `LVL ${r.levelBefore}`);
    setText("go-level-after", `LVL ${r.levelAfter}`);

    // Level-up badge
    const badge = this.root.querySelector<HTMLElement>("#go-levelup-badge");
    if (badge) badge.classList.toggle("is-visible", r.didLevelUp);

    // XP progress bar — start from level-before percentage
    const barFill = this.root.querySelector<HTMLElement>("#go-xp-bar-fill");
    if (!barFill) return;

    // Where were we in the level before the run?
    const xpBefore = r.newTotalXp - r.xpGained;
    const { current: curBefore, needed: neededBefore } = getXpForCurrentLevel(xpBefore);
    const { current: curAfter, needed: neededAfter } = getXpForCurrentLevel(r.newTotalXp);

    const startPct = r.didLevelUp ? 0 : curBefore / neededBefore;
    const endPct = curAfter / neededAfter;

    // Reset bar then animate after a short delay
    barFill.style.transition = "none";
    barFill.style.width = `${startPct * 100}%`;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        barFill.style.transition = "width 1.4s cubic-bezier(0.22, 1, 0.36, 1)";
        barFill.style.width = `${endPct * 100}%`;
      });
    });
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
      this.currentScreen === "playerSelect" ||
      this.currentScreen === "modShop"
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

    // Reset operative selection when leaving player select
    if (name !== "playerSelect") {
      this.resetOperativeSelection();
    }
  }

  // ── Menu button bindings ───────────────────────────────────────────────────

  private bindMenuButtons(): void {
    const bind = (
      id: string,
      handler: () => void,
      kind: "click" | "deploy" | "none" = "click"
    ) => {
      const element = this.root.querySelector<HTMLButtonElement>(`#${id}`);
      if (!element) return;
      element.addEventListener("click", () => {
        if (kind === "click") this.sfxUiClick();
        else if (kind === "deploy") this.sfxDeploy();
        handler();
      });
    };

    bind("btn-start", () => {
      this.show("mapSelect");
    });

    // Map select: click a map card → go to player select
    const mapScreen = this.root.querySelector<HTMLElement>("#map-select-screen");
    if (mapScreen) {
      mapScreen.addEventListener("click", (e) => {
        const t = (e.target as HTMLElement).closest("[data-map-id]");
        if (!t || !(t instanceof HTMLElement)) return;
        const id = t.dataset.mapId as MapPresetId | undefined;
        if (!id) return;
        this.sfxUiClick();
        this.pendingMapId = id;
        this.show("playerSelect");
      });
    }

    // Player select: click a player card → set active operative + open loadout panel
    const playerScreen = this.root.querySelector<HTMLElement>("#player-select-screen");
    if (playerScreen) {
      playerScreen.addEventListener("click", (e) => {
        const t = (e.target as HTMLElement).closest("[data-player-id]");
        if (!t || !(t instanceof HTMLElement)) return;
        const id = t.dataset.playerId as PlayerModelId | undefined;
        if (!id) return;
        this.sfxUiClick();
        this.setActiveOperative(id);
      });
    }

    // Deploy button
    bind("btn-deploy", () => {
      if (!this.pendingPlayerId) return;
      this.sfxDeploy();
      const loadout = this.loadoutStore.get(this.activeLoadoutId);
      this.callbacks.onBeginRun({
        mapId: this.pendingMapId,
        playerId: this.pendingPlayerId,
        loadout
      });
      this.hide();
    }, "none");

    bind("btn-lobby-map-back", () => this.show("title"));
    bind("btn-lobby-player-back", () => this.show("mapSelect"));
    bind("btn-title-settings", () => {
      this.settingsBackTarget.current = "title";
      this.show("settings");
    });
    bind("btn-title-controls", () => {
      this.show("controls");
    });
    bind("btn-title-mod-shop", () => {
      this.renderModShop();
      this.show("modShop");
    });
    bind("btn-mod-shop-back", () => this.show("title"));
    bind("btn-go-mod-shop", () => {
      this.renderModShop();
      this.show("modShop");
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

    // ── Player Stats Panel ──────────────────────────────────────────────────
    const statsPanel = this.root.querySelector<HTMLElement>("#player-stats-panel");
    const statsOpenBtn = this.root.querySelector<HTMLButtonElement>("#btn-open-stats");
    const statsCloseBtn = this.root.querySelector<HTMLButtonElement>("#btn-close-stats");

    const openStatsPanel = () => {
      if (!statsPanel) return;
      this.sfxUiClick();
      this.populateStatsPanel();
      statsPanel.classList.add("is-open");
      statsPanel.setAttribute("aria-hidden", "false");
    };

    const closeStatsPanel = () => {
      if (!statsPanel) return;
      this.sfxUiClick();
      statsPanel.classList.remove("is-open");
      statsPanel.setAttribute("aria-hidden", "true");
    };

    statsOpenBtn?.addEventListener("click", openStatsPanel);
    statsCloseBtn?.addEventListener("click", closeStatsPanel);

    // Click the dimmed backdrop behind the drawer to close
    statsPanel?.querySelector(".psp-backdrop")?.addEventListener("click", closeStatsPanel);
  }

  // ── Operative selection ────────────────────────────────────────────────────

  private setActiveOperative(id: PlayerModelId): void {
    this.pendingPlayerId = id;

    // Update card selected states
    const cards = this.root.querySelectorAll<HTMLElement>("#lobby-player-cards .operative-card");
    for (const card of cards) {
      const isThis = card.dataset.playerId === id;
      card.classList.toggle("is-selected", isThis);
      card.setAttribute("aria-pressed", isThis ? "true" : "false");
      const cta = card.querySelector<HTMLElement>(".operative-card-cta");
      if (cta) cta.textContent = isThis ? "✓ Selected" : "Select";
    }

    // Show the loadout panel
    const layout = this.root.querySelector<HTMLElement>("#operative-select-layout");
    if (layout) layout.classList.add("loadout-open");
    const panel = this.root.querySelector<HTMLElement>("#loadout-panel");
    if (panel) panel.setAttribute("aria-hidden", "false");

    // Show selected info in sidebar
    this.syncDeploySidebar();

    // Enable deploy button
    const deployBtn = this.root.querySelector<HTMLButtonElement>("#btn-deploy");
    if (deployBtn) deployBtn.disabled = false;

    // Render the loadout panel tabs + editor for the current slot
    this.renderLoadoutTabs();
    this.renderLoadoutEditor();
  }

  private resetOperativeSelection(): void {
    this.pendingPlayerId = null;

    const cards = this.root.querySelectorAll<HTMLElement>("#lobby-player-cards .operative-card");
    for (const card of cards) {
      card.classList.remove("is-selected");
      card.setAttribute("aria-pressed", "false");
      const cta = card.querySelector<HTMLElement>(".operative-card-cta");
      if (cta) cta.textContent = "Select";
    }

    const layout = this.root.querySelector<HTMLElement>("#operative-select-layout");
    if (layout) layout.classList.remove("loadout-open");
    const panel = this.root.querySelector<HTMLElement>("#loadout-panel");
    if (panel) panel.setAttribute("aria-hidden", "true");

    const deployBtn = this.root.querySelector<HTMLButtonElement>("#btn-deploy");
    if (deployBtn) deployBtn.disabled = true;

    const info = this.root.querySelector<HTMLElement>("#operative-selected-info");
    if (info) info.classList.remove("is-visible");
  }

  private syncDeploySidebar(): void {
    const info = this.root.querySelector<HTMLElement>("#operative-selected-info");
    const nameEl = this.root.querySelector<HTMLElement>("#operative-selected-name");
    const loadoutEl = this.root.querySelector<HTMLElement>("#operative-selected-loadout");

    if (!this.pendingPlayerId) return;

    const preset = PLAYER_MODEL_PRESETS[this.pendingPlayerId];
    const loadout = this.loadoutStore.get(this.activeLoadoutId);

    if (info) info.classList.add("is-visible");
    if (nameEl) nameEl.textContent = preset.label.toUpperCase();
    if (loadoutEl) {
      const abilityLabel = loadout.specialAbility
        ? SPECIAL_ABILITY_META[loadout.specialAbility].label
        : null;
      const modLabel = loadout.mod ? MOD_META[loadout.mod].label : null;
      const parts = [loadout.name, abilityLabel, modLabel].filter(Boolean);
      loadoutEl.textContent = parts.join(" · ");
    }
  }

  // ── Player Stats Panel ────────────────────────────────────────────────────

  private populateStatsPanel(): void {
    const qEl = (id: string) => this.root.querySelector<HTMLElement>(`#${id}`);
    const qSvg = (id: string) => this.root.querySelector<SVGCircleElement>(`#${id}`);

    const set = (id: string, val: string) => {
      const el = qEl(id);
      if (el) el.textContent = val;
    };

    // Level + XP progress
    const level = this.account.level;
    const { current, needed } = this.account.xpProgress;
    const pct = needed > 0 ? current / needed : 0;
    const circumference = 2 * Math.PI * 34; // r=34 → ≈213.6

    set("psp-level-num", String(level));
    set("psp-xp-label", `${current.toLocaleString()} / ${needed.toLocaleString()} XP`);
    set("psp-total-xp", `Total: ${this.account.totalXp.toLocaleString()} XP`);

    const barFill = qEl("psp-xp-bar-fill");
    if (barFill) {
      // Animate bar with a small rAF delay
      barFill.style.transition = "none";
      barFill.style.width = "0%";
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          barFill.style.transition = "width 1.1s cubic-bezier(0.22, 1, 0.36, 1)";
          barFill.style.width = `${(pct * 100).toFixed(1)}%`;
        });
      });
    }

    const ringFill = qSvg("psp-ring-fill");
    if (ringFill) {
      const offset = circumference * (1 - pct);
      ringFill.style.strokeDashoffset = String(circumference); // reset
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          ringFill.style.strokeDashoffset = String(offset);
        });
      });
    }

    // Career stats
    set("psp-highest-round", this.account.highestRound > 0
      ? `Round ${this.account.highestRound}` : "—");
    set("psp-total-kills", this.account.totalKills.toLocaleString());
    set("psp-souls", this.account.souls.toLocaleString());

    // Favorite weapon — build a unified weapon name lookup across all sources
    const weaponDefs: Record<string, { name: string }> = {};
    for (const [id, meta] of Object.entries(PRIMARY_META)) {
      weaponDefs[id] = { name: meta.label };
    }
    for (const [, def] of Object.entries(HYTOPIA_GUN_DEFINITIONS)) {
      weaponDefs[def.id] = { name: def.name };
    }
    for (const [, def] of Object.entries(HYTOPIA_MELEE_DEFINITIONS)) {
      weaponDefs[def.id] = { name: def.name };
    }
    const favName = this.account.getFavoriteWeaponName(weaponDefs);
    set("psp-fav-weapon", favName);
  }

  // ── Loadout panel ─────────────────────────────────────────────────────────

  private bindLoadoutPanel(): void {
    // Name input + confirm button
    const nameInput = this.root.querySelector<HTMLInputElement>("#loadout-name-input");
    const nameConfirm = this.root.querySelector<HTMLButtonElement>("#loadout-name-confirm");

    if (nameInput && nameConfirm) {
      const saveName = () => {
        const val = nameInput.value.trim();
        if (!val) return;
        this.loadoutStore.update(this.activeLoadoutId, { name: val });
        this.renderLoadoutTabs();
        this.syncDeploySidebar();
      };

      nameConfirm.addEventListener("click", saveName);
      nameInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          saveName();
          nameInput.blur();
        }
      });
    }
  }

  // ── Mod Shop ──────────────────────────────────────────────────────────────

  private bindModShop(): void {
    // Delegated buy button clicks
    const screen = this.root.querySelector<HTMLElement>("#mod-shop-screen");
    if (!screen) return;
    screen.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-buy-mod]");
      if (!btn) return;
      const id = btn.dataset.buyMod as ModId | undefined;
      if (!id) return;
      const bought = this.account.buyMod(id);
      if (bought) {
        this.audio?.unlock();
        this.audio?.play("weaponBuy");
        this.renderModShop();
      }
    });
  }

  private renderModShop(): void {
    const grid = this.root.querySelector<HTMLElement>("#mod-shop-grid");
    const soulsEl = this.root.querySelector<HTMLElement>("#mod-shop-souls");
    if (!grid) return;

    const owned = this.account.ownedMods();
    if (soulsEl) soulsEl.textContent = `${this.account.souls.toLocaleString()} Souls`;

    // Count how many loadout slots use each mod (for x2 display)
    const equippedCounts: Partial<Record<ModId, number>> = {};
    for (const slot of this.loadoutStore.getAll()) {
      if (slot.mod) equippedCounts[slot.mod] = (equippedCounts[slot.mod] ?? 0) + 1;
    }

    grid.replaceChildren();
    for (const [rawId, meta] of Object.entries(MOD_META) as [ModId, typeof MOD_META[ModId]][]) {
      const id = rawId as ModId;
      const isOwned = owned.has(id);
      const price = MOD_SHOP_PRICES[id];
      const canAfford = this.account.souls >= price;
      const count = equippedCounts[id] ?? 0;

      const card = document.createElement("div");
      card.className = "mod-shop-card" + (isOwned ? " is-owned" : "");

      card.innerHTML = `
        <div class="mod-shop-card-icon">${meta.icon}</div>
        <div class="mod-shop-card-body">
          <div class="mod-shop-card-header">
            <span class="mod-shop-card-name">${meta.label}</span>
            ${isOwned && count > 0 ? `<span class="mod-shop-card-count">(x${count})</span>` : ""}
            ${isOwned ? `<span class="mod-shop-card-owned-badge">OWNED</span>` : ""}
          </div>
          <p class="mod-shop-card-desc">${meta.desc}</p>
          ${
            isOwned
              ? `<span class="mod-shop-card-status">Unlocked for all loadouts</span>`
              : `<button type="button" class="mod-shop-buy-btn${canAfford ? "" : " is-locked"}" data-buy-mod="${id}" ${canAfford ? "" : "disabled"}>
                  <span class="mod-shop-buy-price">${price.toLocaleString()}</span>
                  <span class="mod-shop-buy-label">${canAfford ? "Buy" : "Need Souls"}</span>
                </button>`
          }
        </div>`;

      grid.appendChild(card);
    }
  }

  // Render the 5 slot tab buttons
  private renderLoadoutTabs(): void {
    const host = this.root.querySelector<HTMLElement>("#loadout-tabs");
    if (!host) return;

    host.replaceChildren();
    const all = this.loadoutStore.getAll();
    for (const slot of all) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "loadout-tab" + (slot.id === this.activeLoadoutId ? " is-active" : "");
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", slot.id === this.activeLoadoutId ? "true" : "false");
      btn.textContent = slot.name;
      btn.dataset.slotId = `${slot.id}`;
      btn.addEventListener("click", () => {
        this.sfxUiClick();
        this.activeLoadoutId = slot.id;
        this.renderLoadoutTabs();
        this.renderLoadoutEditor();
        this.syncDeploySidebar();
      });
      host.appendChild(btn);
    }
  }

  // Render the full editor for the active slot
  private renderLoadoutEditor(): void {
    const slot = this.loadoutStore.get(this.activeLoadoutId);

    // Name input
    const nameInput = this.root.querySelector<HTMLInputElement>("#loadout-name-input");
    if (nameInput) nameInput.value = slot.name;

    // Special ability grid
    this.renderPickGrid<SpecialAbilityId | null>(
      "#loadout-ability-grid",
      [
        { id: null, label: "None", desc: "No special ability.", icon: "—", stats: undefined },
        ...Object.entries(SPECIAL_ABILITY_META).map(([id, m]) => ({
          id: id as SpecialAbilityId,
          label: m.label,
          desc: m.desc,
          icon: m.icon,
          stats: undefined
        }))
      ],
      slot.specialAbility,
      (val) => {
        this.loadoutStore.update(this.activeLoadoutId, { specialAbility: val });
        this.syncDeploySidebar();
      }
    );

    // Mod grid — only show mods the player owns
    const ownedMods = this.account.ownedMods();
    const modOptions: Array<{ id: ModId | null; label: string; desc: string; icon: string; stats?: string }> = [
      { id: null, label: "None", desc: "No weapon mod.", icon: "—" }
    ];
    for (const [id, m] of Object.entries(MOD_META) as [ModId, typeof MOD_META[ModId]][]) {
      if (ownedMods.has(id)) {
        modOptions.push({ id, label: m.label, desc: m.desc, icon: m.icon });
      }
    }

    if (modOptions.length === 1) {
      // No owned mods — show an empty-state prompt
      const host = this.root.querySelector<HTMLElement>("#loadout-mod-grid");
      if (host) {
        host.innerHTML = `<div class="loadout-mod-empty">
          <p>No mods owned yet.</p>
          <button type="button" class="loadout-mod-shop-link" id="loadout-mod-shop-link">Visit Mod Shop →</button>
        </div>`;
        host.querySelector("#loadout-mod-shop-link")?.addEventListener("click", () => {
          this.sfxUiClick();
          this.renderModShop();
          this.show("modShop");
        });
      }
    } else {
      this.renderPickGrid<ModId | null>(
        "#loadout-mod-grid",
        modOptions,
        slot.mod,
        (val) => {
          this.loadoutStore.update(this.activeLoadoutId, { mod: val });
          this.syncDeploySidebar();
        }
      );
    }

    // Primary grid (no "none" — always a weapon)
    this.renderPickGrid<StarterPistolId>(
      "#loadout-primary-grid",
      Object.entries(PRIMARY_META).map(([id, m]) => ({
        id: id as StarterPistolId,
        label: m.label,
        desc: m.desc,
        icon: m.icon,
        stats: m.stats
      })),
      slot.primary,
      (val) => {
        this.loadoutStore.update(this.activeLoadoutId, { primary: val });
      }
    );

    // Lethal grid
    this.renderPickGrid<LethalId | null>(
      "#loadout-lethal-grid",
      [
        { id: null, label: "None", desc: "No lethal equipped.", icon: "—", stats: undefined },
        ...Object.entries(LETHAL_META).map(([id, m]) => ({
          id: id as LethalId,
          label: m.label,
          desc: m.desc,
          icon: m.icon,
          stats: m.stats
        }))
      ],
      slot.lethal,
      (val) => {
        this.loadoutStore.update(this.activeLoadoutId, { lethal: val });
      }
    );
  }

  /**
   * Generic pick-grid renderer.
   * `options` array: first item may be the "none" option (id === null).
   */
  private renderPickGrid<T>(
    selector: string,
    options: Array<{ id: T; label: string; desc: string; icon: string; stats?: string }>,
    current: T,
    onChange: (value: T) => void
  ): void {
    const host = this.root.querySelector<HTMLElement>(selector);
    if (!host) return;

    host.replaceChildren();

    for (const opt of options) {
      const isNone = opt.id === null;
      const isActive = opt.id === current;

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className =
        "loadout-pick-card" +
        (isNone ? " loadout-pick-card--none" : "") +
        (isActive ? " is-active" : "");
      btn.setAttribute("aria-pressed", isActive ? "true" : "false");

      btn.innerHTML = `
        <span class="loadout-pick-icon">${opt.icon}</span>
        <span class="loadout-pick-body">
          <span class="loadout-pick-label">${opt.label}</span>
          <span class="loadout-pick-desc">${opt.desc}</span>
          ${opt.stats ? `<span class="loadout-pick-stats">${opt.stats}</span>` : ""}
        </span>`;

      btn.addEventListener("click", () => {
        this.sfxUiClick();
        onChange(opt.id);
        // Re-render just this grid to update active states
        this.renderLoadoutEditor();
      });

      host.appendChild(btn);
    }
  }

  // ── Settings controls ──────────────────────────────────────────────────────

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
    slider("setting-gp-look", "gamepadLookSensitivity", 100);
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
    setSlider("setting-gp-look", state.gamepadLookSensitivity, 100);
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
