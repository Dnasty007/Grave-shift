export type WeaponShotProfile = "single" | "burst" | "pellet";

/** Optional first-person glTF under `/public` (see `public/models/weapons/`). */
export type WeaponViewModelGltf = {
  url: string;
  scale: number;
  position: [number, number, number];
  eulerDegrees: [number, number, number];
};

export type WeaponDefinition = {
  id: string;
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
  viewModelGltf?: WeaponViewModelGltf;
  audio: {
    shot: "shot" | "shotgunShot" | "smgShot" | "rifleShot" | "magnumShot";
  };
};
