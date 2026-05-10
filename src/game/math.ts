import * as pc from "playcanvas";

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function normalize2D(
  x: number,
  y: number
): { x: number; y: number; length: number } {
  const length = Math.hypot(x, y);

  if (length <= 0.0001) {
    return { x: 0, y: 0, length: 0 };
  }

  return {
    x: x / length,
    y: y / length,
    length
  };
}

export function raySphereIntersection(
  origin: pc.Vec3,
  direction: pc.Vec3,
  center: pc.Vec3,
  radius: number
): number | null {
  const offset = center.clone().sub(origin);
  const projection = offset.dot(direction);

  if (projection < 0) {
    return null;
  }

  const closestPoint = origin.clone().add(direction.clone().mulScalar(projection));
  const distanceToCenter = closestPoint.distance(center);

  if (distanceToCenter > radius) {
    return null;
  }

  const thc = Math.sqrt(radius * radius - distanceToCenter * distanceToCenter);
  const t0 = projection - thc;
  const t1 = projection + thc;

  if (t0 >= 0) {
    return t0;
  }

  if (t1 >= 0) {
    return t1;
  }

  return null;
}

/**
 * Möller–Trumbore ray–triangle. Ray: origin + t * dir (dir must be unit length).
 * Returns t > 0 along the ray, or null.
 */
export function rayIntersectTriangle(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  v0x: number,
  v0y: number,
  v0z: number,
  v1x: number,
  v1y: number,
  v1z: number,
  v2x: number,
  v2y: number,
  v2z: number
): number | null {
  const eps = 1e-10;
  const e1x = v1x - v0x;
  const e1y = v1y - v0y;
  const e1z = v1z - v0z;
  const e2x = v2x - v0x;
  const e2y = v2y - v0y;
  const e2z = v2z - v0z;
  const hx = dy * e2z - dz * e2y;
  const hy = dz * e2x - dx * e2z;
  const hz = dx * e2y - dy * e2x;
  const a = e1x * hx + e1y * hy + e1z * hz;
  if (a > -eps && a < eps) return null;
  const f = 1 / a;
  const sx = ox - v0x;
  const sy = oy - v0y;
  const sz = oz - v0z;
  const u = f * (sx * hx + sy * hy + sz * hz);
  if (u < 0 || u > 1) return null;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = f * (dx * qx + dy * qy + dz * qz);
  if (v < 0 || u + v > 1) return null;
  const t = f * (e2x * qx + e2y * qy + e2z * qz);
  if (t > eps) return t;
  return null;
}
