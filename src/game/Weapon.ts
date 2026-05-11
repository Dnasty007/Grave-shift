import {
  HYTOPIA_GUN_DEFINITIONS,
  HYTOPIA_MELEE_DEFINITIONS,
  type HytopiaMeleeWeaponId
} from "./hytopiaWeaponDefs";
import type { WeaponDefinition, WeaponShotProfile, WeaponViewModelGltf } from "./weaponTypes";

export type { WeaponDefinition, WeaponShotProfile, WeaponViewModelGltf };

export type WeaponId =
  | "pistol"
  | "shotgun"
  | "autoPistol"
  | "ar15"
  | "ak47"
  | "autoShotgun"
  | keyof typeof HYTOPIA_GUN_DEFINITIONS
  | HytopiaMeleeWeaponId;

const vm = (
  url: string,
  scale: number,
  position: [number, number, number],
  eulerDegrees: [number, number, number]
): WeaponViewModelGltf => ({ url, scale, position, eulerDegrees });

/** Original arena wall-buy weapons + Hytopia first-person packs (`hytopia-guns`, `hytopia-tools`). */
export const WEAPON_DEFINITIONS: Record<WeaponId, WeaponDefinition> = {
  pistol: {
    id: "pistol",
    name: "Glock 19",
    shortName: "Glock",
    caliber: "9mm",
    shotProfile: "single",
    damage: 30,
    headshotMultiplier: 2.2,
    fireIntervalSeconds: 0.18,
    range: 58,
    hitRadius: 0.5,
    spreadDegrees: 1.4,
    pelletsPerShot: 1,
    recoilKick: 0.012,
    magazineSize: 12,
    reserveAmmo: 96,
    reloadSeconds: 1.5,
    buyCost: 0,
    refillCost: 250,
    viewModelTint: [0.18, 0.18, 0.2],
    viewModelLength: 0.5,
    viewModelGltf: vm("/models/weapons/hytopia-guns/glock-19.gltf", 0.34, [0.38, -0.22, -0.52], [-4, 8, 0]),
    audio: { shot: "shot" }
  },
  shotgun: {
    id: "shotgun",
    name: "Pump Shotgun",
    shortName: "Pump",
    caliber: "12 GAUGE",
    shotProfile: "pellet",
    damage: 22,
    headshotMultiplier: 1.4,
    fireIntervalSeconds: 0.78,
    range: 28,
    hitRadius: 0.6,
    spreadDegrees: 7.5,
    pelletsPerShot: 8,
    recoilKick: 0.04,
    magazineSize: 6,
    reserveAmmo: 36,
    reloadSeconds: 2.4,
    buyCost: 1500,
    refillCost: 750,
    viewModelTint: [0.32, 0.18, 0.1],
    viewModelLength: 0.7,
    viewModelGltf: vm("/models/weapons/shotgun.glb", 0.31, [0.32, -0.28, -0.48], [-2, 12, 0]),
    audio: { shot: "shotgunShot" }
  },
  autoPistol: {
    id: "autoPistol",
    name: "Auto Pistol",
    shortName: "Auto PST",
    caliber: "9mm",
    shotProfile: "burst",
    damage: 18,
    headshotMultiplier: 1.8,
    fireIntervalSeconds: 0.07,
    range: 56,
    hitRadius: 0.5,
    spreadDegrees: 2.6,
    pelletsPerShot: 1,
    recoilKick: 0.018,
    magazineSize: 36,
    reserveAmmo: 240,
    reloadSeconds: 2,
    buyCost: 1200,
    refillCost: 600,
    viewModelTint: [0.15, 0.15, 0.16],
    viewModelLength: 0.55,
    viewModelGltf: vm("/models/weapons/auto-pistol.glb", 0.34, [0.36, -0.24, -0.5], [-4, 10, 0]),
    audio: { shot: "smgShot" }
  },
  ar15: {
    id: "ar15",
    name: "AR-15",
    shortName: "AR-15",
    caliber: "5.56",
    shotProfile: "single",
    damage: 36,
    headshotMultiplier: 2.2,
    fireIntervalSeconds: 0.085,
    range: 88,
    hitRadius: 0.45,
    spreadDegrees: 0.85,
    pelletsPerShot: 1,
    recoilKick: 0.032,
    magazineSize: 30,
    reserveAmmo: 210,
    reloadSeconds: 2.2,
    buyCost: 1750,
    refillCost: 900,
    viewModelTint: [0.2, 0.17, 0.12],
    viewModelLength: 0.82,
    viewModelGltf: vm("/models/weapons/ar15.glb", 0.3, [0.3, -0.26, -0.42], [-2, 14, 0]),
    audio: { shot: "rifleShot" }
  },
  ak47: {
    id: "ak47",
    name: "AK-47",
    shortName: "AK-47",
    caliber: "7.62",
    shotProfile: "single",
    damage: 40,
    headshotMultiplier: 2.3,
    fireIntervalSeconds: 0.1,
    range: 92,
    hitRadius: 0.45,
    spreadDegrees: 1.15,
    pelletsPerShot: 1,
    recoilKick: 0.038,
    magazineSize: 30,
    reserveAmmo: 180,
    reloadSeconds: 2.35,
    buyCost: 2400,
    refillCost: 1100,
    viewModelTint: [0.26, 0.19, 0.11],
    viewModelLength: 0.8,
    viewModelGltf: vm("/models/weapons/hytopia-guns/ak47.gltf", 0.29, [0.3, -0.27, -0.44], [-3, 16, 0]),
    audio: { shot: "rifleShot" }
  },
  autoShotgun: {
    id: "autoShotgun",
    name: "Auto Shotgun",
    shortName: "Auto SG",
    caliber: "12 GAUGE",
    shotProfile: "pellet",
    damage: 16,
    headshotMultiplier: 1.35,
    fireIntervalSeconds: 0.44,
    range: 26,
    hitRadius: 0.58,
    spreadDegrees: 6.8,
    pelletsPerShot: 7,
    recoilKick: 0.038,
    magazineSize: 10,
    reserveAmmo: 50,
    reloadSeconds: 2.55,
    buyCost: 2000,
    refillCost: 950,
    viewModelTint: [0.28, 0.16, 0.1],
    viewModelLength: 0.68,
    viewModelGltf: vm("/models/weapons/auto-shotgun.glb", 0.31, [0.3, -0.28, -0.46], [-2, 11, 0]),
    audio: { shot: "shotgunShot" }
  },
  ...HYTOPIA_GUN_DEFINITIONS,
  ...HYTOPIA_MELEE_DEFINITIONS
};

/** Preload / cycle order: starters first, base wall buys, Hytopia guns, then melee tools. */
export const WEAPON_IDS: WeaponId[] = [
  "pistol",
  "ak47",
  "shotgun",
  "autoPistol",
  "ar15",
  "autoShotgun",
  ...Object.keys(HYTOPIA_GUN_DEFINITIONS),
  ...Object.keys(HYTOPIA_MELEE_DEFINITIONS)
] as WeaponId[];

/** Spawn loadout: Hytopia Glock + Hytopia AK. */
export const STARTER_WEAPON_SLOTS: readonly WeaponId[] = ["pistol", "ak47"];

export class Weapon {
  readonly definition: WeaponDefinition;
  ammoMag: number;
  ammoReserve: number;

  constructor(definition: WeaponDefinition) {
    this.definition = definition;
    this.ammoMag = definition.magazineSize;
    this.ammoReserve = definition.reserveAmmo;
  }

  refillReserveToMax(): void {
    this.ammoReserve = this.definition.reserveAmmo;
  }

  resetAmmo(): void {
    this.ammoMag = this.definition.magazineSize;
    this.ammoReserve = this.definition.reserveAmmo;
  }

  hasAnyAmmo(): boolean {
    return this.ammoMag > 0 || this.ammoReserve > 0;
  }
}

const MAX_OWNED_WEAPONS = 64;

function normalizeStarters(input: WeaponId | readonly WeaponId[]): WeaponId[] {
  if (typeof input === "string") {
    return [input];
  }
  return Array.from(input);
}

export class WeaponInventory {
  private owned: Weapon[] = [];
  private currentIndex = 0;

  constructor(starter: WeaponId | readonly WeaponId[]) {
    this.applyStarters(starter);
  }

  private applyStarters(starter: WeaponId | readonly WeaponId[]): void {
    const ids = normalizeStarters(starter);
    if (ids.length === 0) {
      throw new Error("WeaponInventory: at least one starter weapon required.");
    }
    this.owned = ids.map((id) => new Weapon(WEAPON_DEFINITIONS[id]));
    this.currentIndex = 0;
  }

  reset(starter: WeaponId | readonly WeaponId[]): void {
    this.applyStarters(starter);
  }

  getCurrent(): Weapon {
    const weapon = this.owned[this.currentIndex];
    if (!weapon) {
      throw new Error("WeaponInventory has no current weapon.");
    }
    return weapon;
  }

  hasWeapon(id: WeaponId): boolean {
    return this.owned.some((w) => w.definition.id === id);
  }

  getWeapon(id: WeaponId): Weapon | null {
    return this.owned.find((w) => w.definition.id === id) ?? null;
  }

  cycle(delta: number): boolean {
    if (this.owned.length <= 1) return false;
    const n = this.owned.length;
    this.currentIndex = (((this.currentIndex + delta) % n) + n) % n;
    return true;
  }

  swap(): void {
    this.cycle(1);
  }

  buyOrRefill(id: WeaponId, refundCurrentInsteadOfReplace = false): "bought" | "refilled" | "noChange" {
    const def = WEAPON_DEFINITIONS[id];
    const existing = this.getWeapon(id);

    if (existing) {
      if (existing.ammoReserve >= def.reserveAmmo && existing.ammoMag === def.magazineSize) {
        return "noChange";
      }
      existing.refillReserveToMax();
      existing.ammoMag = def.magazineSize;
      return "refilled";
    }

    if (this.owned.length < MAX_OWNED_WEAPONS) {
      this.owned.push(new Weapon(def));
      this.currentIndex = this.owned.length - 1;
      return "bought";
    }

    if (refundCurrentInsteadOfReplace) {
      return "noChange";
    }

    this.owned[this.currentIndex] = new Weapon(def);
    return "bought";
  }

  getSlots(): ReadonlyArray<Weapon> {
    return this.owned;
  }

  getCurrentSlotIndex(): number {
    return this.currentIndex;
  }

  setCurrentSlotIndex(index: number): boolean {
    if (this.owned.length === 0) return false;
    const clamped = Math.max(0, Math.min(this.owned.length - 1, index));
    if (clamped === this.currentIndex) {
      return false;
    }
    this.currentIndex = clamped;
    return true;
  }

  getOwnedCount(): number {
    return this.owned.length;
  }

  refillAll(): void {
    for (const weapon of this.owned) {
      weapon.resetAmmo();
    }
  }
}
