import * as pc from "playcanvas";
import { GAME_CONFIG, MAP_CONFIG } from "./config";
import { clamp, raySphereIntersection } from "./math";
import type { CollisionWorld } from "./CollisionWorld";
import type { InputManager } from "./InputManager";
import type { Settings } from "./Settings";
import type { Weapon, WeaponInventory } from "./Weapon";
import { WEAPON_DEFINITIONS } from "./Weapon";
import { WeaponViewmodel } from "./WeaponViewmodel";
import type { Zombie } from "./Zombie";

export type ShotResult = {
  fired: boolean;
  hit: boolean;
  killed: boolean;
  headshot: boolean;
  origin: pc.Vec3;
  direction: pc.Vec3;
  hitPoint: pc.Vec3 | null;
  impactPoint: pc.Vec3;
  zombie: Zombie | null;
  empty: boolean;
  weaponId: string;
};

const PLAYER_RADIUS = 0.6;

export class PlayerController {
  readonly root = new pc.Entity("player");

  health: number = GAME_CONFIG.player.maxHealth;

  private readonly pivot = new pc.Entity("camera-pivot");
  private readonly camera = new pc.Entity("camera");
  private readonly input: InputManager;
  private readonly settings: Settings;
  private readonly inventory: WeaponInventory;
  private readonly viewmodel: WeaponViewmodel;
  private readonly collision: CollisionWorld;

  private yaw = 0;
  private pitch = -6;
  private fireCooldown = 0;
  private currentSpeed = 0;
  private didFireThisFrame = false;
  private lastDamageDirection: { x: number; y: number } | null = null;
  private recoilPitchKick = 0;

  constructor(
    input: InputManager,
    settings: Settings,
    inventory: WeaponInventory,
    collision: CollisionWorld
  ) {
    this.input = input;
    this.settings = settings;
    this.inventory = inventory;
    this.collision = collision;

    const openWorld =
      MAP_CONFIG.importVisual.enabled && MAP_CONFIG.importVisual.replacesArena;
    this.camera.addComponent("camera", {
      clearColor: new pc.Color(0.02, 0.03, 0.05),
      farClip: openWorld ? MAP_CONFIG.importVisual.cameraFarClip : 200,
      fov: settings.get().fov
    });

    settings.subscribe((state) => {
      const cameraComponent = this.camera.camera;
      if (cameraComponent) {
        cameraComponent.fov = state.fov;
      }
    });

    this.applyCameraPivotHeight();
    this.camera.setLocalPosition(0, 0, 0);

    this.root.addChild(this.pivot);
    this.pivot.addChild(this.camera);

    this.viewmodel = new WeaponViewmodel(this.camera);
    this.viewmodel.setWeapon(this.inventory.getCurrent());

    this.reset();
  }

  private applyCameraPivotHeight(): void {
    const openWorld =
      MAP_CONFIG.importVisual.enabled && MAP_CONFIG.importVisual.replacesArena;
    const y = openWorld ? MAP_CONFIG.importVisual.playerEyeHeight : 1.65;
    this.pivot.setLocalPosition(0, y, 0);
  }

  setCameraFarClip(distance: number): void {
    const cameraComponent = this.camera.camera;
    if (cameraComponent) {
      cameraComponent.farClip = distance;
    }
  }

  getPosition(): pc.Vec3 {
    return this.root.getPosition();
  }

  getCameraPosition(): pc.Vec3 {
    return this.camera.getPosition();
  }

  getCameraForward(): pc.Vec3 {
    return this.camera.forward.clone().normalize();
  }

  getCurrentWeapon(): Weapon {
    return this.inventory.getCurrent();
  }

  isCurrentlyReloading(): boolean {
    const weapon = this.inventory.getCurrent();
    return (weapon as Weapon & { _isReloading?: boolean })._isReloading === true;
  }

  getReloadProgress(): number {
    const weapon = this.inventory.getCurrent() as Weapon & { _reloadTimer?: number };
    if (!weapon._reloadTimer) return 0;
    return 1 - weapon._reloadTimer / weapon.definition.reloadSeconds;
  }

  reset(): void {
    this.health = GAME_CONFIG.player.maxHealth;
    this.pitch = -6;
    this.fireCooldown = 0;
    this.currentSpeed = 0;
    this.recoilPitchKick = 0;
    this.lastDamageDirection = null;

    if (MAP_CONFIG.importVisual.enabled && MAP_CONFIG.importVisual.replacesArena) {
      const s = MAP_CONFIG.importVisual.playerSpawn;
      this.yaw = MAP_CONFIG.importVisual.playerSpawnYawDegrees;
      this.root.setPosition(s.x, s.y, s.z);
    } else {
      this.yaw = 180;
      this.root.setPosition(0, 0, 8);
    }

    this.root.setEulerAngles(0, this.yaw, 0);
    this.pivot.setLocalEulerAngles(this.pitch, 0, 0);
    this.applyCameraPivotHeight();

    for (const slot of this.inventory.getSlots()) {
      if (!slot) continue;
      slot.resetAmmo();
      const internal = slot as Weapon & { _isReloading?: boolean; _reloadTimer?: number };
      internal._isReloading = false;
      internal._reloadTimer = 0;
    }
    this.viewmodel.setWeapon(this.inventory.getCurrent());
  }

  /**
   * Try to swap to the other weapon in the inventory. Returns true if a swap actually happened.
   */
  tryWeaponSwap(): boolean {
    const before = this.inventory.getCurrentSlotIndex();
    this.inventory.swap();
    const after = this.inventory.getCurrentSlotIndex();
    if (before === after) return false;
    this.viewmodel.setWeapon(this.inventory.getCurrent());
    this.fireCooldown = Math.max(this.fireCooldown, 0.4);
    return true;
  }

  notifyWeaponInventoryChanged(): void {
    this.viewmodel.setWeapon(this.inventory.getCurrent());
    this.fireCooldown = Math.max(this.fireCooldown, 0.3);
  }

  update(dt: number, zombies: Zombie[]): ShotResult | null {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.didFireThisFrame = false;
    this.recoilPitchKick = Math.max(0, this.recoilPitchKick - dt * 5);

    const lookDelta = this.input.consumeLookDelta();
    const settingsState = this.settings.get();
    const sensitivityScale = this.input.isTouchMode()
      ? settingsState.touchSensitivity
      : settingsState.mouseSensitivity;
    const verticalSign = settingsState.invertY ? -1 : 1;

    this.yaw +=
      lookDelta.x * GAME_CONFIG.player.mouseLookSensitivity * sensitivityScale;
    this.pitch = clamp(
      this.pitch +
        lookDelta.y *
          GAME_CONFIG.player.mouseLookSensitivity *
          sensitivityScale *
          verticalSign,
      -72,
      72
    );

    this.root.setEulerAngles(0, this.yaw, 0);
    this.pivot.setLocalEulerAngles(this.pitch - this.recoilPitchKick * 60, 0, 0);

    const moveInput = this.input.getMoveVector();
    const desiredMovement = new pc.Vec3();

    if (Math.abs(moveInput.x) > 0.001 || Math.abs(moveInput.y) > 0.001) {
      desiredMovement.add(this.root.right.clone().mulScalar(moveInput.x));
      desiredMovement.add(this.root.forward.clone().mulScalar(moveInput.y));
      desiredMovement.y = 0;
      desiredMovement.normalize();
    }

    let speed = this.input.isSprinting()
      ? GAME_CONFIG.player.sprintSpeed
      : GAME_CONFIG.player.moveSpeed;

    if (MAP_CONFIG.importVisual.enabled && MAP_CONFIG.importVisual.replacesArena) {
      speed *= MAP_CONFIG.importVisual.openWorldMoveMultiplier;
    }

    const currentPosition = this.root.getPosition().clone();
    const targetPosition = currentPosition
      .clone()
      .add(desiredMovement.mulScalar(speed * dt));

    const resolved = this.collision.resolvePlayerMovement(
      currentPosition,
      targetPosition,
      PLAYER_RADIUS
    );
    this.root.setPosition(resolved);

    this.currentSpeed = currentPosition.distance(resolved) / Math.max(0.0001, dt);

    const weapon = this.inventory.getCurrent();
    const internal = weapon as Weapon & { _isReloading?: boolean; _reloadTimer?: number };

    if (internal._isReloading) {
      internal._reloadTimer = Math.max(0, (internal._reloadTimer ?? 0) - dt);
      if ((internal._reloadTimer ?? 0) === 0) {
        const needed = weapon.definition.magazineSize - weapon.ammoMag;
        const taken = Math.min(needed, weapon.ammoReserve);
        weapon.ammoMag += taken;
        weapon.ammoReserve -= taken;
        internal._isReloading = false;
      }

      this.viewmodel.update(dt, {
        moveSpeed: this.currentSpeed,
        isFiring: this.input.isFiring(),
        didFire: false,
        isReloading: true
      });
      return null;
    }

    if (this.input.consumeReloadRequest() || (this.input.isFiring() && weapon.ammoMag === 0)) {
      this.tryStartReload();
    }

    let result: ShotResult | null = null;

    if (this.input.isFiring() && this.fireCooldown <= 0 && !internal._isReloading) {
      if (weapon.ammoMag <= 0) {
        this.fireCooldown = 0.18;
        result = this.emptyShot(weapon);
      } else {
        result = this.fire(weapon, zombies);
        this.didFireThisFrame = true;
        this.recoilPitchKick = Math.min(0.18, this.recoilPitchKick + weapon.definition.recoilKick);
      }
    }

    this.viewmodel.update(dt, {
      moveSpeed: this.currentSpeed,
      isFiring: this.input.isFiring(),
      didFire: this.didFireThisFrame,
      isReloading: Boolean(internal._isReloading)
    });

    return result;
  }

  damage(amount: number, sourcePosition?: pc.Vec3): void {
    this.health = Math.max(0, this.health - amount);

    if (sourcePosition) {
      const player = this.root.getPosition();
      const dx = sourcePosition.x - player.x;
      const dz = sourcePosition.z - player.z;
      const yawRad = (this.yaw * Math.PI) / 180;
      const cos = Math.cos(yawRad);
      const sin = Math.sin(yawRad);
      const localX = dx * cos - dz * sin;
      const localZ = dx * sin + dz * cos;
      this.lastDamageDirection = { x: localX, y: localZ };
    } else {
      this.lastDamageDirection = null;
    }
  }

  consumeDamageDirection(): { x: number; y: number } | null {
    const direction = this.lastDamageDirection;
    this.lastDamageDirection = null;
    return direction;
  }

  getHealthRatio(): number {
    return this.health / GAME_CONFIG.player.maxHealth;
  }

  tryStartReload(): boolean {
    const weapon = this.inventory.getCurrent();
    const internal = weapon as Weapon & { _isReloading?: boolean; _reloadTimer?: number };
    if (internal._isReloading) return false;
    if (weapon.ammoMag === weapon.definition.magazineSize) return false;
    if (weapon.ammoReserve <= 0) return false;
    internal._isReloading = true;
    internal._reloadTimer = weapon.definition.reloadSeconds;
    return true;
  }

  private emptyShot(weapon: Weapon): ShotResult {
    const origin = this.camera.getPosition().clone();
    const direction = this.camera.forward.clone().normalize();
    return {
      fired: false,
      hit: false,
      killed: false,
      headshot: false,
      origin,
      direction,
      hitPoint: null,
      impactPoint: origin.clone().add(direction.mulScalar(weapon.definition.range)),
      zombie: null,
      empty: true,
      weaponId: weapon.definition.id
    };
  }

  private fire(weapon: Weapon, zombies: Zombie[]): ShotResult {
    const def = weapon.definition;
    this.fireCooldown = def.fireIntervalSeconds;
    weapon.ammoMag -= 1;

    const origin = this.camera.getPosition().clone();
    const baseDirection = this.camera.forward.clone().normalize();
    const right = this.camera.right.clone().normalize();
    const up = this.camera.up.clone().normalize();

    const pellets = def.pelletsPerShot;
    let totalKilled = false;
    let totalHit = false;
    let firstHitPoint: pc.Vec3 | null = null;
    let firstHeadshot = false;
    let firstZombie: Zombie | null = null;
    let furthestImpact = origin
      .clone()
      .add(baseDirection.clone().mulScalar(def.range));

    for (let p = 0; p < pellets; p += 1) {
      const direction = baseDirection.clone();
      const spreadRad = (def.spreadDegrees * Math.PI) / 180;
      const offsetAngle = (Math.random() - 0.5) * 2 * spreadRad;
      const offsetTilt = (Math.random() - 0.5) * 2 * spreadRad;
      direction
        .add(right.clone().mulScalar(Math.tan(offsetAngle)))
        .add(up.clone().mulScalar(Math.tan(offsetTilt)))
        .normalize();

      let closestZombie: Zombie | null = null;
      let closestDistance = Number.POSITIVE_INFINITY;
      let closestIsHeadshot = false;

      for (const zombie of zombies) {
        if (!zombie.alive) continue;

        const headTarget = zombie.getHeadTarget();
        const headRadius = zombie.getHeadRadius();
        const headHit = raySphereIntersection(origin, direction, headTarget, headRadius);

        if (headHit !== null && headHit <= def.range && headHit < closestDistance) {
          closestDistance = headHit;
          closestZombie = zombie;
          closestIsHeadshot = true;
          continue;
        }

        const bodyHit = raySphereIntersection(
          origin,
          direction,
          zombie.getAimTarget(),
          zombie.getHitRadius() + def.hitRadius - WEAPON_DEFINITIONS.pistol.hitRadius
        );
        if (bodyHit !== null && bodyHit <= def.range && bodyHit < closestDistance) {
          closestDistance = bodyHit;
          closestZombie = zombie;
          closestIsHeadshot = false;
        }
      }

      const impactDistance = Math.min(closestDistance, def.range);
      const impactPoint = origin.clone().add(direction.clone().mulScalar(impactDistance));

      if (p === 0 || impactDistance > furthestImpact.distance(origin)) {
        furthestImpact = impactPoint;
      }

      if (!closestZombie) continue;

      const damage = closestIsHeadshot ? def.damage * def.headshotMultiplier : def.damage;
      const killed = closestZombie.applyDamage(damage);

      totalHit = true;
      if (killed) totalKilled = true;
      if (!firstHitPoint) {
        firstHitPoint = impactPoint;
        firstHeadshot = closestIsHeadshot;
        firstZombie = closestZombie;
      }
    }

    return {
      fired: true,
      hit: totalHit,
      killed: totalKilled,
      headshot: firstHeadshot,
      origin,
      direction: baseDirection,
      hitPoint: firstHitPoint,
      impactPoint: firstHitPoint ?? furthestImpact,
      zombie: firstZombie,
      empty: false,
      weaponId: def.id
    };
  }
}
