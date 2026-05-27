import type { Entity, Player, PlayerEntity, Vector3Like } from "hytopia";

/**
 * Tunable first-person weapon sway.
 *
 * Updated for the attached-entity weapon pattern (official Hytopia zombies-fps style):
 * - Applies sway to camera offsets (for head/arms feel)
 * - Also applies sway to the attached weapon entity's local position when provided.
 *
 * See docs/HYTOPIA_BIBLE/15_VIEWMODELS_WEAPONS_AND_ATTACHMENTS.md
 */
// Temporary strong test values so you can actually feel the sway.
// We'll dial these down once you can see the effect.
export const WEAPON_SWAY_SIDE_AMPLITUDE = 0.12;
export const WEAPON_SWAY_BOB_AMPLITUDE = 0.07;
export const WEAPON_SWAY_DEPTH_AMPLITUDE = 0.05;
export const WEAPON_SWAY_FORWARD_LAG = 0.09;
export const WEAPON_SWAY_FREQUENCY = 1.6;
export const WEAPON_SWAY_SPEED_MULTIPLIER = 0.28;
export const WEAPON_SWAY_LAG_RESPONSE = 8.0;

const TAU = Math.PI * 2;
const MAX_DELTA_SECONDS = 0.1;

export type WeaponSwayOffset = {
  x: number;
  y: number;
  z: number;
  forward: number;
};

export const WEAPON_SWAY_ZERO: WeaponSwayOffset = {
  x: 0,
  y: 0,
  z: 0,
  forward: 0,
};

type WeaponSwayState = {
  elapsedSeconds: number;
  offset: WeaponSwayOffset;
};

export function calculateWeaponSwayTarget({
  elapsedSeconds,
  horizontalSpeed,
}: {
  elapsedSeconds: number;
  horizontalSpeed: number;
}): WeaponSwayOffset {
  const intensity = clamp01(horizontalSpeed * WEAPON_SWAY_SPEED_MULTIPLIER);
  if (intensity <= 0.001) return { ...WEAPON_SWAY_ZERO };

  const phase = elapsedSeconds * WEAPON_SWAY_FREQUENCY * (0.75 + intensity * 0.55) * TAU;

  return {
    x: Math.sin(phase) * WEAPON_SWAY_SIDE_AMPLITUDE * intensity,
    y: Math.sin(phase * 2 + Math.PI * 0.35) * WEAPON_SWAY_BOB_AMPLITUDE * intensity,
    z: Math.cos(phase) * WEAPON_SWAY_DEPTH_AMPLITUDE * intensity,
    forward: -WEAPON_SWAY_FORWARD_LAG * intensity,
  };
}

export function smoothWeaponSway(
  current: WeaponSwayOffset,
  target: WeaponSwayOffset,
  deltaSeconds: number
): WeaponSwayOffset {
  const alpha = 1 - Math.exp(-WEAPON_SWAY_LAG_RESPONSE * Math.min(deltaSeconds, MAX_DELTA_SECONDS));

  return {
    x: lerp(current.x, target.x, alpha),
    y: lerp(current.y, target.y, alpha),
    z: lerp(current.z, target.z, alpha),
    forward: lerp(current.forward, target.forward, alpha),
  };
}

export class WeaponSway {
  private readonly states = new Map<string, WeaponSwayState>();

  reset(player: Player): void {
    this.states.delete(player.id);
  }

  tickFirstPerson({
    player,
    playerEntity,
    deltaSeconds,
    baseCameraOffset,
    baseForwardOffset,
    baseWeaponLocalPosition,
  }: {
    player: Player;
    playerEntity: PlayerEntity;
    deltaSeconds: number;
    baseCameraOffset: Vector3Like;
    baseForwardOffset: number;
    attachedWeapon?: Entity;
    baseWeaponLocalPosition?: Vector3Like;
  }): void {
    const state = this.getState(player);
    const dt = Math.max(0, Math.min(deltaSeconds, MAX_DELTA_SECONDS));
    state.elapsedSeconds += dt;

    const horizontalSpeed = getHorizontalSpeed(playerEntity);
    const target = calculateWeaponSwayTarget({
      elapsedSeconds: state.elapsedSeconds,
      horizontalSpeed,
    });
    state.offset = smoothWeaponSway(state.offset, target, dt);

    // Camera sway (existing behavior)
    player.camera.setOffset({
      x: baseCameraOffset.x + state.offset.x,
      y: baseCameraOffset.y + state.offset.y,
      z: baseCameraOffset.z + state.offset.z,
    });
    player.camera.setForwardOffset(baseForwardOffset + state.offset.forward);

    void baseWeaponLocalPosition;
  }

  private getState(player: Player): WeaponSwayState {
    let state = this.states.get(player.id);
    if (!state) {
      state = {
        elapsedSeconds: 0,
        offset: { ...WEAPON_SWAY_ZERO },
      };
      this.states.set(player.id, state);
    }
    return state;
  }
}

function getHorizontalSpeed(playerEntity: PlayerEntity): number {
  try {
    const velocity = playerEntity.linearVelocity;
    return Math.hypot(velocity.x, velocity.z);
  } catch {
    return 0;
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, alpha: number): number {
  return from + (to - from) * alpha;
}
