import {
  Audio,
  CollisionGroup,
  CollisionGroupsBuilder,
  Entity,
  PlayerEntity,
  type Vector3Like,
  type QuaternionLike,
  World,
} from "hytopia";

/**
 * GunEntity — faithful port of the official Hytopia zombies-fps GunEntity.
 * (docs/official-zombies-fps/GunEntity.ts is the reference copy.)
 *
 * THE critical pattern that makes guns sit in the hand correctly:
 *  - The gun is a CHILD entity created with parent + parentNodeName at CONSTRUCTION.
 *  - It is spawned with ONE universal local transform: pos {0,0,-0.2}, Euler(-90,0,0).
 *  - The official gun models (models/items/*.glb) are AUTHORED to fit the
 *    soldier-player.gltf rig's hand_right_anchor with exactly that transform.
 *    No per-gun hand math is needed. Ever.
 *
 * Adaptations for grave-shift (kept minimal):
 *  - onHit / onShoot callbacks so GehennaDirector owns damage, points, headshots, PaP.
 *  - Reserve ammo (WaW-style) on top of the official clip system.
 *  - No direct UI pushes — the Director's HUD reads gun state instead.
 */

export type GunHand = "left" | "right" | "both";

export type GunEntityOptions = {
  ammo: number;              // rounds currently in the clip
  damage: number;            // base damage per bullet/pellet (Director applies PaP/headshot)
  fireRate: number;          // bullets per second
  hand: GunHand;             // hand the weapon is held in
  iconImageUri: string;      // HUD icon
  idleAnimation: string;     // player anim while holding (e.g. idle_gun_both)
  maxAmmo: number;           // clip capacity
  name: string;
  modelUri: string;
  modelScale: number;
  parent?: PlayerEntity;     // the player entity holding this gun
  range: number;             // raycast max distance
  reloadAudioUri: string;
  reloadTimeMs: number;
  reserveAmmo: number;       // WaW-style reserve pool (our extension)
  shootAnimation: string;    // player anim on fire (e.g. shoot_gun_both)
  shootAudioUri: string;

  // Director hooks (our extension)
  onShoot?: () => void;
  onHit?: (hitEntity: Entity, hitPoint: Vector3Like, baseDamage: number) => void;
  /** Prefer boss / custom targets when the physics ray misses (blocks have no entity). */
  resolveHit?: (
    origin: Vector3Like,
    direction: Vector3Like,
    length: number,
    primary: { entity: Entity; hitPoint: Vector3Like } | null
  ) => { entity: Entity; hitPoint: Vector3Like } | null;
  onAmmoChanged?: () => void;
};

export default abstract class GunEntity extends Entity {
  public ammo: number;
  public damage: number;
  public fireRate: number;
  public hand: GunHand;
  public iconImageUri: string;
  public idleAnimation: string;
  public maxAmmo: number;
  public range: number;
  public reloadTimeMs: number;
  public reserveAmmo: number;
  public readonly maxReserve: number;
  public shootAnimation: string;

  private _lastFireTime = 0;
  private _muzzleFlash: Entity | undefined;
  private _reloadAudio: Audio;
  private _reloading = false;
  private _reloadStartMs = 0;
  private _shootAudio: Audio;
  private _onShoot?: () => void;
  private _onHit?: (hitEntity: Entity, hitPoint: Vector3Like, baseDamage: number) => void;
  private _resolveHit?: GunEntityOptions["resolveHit"];
  private _onAmmoChanged?: () => void;

  public constructor(options: GunEntityOptions) {
    super({
      name: options.name,
      modelUri: options.modelUri,
      modelScale: options.modelScale,
      parent: options.parent,
      // Official convenience: the hand anchor node on the soldier rig
      parentNodeName: options.parent
        ? GunEntity._getParentNodeName(options.hand)
        : undefined,
    });

    this.ammo = options.ammo;
    this.damage = options.damage;
    this.fireRate = options.fireRate;
    this.hand = options.hand;
    this.iconImageUri = options.iconImageUri;
    this.idleAnimation = options.idleAnimation;
    this.maxAmmo = options.maxAmmo;
    this.range = options.range;
    this.reloadTimeMs = options.reloadTimeMs;
    this.reserveAmmo = options.reserveAmmo;
    this.maxReserve = options.reserveAmmo;
    this.shootAnimation = options.shootAnimation;
    this._onShoot = options.onShoot;
    this._onHit = options.onHit;
    this._resolveHit = options.resolveHit;
    this._onAmmoChanged = options.onAmmoChanged;

    this._reloadAudio = new Audio({
      attachedToEntity: this,
      uri: options.reloadAudioUri,
    });

    this._shootAudio = new Audio({
      attachedToEntity: this,
      uri: options.shootAudioUri,
      volume: 0.3,
      referenceDistance: 8,
    });

    if (options.parent) {
      this.setParentAnimations();
    }
  }

  public get isEquipped(): boolean { return !!this.parent; }
  public get isReloading(): boolean { return this._reloading; }

  /** 0..1 progress of the current reload (for the HUD reload bar). */
  public get reloadProgress(): number {
    if (!this._reloading) return 0;
    return Math.max(0, Math.min(1, (performance.now() - this._reloadStartMs) / this.reloadTimeMs));
  }

  public override spawn(world: World, position: Vector3Like, rotation?: QuaternionLike): void {
    super.spawn(world, position, rotation);
    this.createMuzzleFlashChildEntity();
  }

  /** Muzzle flash is a child entity of the gun, flashed via opacity (official pattern). */
  public createMuzzleFlashChildEntity(): void {
    if (!this.isSpawned || !this.world) return;

    this._muzzleFlash = new Entity({
      parent: this,
      modelUri: "models/environment/muzzle-flash.gltf",
      modelScale: 0.5,
      opacity: 0,
    });

    const { position, rotation } = this.getMuzzleFlashPositionRotation();
    this._muzzleFlash.spawn(this.world, position, rotation);
  }

  /** Per-gun muzzle position/rotation in the gun's local space (official values). */
  public abstract getMuzzleFlashPositionRotation(): { position: Vector3Like; rotation: QuaternionLike };

  /** Eye-origin + camera facing direction (official). */
  public getShootOriginDirection(): { origin: Vector3Like; direction: Vector3Like } {
    const parentPlayerEntity = this.parent as PlayerEntity;
    const { x, y, z } = parentPlayerEntity.position;
    const cameraYOffset = parentPlayerEntity.player.camera.offset.y;
    const direction = parentPlayerEntity.player.camera.facingDirection;
    const origin = {
      x: x + direction.x * 0.5,
      y: y + direction.y * 0.5 + cameraYOffset,
      z: z + direction.z * 0.5,
    };
    return { origin, direction };
  }

  /** Fire-rate + ammo gate (official). Returns true if this shot may fire. */
  public processShoot(): boolean {
    const now = performance.now();

    if (this._lastFireTime && now - this._lastFireTime < 1000 / this.fireRate) {
      return false;
    }

    if (this.ammo <= 0) {
      this.reload();
      return false;
    }

    this.ammo--;
    this._lastFireTime = now;
    return true;
  }

  /** Reload from reserve (official flow + WaW reserve pool). */
  public reload(): void {
    if (!this.parent || !this.parent.world || this._reloading) return;
    if (this.ammo >= this.maxAmmo) return;          // clip already full
    if (this.reserveAmmo <= 0) return;              // dry — Director surfaces "out of ammo"

    const clipBefore = this.ammo;
    this.ammo = 0; // official trick: block firing while reloading
    this._reloading = true;
    this._reloadStartMs = performance.now();
    this._reloadAudio.play(this.parent.world, true);
    this._onAmmoChanged?.();

    setTimeout(() => {
      if (!this.isEquipped) return;
      const need = this.maxAmmo - clipBefore;
      const take = Math.min(need, this.reserveAmmo);
      this.ammo = clipBefore + take;
      this.reserveAmmo -= take;
      this._reloading = false;
      this._onAmmoChanged?.();
    }, this.reloadTimeMs);
  }

  /** Refill reserve to its starting value (Pack-a-Punch / max-ammo pickups). */
  public refillReserve(): void {
    this.reserveAmmo = this.maxReserve;
    this._onAmmoChanged?.();
  }

  /** Two-handed/one-handed hold loops on the player while this gun is equipped (official). */
  public setParentAnimations(): void {
    if (!this.parent || !this.parent.world) return;

    const ctrl = this.parent.controller as any;
    if (!ctrl) return;

    ctrl.idleLoopedAnimations = [this.idleAnimation, "idle_lower"];
    ctrl.walkLoopedAnimations = [this.idleAnimation, "walk_lower"];
    ctrl.runLoopedAnimations  = [this.idleAnimation, "run_lower"];
  }

  /** Base fire: raycast + player anim + muzzle flash + audio (official). */
  public shoot(): void {
    if (!this.parent || !this.parent.world) return;

    const parentPlayerEntity = this.parent as PlayerEntity;

    const { origin, direction } = this.getShootOriginDirection();
    this.shootRaycast(origin, direction, this.range);

    parentPlayerEntity.getModelAnimation(this.shootAnimation)?.restart();

    if (this._muzzleFlash) {
      this._muzzleFlash.setOpacity(1);
      setTimeout(() => {
        if (this.isSpawned && this._muzzleFlash?.isSpawned) {
          this._muzzleFlash.setOpacity(0);
        }
      }, 35);
    }

    this._shootAudio.play(this.parent.world, true);
    this._onShoot?.();
    this._onAmmoChanged?.();
  }

  /** Real physics raycast (official). Hit resolution is delegated to the Director. */
  public shootRaycast(origin: Vector3Like, direction: Vector3Like, length: number): void {
    if (!this.parent || !this.parent.world) return;

    const raycastHit = this.parent.world.simulation.raycast(origin, direction, length, {
      filterGroups: CollisionGroupsBuilder.buildRawCollisionGroups({
        belongsTo: [CollisionGroup.ALL],
        collidesWith: [CollisionGroup.BLOCK, CollisionGroup.ENTITY],
      }),
    });

    const primary = raycastHit?.hitEntity && raycastHit.hitPoint
      ? { entity: raycastHit.hitEntity, hitPoint: raycastHit.hitPoint }
      : null;

    const resolved = this._resolveHit?.(origin, direction, length, primary) ?? primary;

    if (resolved) {
      this._onHit?.(resolved.entity, resolved.hitPoint, this.damage);
    }
  }

  private static _getParentNodeName(hand: GunHand): string {
    return hand === "left" ? "hand_left_anchor" : "hand_right_anchor";
  }
}
