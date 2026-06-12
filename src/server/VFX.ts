import { Entity, World, type Vector3Like } from "hytopia";

const VFX_MODEL_URI = "models/projectiles/fireball.gltf";

/**
 * VFX.ts - Improved visual effects for Project Gehenna
 * Uses simple, reliable entity-based effects.
 *
 * NOTE: gun muzzle flash is NOT here — each GunEntity owns a muzzle-flash child
 * entity (official zombies-fps pattern, see src/server/guns/GunEntity.ts).
 */
export class VFX {
  /**
   * Blood / hit effect on zombies
   */
  static bloodHit(world: World, position: { x: number; y: number; z: number }, _headshot = false) {
    const blood = new Entity({
      name: "BloodHit",
      modelUri: VFX_MODEL_URI,
      modelScale: 0.35,
    });
    blood.spawn(world, position);

    setTimeout(() => {
      try {
        if (blood.isSpawned) blood.despawn();
      } catch {}
    }, 220);
  }

  /**
   * Death explosion when a zombie is killed
   */
  static deathExplosion(world: World, position: { x: number; y: number; z: number }) {
    VFX.lethalExplosion(world, position, 0.7);
  }

  static lethalExplosion(
    world: World,
    position: { x: number; y: number; z: number },
    scale = 1.0
  ) {
    // Core flash - bigger and brighter for impact
    const core = new Entity({
      name: "LethalExplosionCore",
      modelUri: VFX_MODEL_URI,
      modelScale: scale * 1.6,
    });
    core.spawn(world, position);

    // Secondary inner flash (different timing for layered pop)
    const inner = new Entity({
      name: "LethalExplosionInner",
      modelUri: VFX_MODEL_URI,
      modelScale: scale * 0.9,
    });
    setTimeout(() => {
      if (world) inner.spawn(world, { x: position.x + (Math.random()-0.5)*0.4, y: position.y + 0.3, z: position.z + (Math.random()-0.5)*0.4 });
    }, 35);

    // Outer ring flash for bigger feel (C4 especially)
    const outer = new Entity({
      name: "LethalExplosionOuter",
      modelUri: VFX_MODEL_URI,
      modelScale: scale * 2.35,
    });
    setTimeout(() => {
      if (world) outer.spawn(world, position);
    }, 80);

    // Debris sparks / flying embers (4-6 small quick ones)
    for (let i = 0; i < 6; i++) {
      const debris = new Entity({
        name: "LethalDebris",
        modelUri: VFX_MODEL_URI,
        modelScale: scale * (0.18 + Math.random() * 0.22),
      });
      const off = {
        x: position.x + (Math.random() - 0.5) * (scale * 1.8),
        y: position.y + 0.2 + Math.random() * 0.8,
        z: position.z + (Math.random() - 0.5) * (scale * 1.8),
      };
      debris.spawn(world, off);
      setTimeout(() => {
        try { if (debris.isSpawned) debris.despawn(); } catch {}
      }, 260 + Math.random() * 180);
    }

    // Cleanup core flashes
    setTimeout(() => {
      try { if (core.isSpawned) core.despawn(); } catch {}
    }, 380);
    setTimeout(() => {
      try { if (inner.isSpawned) inner.despawn(); } catch {}
    }, 310);
    setTimeout(() => {
      try { if (outer.isSpawned) outer.despawn(); } catch {}
    }, 520);
  }

  /** Small arming/fuse warning pulse (used by flying lethals near detonation) */
  static lethalArmingPulse(world: World, position: Vector3Like, intensity = 0.6) {
    const pulse = new Entity({
      name: "LethalPulse",
      modelUri: VFX_MODEL_URI,
      modelScale: 0.22 * (0.7 + intensity * 0.9),
    });
    pulse.spawn(world, position);

    setTimeout(() => {
      try { if (pulse.isSpawned) pulse.despawn(); } catch {}
    }, 110);
  }

  /** Special big C4 / satchel detonation look (more debris + core) */
  static c4Detonation(world: World, position: Vector3Like, soften = false) {
    const s = soften ? 0.85 : 1.0;
    this.lethalExplosion(world, position, 1.9 * s);

    // Extra heavy core flash for C4
    const megaCore = new Entity({
      name: "C4Core",
      modelUri: VFX_MODEL_URI,
      modelScale: 3.1 * s,
    });
    megaCore.spawn(world, position);
    setTimeout(() => { try { if (megaCore.isSpawned) megaCore.despawn(); } catch {} }, soften ? 260 : 480);

    // More flying debris for big boom
    for (let i = 0; i < (soften ? 5 : 11); i++) {
      const d = new Entity({
        name: "C4Debris",
        modelUri: VFX_MODEL_URI,
        modelScale: 0.17 + Math.random() * 0.28,
      });
      d.spawn(world, {
        x: position.x + (Math.random()-0.5) * 3.5 * s,
        y: position.y + Math.random() * 1.6,
        z: position.z + (Math.random()-0.5) * 3.5 * s,
      });
      setTimeout(() => { try { if (d.isSpawned) d.despawn(); } catch {} }, 220 + Math.random()*280);
    }
  }
}