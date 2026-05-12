import { GAME_CONFIG } from "./config";
import type { InteractPrompt } from "./Interactable";
import type { StashStack } from "./PlayerStash";
import type { Weapon } from "./Weapon";
import { formatWaveRound } from "./waveDisplay";

const INVENTORY_GRID_SLOTS = 27;

export type InventoryPanelActions = {
  onSlotSelect: (stashIndex: number) => void;
  onUseSelected: () => void;
  onDropSelected: () => void;
};

/**
 * DOM HUD bound from `GameApp.renderHud`: health, wave, ammo, interact card.
 * Keeps TypeScript snapshots explicit so gameplay state → DOM mapping stays in one `render()` call.
 */
export type HudSnapshot = {
  health: number;
  points: number;
  wave: number;
  activeZombies: number;
  queuedZombies: number;
  weapon: Weapon;
  isReloading: boolean;
  reloadProgress: number;
  lethalCharges?: number;
  lethalName?: string;
};

export class Hud {
  private readonly healthValue: HTMLElement;
  private readonly healthBar: HTMLElement;
  private readonly pointsValue: HTMLElement;
  private readonly waveTrackerPersistent: HTMLElement;
  private readonly zombiesValue: HTMLElement;
  private readonly ammoMagValue: HTMLElement;
  private readonly ammoReserveValue: HTMLElement;
  private readonly ammoMagWrapper: HTMLElement;
  private readonly ammoReloadBar: HTMLElement;
  private readonly ammoReloadFill: HTMLElement;
  private readonly weaponName: HTMLElement;
  private readonly weaponCaliber: HTMLElement;
  private readonly interactPrompt: HTMLElement;
  private readonly interactTitle: HTMLElement;
  private readonly interactSubtitle: HTMLElement;
  private readonly interactBadge: HTMLElement;
  private readonly interactCost: HTMLElement;
  private readonly jetpackHud: HTMLElement | null;
  private readonly jetpackBar: HTMLElement | null;
  private readonly jetpackTimerEl: HTMLElement | null;
  private readonly mysterySpinOverlay: HTMLElement | null;
  private readonly mysterySpinNameEl: HTMLElement | null;
  private readonly mysterySpinStatusEl: HTMLElement | null;
  private readonly inventoryPanel: HTMLElement;
  private readonly inventoryGrid: HTMLElement;
  private readonly invHeldName: HTMLElement;
  private readonly invHeldDetail: HTMLElement;
  private readonly invBtnUse: HTMLButtonElement;
  private readonly invBtnDrop: HTMLButtonElement;
  private invActions: InventoryPanelActions | null = null;

  constructor(root: HTMLElement) {
    const required = (id: string) => {
      const node = root.querySelector<HTMLElement>(`#${id}`);
      if (!node) {
        throw new Error(`HUD: element #${id} missing.`);
      }
      return node;
    };

    this.healthValue = required("health-value");
    this.healthBar = required("health-bar");
    this.pointsValue = required("points-value");
    this.waveTrackerPersistent = required("wave-tracker-persistent");
    this.zombiesValue = required("zombies-value");
    this.ammoMagValue = required("ammo-mag-value");
    this.ammoReserveValue = required("ammo-reserve-value");
    this.ammoReloadBar = root.querySelector<HTMLElement>(".ammo-reload-bar")!;
    this.ammoReloadFill = required("ammo-reload-fill");
    this.ammoMagWrapper = root.querySelector<HTMLElement>(".ammo-mag")!;
    this.weaponName = required("weapon-name");
    this.weaponCaliber = required("weapon-caliber");
    this.interactPrompt = required("interact-prompt");
    this.interactTitle = required("interact-title");
    this.interactSubtitle = required("interact-subtitle");
    this.interactBadge = required("interact-badge");
    this.interactCost = required("interact-cost");
    this.jetpackHud = root.querySelector<HTMLElement>("#jetpack-hud");
    this.jetpackBar = root.querySelector<HTMLElement>("#jetpack-bar");
    this.jetpackTimerEl = root.querySelector<HTMLElement>("#jetpack-timer");
    this.mysterySpinOverlay = root.querySelector<HTMLElement>("#mystery-spin-overlay");
    this.mysterySpinNameEl = root.querySelector<HTMLElement>("#mystery-spin-name");
    this.mysterySpinStatusEl = root.querySelector<HTMLElement>("#mystery-spin-status");
    this.inventoryPanel = required("inventory-panel");
    this.inventoryGrid = required("inventory-grid");
    this.invHeldName = required("inv-held-name");
    this.invHeldDetail = required("inv-held-detail");
    this.invBtnUse = required("inv-btn-use") as HTMLButtonElement;
    this.invBtnDrop = required("inv-btn-drop") as HTMLButtonElement;

    this.inventoryGrid.addEventListener("click", (e) => {
      const t = (e.target as HTMLElement).closest("[data-stash-slot]");
      if (!t || !this.invActions) return;
      const idx = parseInt(t.getAttribute("data-stash-slot") ?? "-1", 10);
      if (idx >= 0) {
        this.invActions.onSlotSelect(idx);
      }
    });
    this.invBtnUse.addEventListener("click", () => this.invActions?.onUseSelected());
    this.invBtnDrop.addEventListener("click", () => this.invActions?.onDropSelected());
  }

  setInventoryActions(actions: InventoryPanelActions | null): void {
    this.invActions = actions;
  }

  syncInventoryPanel(open: boolean, weapon: Weapon, stacks: ReadonlyArray<StashStack>, selectedIndex: number): void {
    this.inventoryPanel.classList.toggle("is-open", open);
    this.inventoryPanel.setAttribute("aria-hidden", open ? "false" : "true");
    if (!open) {
      return;
    }

    const def = weapon.definition;
    this.invHeldName.textContent = weapon.getHudDisplayName();
    this.invHeldDetail.textContent = `${def.caliber} ammo · Magazine ${weapon.ammoMag}/${def.magazineSize} · Reserve ${weapon.ammoReserve}/${def.reserveAmmo}`;

    const frag = document.createDocumentFragment();
    for (let i = 0; i < INVENTORY_GRID_SLOTS; i++) {
      const cell = document.createElement("button");
      cell.type = "button";
      cell.className = "inv-slot mc-slot";
      cell.dataset.stashSlot = `${i}`;
      const st = stacks[i];
      if (st) {
        cell.classList.add("has-item");
        cell.innerHTML = `<span class="inv-slot-cal">${escapeHtml(st.caliber)}</span><span class="inv-slot-amt">×${st.amount}</span>`;
      } else {
        cell.classList.add("empty");
        cell.innerHTML = "";
      }
      if (i === selectedIndex && st) {
        cell.classList.add("selected");
      }
      frag.appendChild(cell);
    }
    this.inventoryGrid.replaceChildren(frag);
  }

  render(snapshot: HudSnapshot): void {
    const health = Math.max(0, Math.round(snapshot.health));
    this.healthValue.textContent = `${health}`;
    const ratio = Math.max(0, Math.min(1, health / GAME_CONFIG.player.maxHealth));
    this.healthBar.style.width = `${ratio * 100}%`;
    this.healthBar.classList.toggle("is-low", ratio < 0.4);

    this.pointsValue.textContent = `${snapshot.points}`;
    this.waveTrackerPersistent.textContent = formatWaveRound(snapshot.wave);
    this.zombiesValue.textContent = `${snapshot.activeZombies + snapshot.queuedZombies}`;

    const def = snapshot.weapon.definition;
    this.weaponName.textContent = snapshot.weapon.getHudDisplayName().toUpperCase();
    this.weaponCaliber.textContent = `${def.caliber} · LOAD`;

    this.ammoMagValue.textContent = `${snapshot.weapon.ammoMag}`;
    this.ammoReserveValue.textContent = `${snapshot.weapon.ammoReserve}`;
    this.ammoMagWrapper.classList.toggle(
      "is-empty",
      snapshot.weapon.ammoMag === 0 && !snapshot.isReloading
    );

    if (snapshot.isReloading) {
      this.ammoReloadBar.classList.add("is-active");
      this.ammoReloadFill.style.width = `${Math.max(0, Math.min(1, snapshot.reloadProgress)) * 100}%`;
    } else {
      this.ammoReloadBar.classList.remove("is-active");
      this.ammoReloadFill.style.width = "0%";
    }

    // Lethal indicator
    const lethalEl = document.getElementById("lethal-hud");
    const lethalChargesEl = document.getElementById("lethal-charges");
    const lethalNameEl = document.getElementById("lethal-name");
    if (lethalEl) {
      const hasLethal = (snapshot.lethalCharges ?? 0) > 0 || snapshot.lethalName;
      lethalEl.classList.toggle("is-active", !!hasLethal);
      if (lethalChargesEl) lethalChargesEl.textContent = `${snapshot.lethalCharges ?? 0}`;
      if (lethalNameEl) lethalNameEl.textContent = snapshot.lethalName ?? "";
    }
  }

  setJetpackStatus(active: boolean, remainingSeconds: number, thrusterFuelRatio: number): void {
    if (!this.jetpackHud) return;
    const expiring = active && remainingSeconds < 10;
    this.jetpackHud.classList.toggle("is-active", active);
    this.jetpackHud.classList.toggle("is-expiring", expiring);
    if (!active) return;
    const fuel = Math.max(0, Math.min(1, thrusterFuelRatio));
    if (this.jetpackBar) this.jetpackBar.style.width = `${fuel * 100}%`;
    if (this.jetpackTimerEl) this.jetpackTimerEl.textContent = `${Math.ceil(remainingSeconds)}s`;
  }

  showMysteryBoxSpin(allWeaponNames: string[], finalName: string, spinMs: number): void {
    const overlay = this.mysterySpinOverlay;
    const nameEl = this.mysterySpinNameEl;
    const statusEl = this.mysterySpinStatusEl;
    if (!overlay || !nameEl) return;

    overlay.classList.add("is-active");
    nameEl.classList.remove("is-landed");
    if (statusEl) statusEl.textContent = "??? MYSTERY BOX ???";

    const start = performance.now();
    let handle: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      const elapsed = performance.now() - start;
      const progress = Math.min(1, elapsed / spinMs);
      if (progress >= 1) {
        nameEl.textContent = finalName;
        nameEl.classList.add("is-landed");
        if (statusEl) statusEl.textContent = "✶ WEAPON ACQUIRED ✶";
        handle = setTimeout(() => {
          overlay.classList.remove("is-active");
          nameEl.classList.remove("is-landed");
          if (statusEl) statusEl.textContent = "??? MYSTERY BOX ???";
        }, 2400);
        return;
      }
      const eased = progress * progress;
      nameEl.textContent = allWeaponNames[Math.floor(Math.random() * allWeaponNames.length)];
      handle = setTimeout(tick, 55 + eased * 340);
    };

    if (handle !== null) clearTimeout(handle);
    tick();
  }

  setInteractPrompt(prompt: InteractPrompt | null): void {
    if (!prompt) {
      this.interactPrompt.classList.remove("is-visible");
      return;
    }

    this.interactTitle.textContent = prompt.title;
    this.interactSubtitle.textContent = prompt.subtitle;
    this.interactBadge.textContent = prompt.badge ?? "";
    this.interactBadge.style.display = prompt.badge ? "" : "none";

    if (prompt.cost == null) {
      this.interactCost.textContent = "";
      this.interactCost.classList.remove("is-affordable", "is-unaffordable");
    } else {
      this.interactCost.textContent = `$${prompt.cost.toLocaleString()}`;
      this.interactCost.classList.toggle("is-affordable", prompt.affordable);
      this.interactCost.classList.toggle("is-unaffordable", !prompt.affordable);
    }

    this.interactPrompt.classList.add("is-visible");
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
