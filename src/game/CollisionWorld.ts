import * as pc from "playcanvas";

export type CollisionId = number;

export type CollisionBox = {
  id: CollisionId;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  blocksZombies: boolean;
};

let nextId: CollisionId = 1;

/**
 * Lightweight 2D AABB collider used to keep the player and zombies out of
 * walls, fences, doors, and other props. We only care about the X/Z plane;
 * Y is handled by the existing flat ground.
 */
export class CollisionWorld {
  private readonly boxes: Map<CollisionId, CollisionBox> = new Map();

  add(box: Omit<CollisionBox, "id">): CollisionId {
    const id = nextId++;
    this.boxes.set(id, { ...box, id });
    return id;
  }

  addFromCenter(
    centerX: number,
    centerZ: number,
    sizeX: number,
    sizeZ: number,
    blocksZombies = true
  ): CollisionId {
    return this.add({
      minX: centerX - sizeX * 0.5,
      maxX: centerX + sizeX * 0.5,
      minZ: centerZ - sizeZ * 0.5,
      maxZ: centerZ + sizeZ * 0.5,
      blocksZombies
    });
  }

  remove(id: CollisionId): void {
    this.boxes.delete(id);
  }

  clear(): void {
    this.boxes.clear();
  }

  /**
   * Resolve player movement against all colliders. Sweeps each axis
   * independently, which is good enough for a simple top-down arena.
   */
  resolvePlayerMovement(current: pc.Vec3, desired: pc.Vec3, radius: number): pc.Vec3 {
    let nx = desired.x;
    let nz = desired.z;

    for (const box of this.boxes.values()) {
      if (this.overlapsXZ(nx, current.z, radius, box)) {
        if (current.x < box.minX) nx = box.minX - radius;
        else if (current.x > box.maxX) nx = box.maxX + radius;
      }
    }

    for (const box of this.boxes.values()) {
      if (this.overlapsXZ(nx, nz, radius, box)) {
        if (current.z < box.minZ) nz = box.minZ - radius;
        else if (current.z > box.maxZ) nz = box.maxZ + radius;
      }
    }

    return new pc.Vec3(nx, desired.y, nz);
  }

  /**
   * Cheap zombie pathing nudge: if the zombie is inside a collider that
   * blocks zombies, push it back out along the shortest axis.
   */
  /** Push a circular XZ footprint out of one AABB (mutates `position`). Returns true if there was overlap. */
  private pushOutOfBox(position: pc.Vec3, radius: number, box: CollisionBox): boolean {
    if (!this.overlapsXZ(position.x, position.z, radius, box)) {
      return false;
    }

    const overlapMinX = position.x - (box.minX - radius);
    const overlapMaxX = (box.maxX + radius) - position.x;
    const overlapMinZ = position.z - (box.minZ - radius);
    const overlapMaxZ = (box.maxZ + radius) - position.z;

    const minX = Math.min(overlapMinX, overlapMaxX);
    const minZ = Math.min(overlapMinZ, overlapMaxZ);

    if (minX < minZ) {
      if (overlapMinX < overlapMaxX) {
        position.x = box.minX - radius;
      } else {
        position.x = box.maxX + radius;
      }
    } else {
      if (overlapMinZ < overlapMaxZ) {
        position.z = box.minZ - radius;
      } else {
        position.z = box.maxZ + radius;
      }
    }
    return true;
  }

  resolveZombiePosition(position: pc.Vec3, radius: number): void {
    for (const box of this.boxes.values()) {
      if (!box.blocksZombies) continue;
      this.pushOutOfBox(position, radius, box);
    }
  }

  /**
   * Resolve against every XZ collider (walls, crates, barrels, decorative boxes).
   * Used so C4 sticks to props that are not zombie-blocking.
   */
  resolveAgainstAllColliders(position: pc.Vec3, radius: number): void {
    for (const box of this.boxes.values()) {
      this.pushOutOfBox(position, radius, box);
    }
  }

  /** True if XZ footprint overlaps any collider (including non-zombie-blocking props). */
  overlapsAnyColliderXZ(x: number, z: number, radius: number): boolean {
    for (const box of this.boxes.values()) {
      if (this.overlapsXZ(x, z, radius, box)) return true;
    }
    return false;
  }

  private overlapsXZ(x: number, z: number, radius: number, box: CollisionBox): boolean {
    return (
      x + radius > box.minX &&
      x - radius < box.maxX &&
      z + radius > box.minZ &&
      z - radius < box.maxZ
    );
  }

  /**
   * True if a circle in XZ overlaps any collider that blocks movement (walls, props).
   * Used by sticky bombs to detect wall impact.
   */
  overlapsBlockingXZ(x: number, z: number, radius: number): boolean {
    for (const box of this.boxes.values()) {
      if (!box.blocksZombies) continue;
      if (this.overlapsXZ(x, z, radius, box)) return true;
    }
    return false;
  }
}
