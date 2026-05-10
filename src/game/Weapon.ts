export type WeaponId = "pistol" | "shotgun" | "smg" | "rifle" | "magnum";

export type WeaponShotProfile = "single" | "burst" | "pellet";

export type WeaponDefinition = {
  id: WeaponId;
  name: string;
  shortName: string;
  caliber: string;
  shotProfile: WeaponShotProfile;
  damage: number;
  headshotMultiplier: number;
  fireIntervalSeconds: number;
  range: number;
  hitRadius: number;
  spreadDegrees: number;
  pelletsPerShot: number;
  recoilKick: number;
  magazineSize: number;
  reserveAmmo: number;
  reloadSeconds: number;
  buyCost: number;
  refillCost: number;
  viewModelTint: [number, number, number];
  viewModelLength: number;
  audio: {
    shot: "shot" | "shotgunShot" | "smgShot" | "rifleShot" | "magnumShot";
  };
};

export const WEAPON_DEFINITIONS: Record<WeaponId, WeaponDefinition> = {
  pistol: {
    id: "pistol",
    name: "Sidearm M1908",
    shortName: "Sidearm",
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
    audio: { shot: "shot" }
  },
  shotgun: {
    id: "shotgun",
    name: "Pump 12g",
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
    audio: { shot: "shotgunShot" }
  },
  smg: {
    id: "smg",
    name: "Burst SMG",
    shortName: "SMG",
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
    audio: { shot: "smgShot" }
  },
  rifle: {
    id: "rifle",
    name: "Marksman M44",
    shortName: "Marksman",
    caliber: "7.62",
    shotProfile: "single",
    damage: 95,
    headshotMultiplier: 2.6,
    fireIntervalSeconds: 0.55,
    range: 95,
    hitRadius: 0.42,
    spreadDegrees: 0.4,
    pelletsPerShot: 1,
    recoilKick: 0.05,
    magazineSize: 5,
    reserveAmmo: 30,
    reloadSeconds: 2.6,
    buyCost: 1750,
    refillCost: 900,
    viewModelTint: [0.22, 0.16, 0.1],
    viewModelLength: 0.85,
    audio: { shot: "rifleShot" }
  },
  magnum: {
    id: "magnum",
    name: "Hand Cannon .50",
    shortName: "Hand Cannon",
    caliber: ".50",
    shotProfile: "single",
    damage: 140,
    headshotMultiplier: 2.4,
    fireIntervalSeconds: 0.42,
    range: 62,
    hitRadius: 0.5,
    spreadDegrees: 1.1,
    pelletsPerShot: 1,
    recoilKick: 0.06,
    magazineSize: 6,
    reserveAmmo: 24,
    reloadSeconds: 2.2,
    buyCost: 2400,
    refillCost: 1100,
    viewModelTint: [0.3, 0.22, 0.12],
    viewModelLength: 0.55,
    audio: { shot: "magnumShot" }
  }
};

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

export class WeaponInventory {
  private slots: (Weapon | null)[] = [null, null];
  private currentSlot = 0;

  constructor(starter: WeaponId) {
    this.slots[0] = new Weapon(WEAPON_DEFINITIONS[starter]);
  }

  reset(starter: WeaponId): void {
    this.slots = [new Weapon(WEAPON_DEFINITIONS[starter]), null];
    this.currentSlot = 0;
  }

  getCurrent(): Weapon {
    const weapon = this.slots[this.currentSlot];
    if (!weapon) {
      const fallback = this.slots[1 - this.currentSlot];
      if (fallback) {
        this.currentSlot = 1 - this.currentSlot;
        return fallback;
      }
      throw new Error("WeaponInventory has no weapons.");
    }
    return weapon;
  }

  hasWeapon(id: WeaponId): boolean {
    return this.slots.some((w) => w?.definition.id === id);
  }

  getWeapon(id: WeaponId): Weapon | null {
    return this.slots.find((w) => w?.definition.id === id) ?? null;
  }

  swap(): void {
    if (!this.slots[1 - this.currentSlot]) return;
    this.currentSlot = 1 - this.currentSlot;
  }

  /**
   * Buy or refill the given weapon. Returns true if any change happened.
   * - If owned: refill reserve to max.
   * - Else: place in empty slot, or replace current slot.
   */
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

    const emptySlot = this.slots.findIndex((w) => w === null);
    if (emptySlot !== -1) {
      this.slots[emptySlot] = new Weapon(def);
      this.currentSlot = emptySlot;
      return "bought";
    }

    if (refundCurrentInsteadOfReplace) {
      return "noChange";
    }

    this.slots[this.currentSlot] = new Weapon(def);
    return "bought";
  }

  getSlots(): ReadonlyArray<Weapon | null> {
    return this.slots;
  }

  getCurrentSlotIndex(): number {
    return this.currentSlot;
  }
}
