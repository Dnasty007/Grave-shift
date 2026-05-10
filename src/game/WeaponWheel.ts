import type { Weapon } from "./Weapon";

const DEAD_ZONE_PX = 56;

/**
 * Doom-style radial weapon picker (hold <kbd>V</kbd>). Builds DOM segments for owned guns
 * and maps screen-pointer angle to a slot index.
 */
export class WeaponWheel {
  private readonly root: HTMLElement;
  private readonly itemsEl: HTMLElement;
  private lastSignature = "";

  constructor(root: HTMLElement | null) {
    if (!root) {
      throw new Error("WeaponWheel: #weapon-wheel missing.");
    }
    this.root = root;
    const items = root.querySelector<HTMLElement>("#weapon-wheel-items");
    if (!items) {
      throw new Error("WeaponWheel: #weapon-wheel-items missing.");
    }
    this.itemsEl = items;
  }

  /**
   * @returns Updated highlight index (clamp to `weapons.length`).
   */
  sync(
    isOpen: boolean,
    weapons: ReadonlyArray<Weapon>,
    highlightIndex: number,
    clientX: number,
    clientY: number
  ): number {
    if (!isOpen || weapons.length === 0) {
      this.root.classList.remove("is-open");
      this.root.dataset.open = "0";
      this.root.setAttribute("aria-hidden", "true");
      return highlightIndex;
    }

    this.root.classList.add("is-open");
    this.root.dataset.open = "1";
    this.root.setAttribute("aria-hidden", "false");

    this.ensureItems(weapons);

    const n = weapons.length;
    let next = Math.max(0, Math.min(n - 1, highlightIndex));
    next = this.pointerToIndex(clientX, clientY, n, next);

    for (let i = 0; i < this.itemsEl.children.length; i++) {
      const el = this.itemsEl.children[i] as HTMLElement;
      el.classList.toggle("is-selected", i === next);
    }

    return next;
  }

  private ensureItems(weapons: ReadonlyArray<Weapon>): void {
    const sig = weapons.map((w) => w.definition.id).join("|");
    if (sig === this.lastSignature && this.itemsEl.children.length === weapons.length) {
      for (let i = 0; i < weapons.length; i++) {
        const w = weapons[i]!;
        const el = this.itemsEl.children[i] as HTMLElement;
        if (!el) continue;
        el.dataset.weaponId = w.definition.id;
        const nameEl = el.querySelector(".weapon-wheel-name");
        const metaEl = el.querySelector(".weapon-wheel-meta");
        if (nameEl) nameEl.textContent = w.definition.name.toUpperCase();
        if (metaEl) metaEl.textContent = `${w.ammoMag}/${w.definition.magazineSize} · ${w.definition.caliber}`;
      }
      return;
    }

    this.lastSignature = sig;
    this.itemsEl.replaceChildren();

    const n = weapons.length;
    this.itemsEl.style.setProperty("--wheel-n", String(Math.max(1, n)));

    for (let i = 0; i < weapons.length; i++) {
      const w = weapons[i]!;
      const card = document.createElement("div");
      card.className = "weapon-wheel-item";
      card.dataset.weaponId = w.definition.id;
      card.style.setProperty("--i", String(i));

      const inner = document.createElement("div");
      inner.className = "weapon-wheel-card";

      const name = document.createElement("div");
      name.className = "weapon-wheel-name";
      name.textContent = w.definition.name.toUpperCase();

      const meta = document.createElement("div");
      meta.className = "weapon-wheel-meta";
      meta.textContent = `${w.ammoMag}/${w.definition.magazineSize} · ${w.definition.caliber}`;

      inner.appendChild(name);
      inner.appendChild(meta);
      card.appendChild(inner);
      this.itemsEl.appendChild(card);
    }
  }

  private pointerToIndex(
    clientX: number,
    clientY: number,
    count: number,
    prev: number
  ): number {
    const cx = window.innerWidth * 0.5;
    const cy = window.innerHeight * 0.5;
    const dx = clientX - cx;
    const dy = clientY - cy;
    if (dx * dx + dy * dy < DEAD_ZONE_PX * DEAD_ZONE_PX) {
      return prev;
    }
    let ang = Math.atan2(dy, dx) * (180 / Math.PI);
    ang = (ang + 90 + 360) % 360;
    const seg = 360 / count;
    let idx = Math.floor(ang / seg);
    if (idx >= count) idx = count - 1;
    if (idx < 0) idx = 0;
    return idx;
  }
}
