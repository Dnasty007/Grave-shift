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
