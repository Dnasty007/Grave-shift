import * as pc from "playcanvas";
import type { AnimTrack } from "playcanvas";
import { GAME_CONFIG, MAP_CONFIG } from "./config";
import { clamp, raySphereIntersection } from "./math";
import type { CollisionWorld } from "./CollisionWorld";
import type { InputManager } from "./InputManager";
import type { Settings, SettingsState } from "./Settings";
import type { Weapon, WeaponId, WeaponInventory } from "./Weapon";
import { WEAPON_DEFINITIONS } from "./Weapon";
import { WeaponViewmodel } from "./WeaponViewmodel";
import type { EnemyModelKit, Zombie } from "./Zombie";
import type { Map as GameMap } from "./Map";
import { getPlayerVisualRuntime } from "./runSession";

/**
 * First-person rig + combat for one `player` entity.
 *
 * | Block | In-game effect |
 * | ----- | -------------- |
 * | Camera graph (`root` → pivot → camera) | Eye height, look pitch/yaw, weapon viewmodel parent |
 * | `update()` | WASD / touch move, sprint, reload timer, hitscan fire |
 * | `reset()` | Spawn position: arena yard vs MAP_CONFIG open-world spawn |
 * | `fire` / `emptyShot` | Ray vs zombie capsules; headshot vs body |
 */
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

  /** Camera rig: root = feet/world move; pivot = eye height; camera = shoot ray origin */

  private readonly pivot = new pc.Entity("camera-pivot");
  private readonly camera = new pc.Entity("camera");
  private readonly input: InputManager;
  private readonly settings: Settings;
  private readonly inventory: WeaponInventory;
  private readonly viewmodel: WeaponViewmodel;
  private readonly collision: CollisionWorld;
  private readonly gameMap: GameMap;

  private yaw = 0;
  private pitch = -6;
  private fireCooldown = 0;
  private currentSpeed = 0;
  private didFireThisFrame = false;
  private lastDamageDirection: { x: number; y: number } | null = null;
  private recoilPitchKick = 0;
  /** Jump / fall vertical speed on feet (ignored in fly or noclip). */
  private verticalVelocity = 0;
  private characterVisual: pc.Entity | null = null;
  private characterAnim: pc.AnimComponent | null = null;
  private resolveCharacterAnim: ((name: string) => AnimTrack | undefined) | null = null;
  private characterLocoMode: "walk" | "run" | null = null;

  // --- Construction: camera + subscribe FOV; imported mode uses 1.7 m eye height ---

  constructor(
    input: InputManager,
    settings: Settings,
    inventory: WeaponInventory,
    collision: CollisionWorld,
    gameMap: GameMap,
    weaponViewAssets: ReadonlyMap<WeaponId, { asset: pc.Asset }>
  ) {
    this.input = input;
    this.settings = settings;
    this.inventory = inventory;
    this.collision = collision;
    this.gameMap = gameMap;

    const importOn = MAP_CONFIG.importVisual.enabled;
    const openWorld =
      MAP_CONFIG.importVisual.enabled && MAP_CONFIG.importVisual.replacesArena;
    this.camera.addComponent("camera", {
      clearColor: importOn
        ? new pc.Color(0.55, 0.68, 0.82)
        : new pc.Color(0.02, 0.03, 0.05),
      nearClip: 0.04,
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

    this.viewmodel = new WeaponViewmodel(this.camera, weaponViewAssets);
    this.viewmodel.setWeapon(this.inventory.getCurrent());

    this.reset();
  }

  // --- Camera tuning: pivot Y = 1.7 when GLB import is on (arena: 1.65) ---

  /** Eye height: import mode uses `GAME_CONFIG.player.importEyeHeightAboveFeet` (tune with voxel rig scale). */
  private applyCameraPivotHeight(): void {
    const y = MAP_CONFIG.importVisual.enabled
      ? GAME_CONFIG.player.importEyeHeightAboveFeet
      : 1.65;
    this.pivot.setLocalPosition(0, y, 0);
  }

  setCameraFarClip(distance: number): void {
    const cameraComponent = this.camera.camera;
    if (cameraComponent) {
      cameraComponent.farClip = distance;
    }
  }

  /**
   * Attach a Blockbench / Hytopia glTF under `root` (same `voxelAvatar` scale as zombies).
   * Body renders are optional (`playerVisual.hideBodyInFirstPerson`).
   */
  attachCharacterModel(kit: EnemyModelKit): void {
    if (this.characterVisual) {
      this.characterVisual.destroy();
      this.characterVisual = null;
      this.characterAnim = null;
      this.resolveCharacterAnim = null;
      this.characterLocoMode = null;
    }
    let ent: pc.Entity;
    try {
      ent = kit.instantiate();
    } catch (e) {
      console.warn("[PlayerController] glTF instantiate failed.", e);
      return;
    }
    ent.name = "player-gltf";
    const av = GAME_CONFIG.voxelAvatar;
    const s = av.modelScale;
    ent.setLocalScale(s, s, s);
    ent.setLocalPosition(0, av.yOffset, 0);
    ent.setLocalEulerAngles(0, av.yawOffsetDeg, 0);
    this.root.insertChild(ent, 0);
    if (getPlayerVisualRuntime().hideBodyInFirstPerson) {
      const renders = ent.findComponents("render") as pc.RenderComponent[];
      for (let i = 0; i < renders.length; i++) {
        renders[i].enabled = false;
      }
    }
    this.attachPlayerLocomotion(ent, kit);
    this.characterVisual = ent;
  }

  private attachPlayerLocomotion(visual: pc.Entity, kit: EnemyModelKit): void {
    visual.addComponent("anim");
    this.characterAnim = visual.anim ?? null;
    if (!this.characterAnim) {
      return;
    }
    const pv = getPlayerVisualRuntime();
    const walk = kit.getAnimTrack(pv.animWalkName);
    const run = kit.getAnimTrack(pv.animRunName);
    const fallback = kit.getAnimTrack(pv.animFallbackName);
    const track = walk ?? run ?? fallback;
    if (!track) {
      console.warn("[PlayerController] No glTF clips matched player anim names.");
      return;
    }
    this.resolveCharacterAnim = kit.getAnimTrack.bind(kit);
    this.characterAnim.activate = true;
    this.characterAnim.playing = true;
    this.characterAnim.assignAnimation("Locomotion", track, undefined, 1, true);
    this.characterLocoMode = walk ? "walk" : run ? "run" : "walk";
  }

  private updatePlayerCharacterLocomotion(
    settingsState: SettingsState,
    moveInput: { x: number; y: number }
  ): void {
    if (!this.characterAnim || !this.resolveCharacterAnim) {
      return;
    }
    const pv = getPlayerVisualRuntime();
    const fly = settingsState.flyMode;
    const noclip = settingsState.noclip;
    const hasMove =
      !fly &&
      !noclip &&
      (Math.abs(moveInput.x) > 0.001 || Math.abs(moveInput.y) > 0.001);

    if (!hasMove || this.currentSpeed < pv.animIdleThreshold) {
      this.characterAnim.speed = 0;
      return;
    }

    const runTrack = this.resolveCharacterAnim(pv.animRunName);
    const wantRun =
      this.input.isSprinting() && this.currentSpeed >= pv.animRunMinSpeed && !!runTrack;
    const mode: "walk" | "run" = wantRun ? "run" : "walk";
    const clipName = mode === "run" ? pv.animRunName : pv.animWalkName;
    let track = this.resolveCharacterAnim(clipName);
    if (!track) {
      track =
        this.resolveCharacterAnim(pv.animWalkName) ??
        this.resolveCharacterAnim(pv.animRunName) ??
        this.resolveCharacterAnim(pv.animFallbackName);
    }
    if (track && this.characterLocoMode !== mode) {
      this.characterAnim.assignAnimation("Locomotion", track, undefined, 1, true);
      this.characterLocoMode = mode;
    }

    const ref = GAME_CONFIG.player.moveSpeed;
    const mul = pc.math.clamp(this.currentSpeed / ref, pv.animSpeedMin, pv.animSpeedMax);
    this.characterAnim.speed = mul * pv.animBaseSpeed;
  }

  // --- World/camera readouts + reload state (HUD, FX, interactions) ---

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

  // --- Run reset: health, spawn (arena vs MAP_CONFIG), ammo ---

  reset(): void {
    this.health = GAME_CONFIG.player.maxHealth;
    this.pitch = -6;
    this.fireCooldown = 0;
    this.currentSpeed = 0;
    this.recoilPitchKick = 0;
    this.verticalVelocity = 0;
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
   * Cycle equipped weapon (`delta` +1 = next, -1 = previous among owned guns).
   */
  tryWeaponCycle(delta: number): boolean {
    if (!this.inventory.cycle(delta)) return false;
    this.viewmodel.setWeapon(this.inventory.getCurrent());
    this.fireCooldown = Math.max(this.fireCooldown, 0.4);
    return true;
  }

  /** When a view glTF finishes loading, rebuild the model if it is the active weapon. */
  refreshWeaponViewmodel(): void {
    this.viewmodel.refreshIfCurrent(this.inventory.getCurrent().definition.id);
  }

  notifyWeaponInventoryChanged(): void {
    this.viewmodel.setWeapon(this.inventory.getCurrent());
    this.fireCooldown = Math.max(this.fireCooldown, 0.3);
  }

  /**
   * True while jumping/falling so `GameApp` terrain cling does not cancel airborne motion.
   */
  suppressesTerrainCling(): boolean {
    if (Math.abs(this.verticalVelocity) > 0.2) {
      return true;
    }
    const pos = this.root.getPosition();
    if (!MAP_CONFIG.importVisual.enabled) {
      return false;
    }
    const g = this.gameMap.sampleImportedTerrainYNearFeet(pos.x, pos.z, pos.y);
    if (g == null) {
      return false;
    }
    const feet = g + MAP_CONFIG.importVisual.groundSnapClearance;
    return pos.y > feet + 0.055;
  }

  private applyJumpAndGravity(dt: number, settingsState: SettingsState): void {
    if (settingsState.flyMode) {
      return;
    }

    const pos = this.root.getPosition();
    const clearance = MAP_CONFIG.importVisual.groundSnapClearance;
    let groundY: number | null;

    if (MAP_CONFIG.importVisual.enabled) {
      groundY = this.gameMap.sampleImportedTerrainYNearFeet(pos.x, pos.z, pos.y);
    } else {
      groundY = 0;
    }
    if (groundY == null || !Number.isFinite(groundY)) {
      void this.input.consumeJumpRequest();
      return;
    }

    const feetTarget = groundY + clearance;
    const onGround = pos.y <= feetTarget + 0.085 && this.verticalVelocity <= 0.45;

    const wantJump = this.input.consumeJumpRequest();
    if (wantJump && onGround) {
      this.verticalVelocity = GAME_CONFIG.player.jumpImpulse;
    }

    this.verticalVelocity -= GAME_CONFIG.player.jumpGravity * dt;

    let y = pos.y + this.verticalVelocity * dt;
    if (y < feetTarget) {
      y = feetTarget;
      if (this.verticalVelocity < 0) {
        this.verticalVelocity = 0;
      }
    }
    this.root.setPosition(pos.x, y, pos.z);
  }

  /**
   * When mesh collision clips XZ, snap feet onto the next tread / lip. Uses both a "stuck" path
   * and a forward ground probe so voxels stairs work before movement is fully zeroed.
   */
  private tryImportedMeshAutoStep(
    current: pc.Vec3,
    after: pc.Vec3,
    target: pc.Vec3,
    settingsState: SettingsState
  ): pc.Vec3 {
    if (!MAP_CONFIG.importVisual.enabled || !MAP_CONFIG.importVisual.replacesArena) {
      return after;
    }
    if (!settingsState.importMeshCollision || settingsState.flyMode || settingsState.noclip) {
      return after;
    }

    const cfg = GAME_CONFIG.player;
    const up = MAP_CONFIG.importVisual.groundSnapClearance;
    const maxRise = cfg.importAutoStepMaxRise;
    const bias = cfg.importAutoStepGroundRefBias;

    const flatInX = target.x - current.x;
    const flatInZ = target.z - current.z;
    const lenIn = Math.hypot(flatInX, flatInZ);
    if (lenIn < 0.035) {
      return after;
    }

    const dirX = flatInX / lenIn;
    const dirZ = flatInZ / lenIn;

    const flatOutX = after.x - current.x;
    const flatOutZ = after.z - current.z;
    const lenOut = Math.hypot(flatOutX, flatOutZ);
    const stuck = lenOut < lenIn * cfg.importAutoStepStuckRatio;

    const considerFeet = (groundY: number | null): number | null => {
      if (groundY == null || !Number.isFinite(groundY)) {
        return null;
      }
      const targetFeet = groundY + up;
      if (targetFeet > after.y + 0.016 && targetFeet <= after.y + maxRise + 0.1) {
        return targetFeet;
      }
      return null;
    };

    let bestFeet: number | null = null;
    const pushFeet = (feet: number | null) => {
      if (feet == null) return;
      if (bestFeet == null || feet > bestFeet) {
        bestFeet = feet;
      }
    };

    const gx = (x: number, z: number, refY: number) =>
      considerFeet(this.gameMap.sampleImportedTerrainYNearFeet(x, z, refY));

    const probe = cfg.importAutoStepProbeAhead;

    if (stuck) {
      const refStuck = Math.max(after.y, current.y) + bias;
      pushFeet(gx(after.x + dirX * probe, after.z + dirZ * probe, refStuck));
      pushFeet(
        gx(
          current.x + dirX * probe * 0.52,
          current.z + dirZ * probe * 0.52,
          current.y + maxRise * 0.92
        )
      );
    }

    const lead = Math.min(
      cfg.importAutoStepLeadForward,
      Math.max(lenIn + PLAYER_RADIUS * 0.98, PLAYER_RADIUS * 1.12)
    );
    const refFwd = current.y + Math.min(maxRise * 0.64, 0.55);
    pushFeet(gx(current.x + dirX * lead, current.z + dirZ * lead, refFwd));

    if (bestFeet != null) {
      return new pc.Vec3(after.x, bestFeet, after.z);
    }
    return after;
  }

  // --- Main tick: movement (XZ + collision), look, reload, firing ---

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
      ? GAME_CONFIG.player.sprintSpeed *
        clamp(settingsState.sprintSpeedMultiplier, 0.5, 2.5)
      : GAME_CONFIG.player.moveSpeed;

    if (MAP_CONFIG.importVisual.enabled && MAP_CONFIG.importVisual.replacesArena) {
      speed *= MAP_CONFIG.importVisual.openWorldMoveMultiplier;
    }

    const currentPosition = this.root.getPosition().clone();
    let targetPosition = currentPosition
      .clone()
      .add(desiredMovement.mulScalar(speed * dt));

    const fly = settingsState.flyMode;
    const noclip = settingsState.noclip;

    if (fly) {
      let flyDelta = 0;
      if (this.input.isFlyAscend()) flyDelta += 1;
      if (this.input.isFlyDescend()) flyDelta -= 1;
      if (flyDelta !== 0) {
        targetPosition.y += flyDelta * GAME_CONFIG.player.flyVerticalSpeed * dt;
      }
    }

    if (fly || noclip) {
      this.root.setPosition(targetPosition);
    } else {
      const resolved = this.collision.resolvePlayerMovement(
        currentPosition,
        targetPosition,
        PLAYER_RADIUS
      );
      let after = resolved;
      if (
        MAP_CONFIG.importVisual.enabled &&
        MAP_CONFIG.importVisual.replacesArena &&
        settingsState.importMeshCollision
      ) {
        after = this.gameMap.resolveImportedWallCollision(
          currentPosition,
          resolved,
          PLAYER_RADIUS
        );
        after = this.tryImportedMeshAutoStep(currentPosition, after, targetPosition, settingsState);
        after = this.gameMap.resolveImportedWallCollision(
          currentPosition,
          after,
          PLAYER_RADIUS,
          after.y
        );
      }
      this.root.setPosition(after);
    }

    if (!fly) {
      this.applyJumpAndGravity(dt, settingsState);
    }

    this.currentSpeed = currentPosition.distance(this.root.getPosition()) / Math.max(0.0001, dt);

    this.updatePlayerCharacterLocomotion(settingsState, moveInput);

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

  // --- Incoming zombie damage → health + flash direction for UI ---

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

  // --- Hitscan vs zombies (spread rays, capsule tests, damage application) ---

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
