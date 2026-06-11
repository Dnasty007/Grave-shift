import {
  CollisionGroup,
  CollisionGroupsBuilder,
  Entity,
  PlayerEntity,
  Quaternion,
  type QuaternionLike,
  type Vector3Like,
  World,
} from "hytopia";

/**
 * Melee sword parented to the soldier rig's hand_right_anchor (same anchor as guns).
 * Blockbench sword GLTFs are tuned with SWORD_HAND_* — adjust there if the grip looks off.
 */
export type SwordEntityOptions = {
  name: string;
  modelUri: string;
  modelScale: number;
  damage: number;
  swingRate: number;
  range: number;
  parent?: PlayerEntity;
  onSwing?: () => void;
  onHit?: (hitEntity: Entity, hitPoint: Vector3Like, baseDamage: number) => void;
};

/** Local transform on hand_right_anchor for Blockbench-export swords. */
export const SWORD_HAND_POSITION: Vector3Like = { x: 0.04, y: 0.02, z: -0.12 };
export const SWORD_HAND_ROTATION: QuaternionLike = Quaternion.fromEuler(-105, 0, 0);

export default class SwordEntity extends Entity {
  public readonly damage: number;
  private readonly _swingRate: number;
  private readonly _range: number;
  private _lastSwingMs = 0;
  private readonly _onSwing?: () => void;
  private readonly _onHit?: (hitEntity: Entity, hitPoint: Vector3Like, baseDamage: number) => void;

  public constructor(options: SwordEntityOptions) {
    super({
      name: options.name,
      modelUri: options.modelUri,
      modelScale: options.modelScale,
      parent: options.parent,
      parentNodeName: options.parent ? "hand_right_anchor" : undefined,
    });

    this.damage = options.damage;
    this._swingRate = options.swingRate;
    this._range = options.range;
    this._onSwing = options.onSwing;
    this._onHit = options.onHit;

    if (options.parent) {
      this.setParentAnimations();
    }
  }

  public get isEquipped(): boolean {
    return !!this.parent;
  }

  public override spawn(world: World, position: Vector3Like, rotation?: QuaternionLike): void {
    super.spawn(world, position, rotation);
  }

  /** Detach from the hand anchor, then despawn (matches official GunEntity unequip). */
  public static detachAndDespawn(sword: SwordEntity): void {
    try {
      sword.setParent(undefined);
    } catch {
      /* already detached */
    }
    try {
      sword.setOpacity(0);
    } catch {
      /* optional */
    }
    try {
      sword.despawn();
    } catch {
      /* entity may already be gone */
    }
  }

  public setParentAnimations(): void {
    if (!this.parent?.controller) return;
    const ctrl = this.parent.controller as {
      idleLoopedAnimations?: string[];
      walkLoopedAnimations?: string[];
      runLoopedAnimations?: string[];
    };
    ctrl.idleLoopedAnimations = ["idle_lower"];
    ctrl.walkLoopedAnimations = ["walk_lower"];
    ctrl.runLoopedAnimations = ["run_lower"];
  }

  public swing(): void {
    if (!this.parent || !this.parent.world) return;

    const now = performance.now();
    if (this._lastSwingMs && now - this._lastSwingMs < 1000 / this._swingRate) {
      return;
    }
    this._lastSwingMs = now;

    const parentPlayerEntity = this.parent as PlayerEntity;
    const { origin, direction } = this.getSwingOriginDirection();
    this.swingRaycast(origin, direction, this._range);

    parentPlayerEntity.getModelAnimation("shoot_gun_right")?.restart();
    parentPlayerEntity.player.input.ml = false;
    this._onSwing?.();
  }

  public getSwingOriginDirection(): { origin: Vector3Like; direction: Vector3Like } {
    const parentPlayerEntity = this.parent as PlayerEntity;
    const { x, y, z } = parentPlayerEntity.position;
    const cameraYOffset = parentPlayerEntity.player.camera.offset.y;
    const direction = parentPlayerEntity.player.camera.facingDirection;
    return {
      origin: {
        x: x + direction.x * 0.35,
        y: y + direction.y * 0.35 + cameraYOffset,
        z: z + direction.z * 0.35,
      },
      direction,
    };
  }

  private swingRaycast(origin: Vector3Like, direction: Vector3Like, length: number): void {
    if (!this.parent?.world) return;

    const raycastHit = this.parent.world.simulation.raycast(origin, direction, length, {
      filterGroups: CollisionGroupsBuilder.buildRawCollisionGroups({
        belongsTo: [CollisionGroup.ALL],
        collidesWith: [CollisionGroup.BLOCK, CollisionGroup.ENTITY],
      }),
    });

    if (raycastHit?.hitEntity) {
      this._onHit?.(raycastHit.hitEntity, raycastHit.hitPoint, this.damage);
    }
  }
}
