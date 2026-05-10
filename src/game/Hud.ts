import { GAME_CONFIG } from "./config";
import type { InteractPrompt } from "./Interactable";
import type { Weapon } from "./Weapon";

export type HudSnapshot = {
  health: number;
  points: number;
  wave: number;
  activeZombies: number;
  queuedZombies: number;
  weapon: Weapon;
  isReloading: boolean;
  reloadProgress: number;
  zombiesFrozen: boolean;
  /** Open-world dev: show “Drop to ground” control. */
  showDropToGround: boolean;
  /** True while a gravity fall to terrain is in progress. */
  playerGravityDropping: boolean;
};

export type HudOptions = {
  onZombieFreezeToggle?: () => void;
  onDropToGroundClick?: () => void;
};

export class Hud {
  private readonly healthValue: HTMLElement;
  private readonly healthBar: HTMLElement;
  private readonly pointsValue: HTMLElement;
  private readonly waveValue: HTMLElement;
  private readonly zombiesValue: HTMLElement;
  private readonly statusText: HTMLElement;
  private readonly messageText: HTMLElement;
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
  private readonly freezeZombiesButton: HTMLButtonElement;
  private readonly dropToGroundButton: HTMLButtonElement;

  constructor(root: HTMLElement, options?: HudOptions) {
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
    this.waveValue = required("wave-value");
    this.zombiesValue = required("zombies-value");
    this.statusText = required("status-text");
    this.messageText = required("message-text");
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

    this.freezeZombiesButton = root.querySelector<HTMLButtonElement>("#btn-freeze-zombies")!;
    if (!this.freezeZombiesButton) {
      throw new Error("HUD: #btn-freeze-zombies missing.");
    }
    this.freezeZombiesButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      options?.onZombieFreezeToggle?.();
    });

    this.dropToGroundButton = root.querySelector<HTMLButtonElement>("#btn-drop-to-ground")!;
    if (!this.dropToGroundButton) {
      throw new Error("HUD: #btn-drop-to-ground missing.");
    }
    this.dropToGroundButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      options?.onDropToGroundClick?.();
    });
  }

  render(snapshot: HudSnapshot): void {
    const health = Math.max(0, Math.round(snapshot.health));
    this.healthValue.textContent = `${health}`;
    const ratio = Math.max(0, Math.min(1, health / GAME_CONFIG.player.maxHealth));
    this.healthBar.style.width = `${ratio * 100}%`;
    this.healthBar.classList.toggle("is-low", ratio < 0.35);

    this.pointsValue.textContent = `${snapshot.points}`;
    this.waveValue.textContent = `${snapshot.wave}`;
    this.zombiesValue.textContent = `${snapshot.activeZombies + snapshot.queuedZombies}`;

    const def = snapshot.weapon.definition;
    this.weaponName.textContent = def.name.toUpperCase();
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

    this.freezeZombiesButton.textContent = snapshot.zombiesFrozen ? "Unfreeze zombies" : "Freeze zombies";
    this.freezeZombiesButton.classList.toggle("is-active", snapshot.zombiesFrozen);
    this.freezeZombiesButton.setAttribute("aria-pressed", snapshot.zombiesFrozen ? "true" : "false");

    const showDrop = snapshot.showDropToGround;
    this.dropToGroundButton.hidden = !showDrop;
    this.dropToGroundButton.style.display = showDrop ? "" : "none";
    this.dropToGroundButton.disabled = snapshot.playerGravityDropping;
    this.dropToGroundButton.textContent = snapshot.playerGravityDropping ? "Falling…" : "Drop to ground";
  }

  setStatus(text: string): void {
    this.statusText.textContent = text;
  }

  setMessage(text: string): void {
    this.messageText.textContent = text;
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
