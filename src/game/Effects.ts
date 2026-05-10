import * as pc from "playcanvas";
import { GAME_CONFIG } from "./config";

type ActiveEffect = {
  entity: pc.Entity;
  remaining: number;
  total: number;
  fade: (entity: pc.Entity, t: number) => void;
};

export class Effects {
  private readonly app: pc.Application;
  private readonly active: ActiveEffect[] = [];

  private readonly muzzleMaterial: pc.StandardMaterial;
  private readonly tracerMaterial: pc.StandardMaterial;
  private readonly bloodMaterial: pc.StandardMaterial;
  private readonly debrisMaterial: pc.StandardMaterial;

  constructor(app: pc.Application) {
    this.app = app;

    this.muzzleMaterial = new pc.StandardMaterial();
    this.muzzleMaterial.diffuse = new pc.Color(0, 0, 0);
    this.muzzleMaterial.emissive = new pc.Color(2.4, 1.5, 0.6);
    this.muzzleMaterial.useLighting = false;
    this.muzzleMaterial.update();

    this.tracerMaterial = new pc.StandardMaterial();
    this.tracerMaterial.diffuse = new pc.Color(0, 0, 0);
    this.tracerMaterial.emissive = new pc.Color(2.4, 1.6, 0.7);
    this.tracerMaterial.useLighting = false;
    this.tracerMaterial.opacity = 0.9;
    this.tracerMaterial.blendType = pc.BLEND_ADDITIVE;
    this.tracerMaterial.update();

    this.bloodMaterial = new pc.StandardMaterial();
    this.bloodMaterial.diffuse = new pc.Color(0, 0, 0);
    this.bloodMaterial.emissive = new pc.Color(0.45, 0.04, 0.05);
    this.bloodMaterial.useLighting = false;
    this.bloodMaterial.update();

    this.debrisMaterial = new pc.StandardMaterial();
    this.debrisMaterial.diffuse = new pc.Color(0.12, 0.12, 0.13);
    this.debrisMaterial.emissive = new pc.Color(0.04, 0.04, 0.05);
    this.debrisMaterial.update();
  }

  update(dt: number): void {
    for (let i = this.active.length - 1; i >= 0; i -= 1) {
      const effect = this.active[i];
      effect.remaining -= dt;
      const t = 1 - Math.max(0, effect.remaining) / effect.total;
      effect.fade(effect.entity, t);
      if (effect.remaining <= 0) {
        effect.entity.destroy();
        this.active.splice(i, 1);
      }
    }
  }

  spawnMuzzleFlash(origin: pc.Vec3, direction: pc.Vec3): void {
    const flash = new pc.Entity("muzzle-flash");
    flash.addComponent("render", {
      type: "sphere",
      material: this.muzzleMaterial
    });
    flash.setLocalScale(0.42, 0.42, 0.42);
    flash.setPosition(
      origin.x + direction.x * 0.55,
      origin.y - 0.18 + direction.y * 0.55,
      origin.z + direction.z * 0.55
    );
    this.app.root.addChild(flash);

    const light = new pc.Entity("muzzle-light");
    light.addComponent("light", {
      type: "omni",
      color: new pc.Color(1, 0.7, 0.32),
      intensity: 4.5,
      range: 8
    });
    light.setPosition(flash.getPosition());
    this.app.root.addChild(light);

    const total = GAME_CONFIG.fx.muzzleFlashSeconds;
    this.active.push({
      entity: flash,
      remaining: total,
      total,
      fade: (entity, t) => {
        const scale = 0.42 * (1 - t * 0.5);
        entity.setLocalScale(scale, scale, scale);
      }
    });
    this.active.push({
      entity: light,
      remaining: total,
      total,
      fade: (entity, t) => {
        const lightComponent = entity.light;
        if (lightComponent) {
          lightComponent.intensity = 4.5 * (1 - t);
        }
      }
    });
  }

  spawnTracer(origin: pc.Vec3, hitPoint: pc.Vec3): void {
    const distance = origin.distance(hitPoint);
    if (distance < 0.5) return;

    const tracer = new pc.Entity("tracer");
    tracer.addComponent("render", {
      type: "cylinder",
      material: this.tracerMaterial
    });

    const midpoint = new pc.Vec3(
      (origin.x + hitPoint.x) * 0.5,
      (origin.y + hitPoint.y) * 0.5,
      (origin.z + hitPoint.z) * 0.5
    );

    tracer.setPosition(midpoint);
    tracer.setLocalScale(0.04, distance, 0.04);

    const direction = hitPoint.clone().sub(origin).normalize();
    const up = new pc.Vec3(0, 1, 0);
    const dot = up.dot(direction);
    if (Math.abs(dot) < 0.999) {
      const axis = new pc.Vec3();
      axis.cross(up, direction).normalize();
      const angle = Math.acos(dot) * pc.math.RAD_TO_DEG;
      const q = new pc.Quat();
      q.setFromAxisAngle(axis, angle);
      tracer.setRotation(q);
    }

    this.app.root.addChild(tracer);

    const total = GAME_CONFIG.fx.tracerSeconds;
    this.active.push({
      entity: tracer,
      remaining: total,
      total,
      fade: (entity, t) => {
        const render = entity.render;
        if (render) {
          for (const meshInstance of render.meshInstances) {
            const material = meshInstance.material as pc.StandardMaterial;
            material.opacity = 0.9 * (1 - t);
            material.update();
          }
        }
      }
    });
  }

  spawnBlood(position: pc.Vec3, enabled: boolean): void {
    if (!enabled) return;

    const total = GAME_CONFIG.fx.bloodBurstSeconds;
    const splatCount = 9;

    for (let i = 0; i < splatCount; i += 1) {
      const drop = new pc.Entity("blood");
      drop.addComponent("render", {
        type: "sphere",
        material: this.bloodMaterial
      });
      const scale = 0.12 + Math.random() * 0.12;
      drop.setLocalScale(scale, scale, scale);
      drop.setPosition(position);
      this.app.root.addChild(drop);

      const angle = Math.random() * Math.PI * 2;
      const speed = 1.6 + Math.random() * 2.6;
      const vx = Math.cos(angle) * speed;
      const vz = Math.sin(angle) * speed;
      const vy = 1.6 + Math.random() * 2.4;
      const startX = position.x;
      const startY = position.y;
      const startZ = position.z;

      this.active.push({
        entity: drop,
        remaining: total,
        total,
        fade: (entity, t) => {
          const time = t * total;
          const x = startX + vx * time;
          const z = startZ + vz * time;
          const y = startY + vy * time - 6.5 * time * time;
          entity.setPosition(x, Math.max(0.02, y), z);
          const remaining = 1 - t;
          const s = scale * Math.max(0.1, remaining);
          entity.setLocalScale(s, s, s);
        }
      });
    }

    const burst = new pc.Entity("blood-burst");
    burst.addComponent("render", {
      type: "sphere",
      material: this.bloodMaterial
    });
    burst.setLocalScale(0.6, 0.6, 0.6);
    burst.setPosition(position);
    this.app.root.addChild(burst);
    this.active.push({
      entity: burst,
      remaining: 0.18,
      total: 0.18,
      fade: (entity, t) => {
        const s = 0.6 + t * 0.9;
        entity.setLocalScale(s, s, s);
      }
    });
  }

  spawnImpactSpark(position: pc.Vec3): void {
    const spark = new pc.Entity("impact-spark");
    spark.addComponent("light", {
      type: "omni",
      color: new pc.Color(1, 0.55, 0.2),
      intensity: 3,
      range: 4
    });
    spark.setPosition(position);
    this.app.root.addChild(spark);

    this.active.push({
      entity: spark,
      remaining: 0.08,
      total: 0.08,
      fade: (entity, t) => {
        const lightComponent = entity.light;
        if (lightComponent) {
          lightComponent.intensity = 3 * (1 - t);
        }
      }
    });
  }

  spawnDebris(position: pc.Vec3, enabled: boolean): void {
    if (!enabled) return;
    const count = 5;
    for (let i = 0; i < count; i += 1) {
      const piece = new pc.Entity("debris");
      piece.addComponent("render", {
        type: "box",
        material: this.debrisMaterial
      });
      const scale = 0.06 + Math.random() * 0.07;
      piece.setLocalScale(scale, scale, scale);
      piece.setPosition(position);
      this.app.root.addChild(piece);

      const angle = Math.random() * Math.PI * 2;
      const speed = 1.0 + Math.random() * 1.6;
      const vx = Math.cos(angle) * speed;
      const vz = Math.sin(angle) * speed;
      const vy = 1.0 + Math.random() * 1.5;
      const startX = position.x;
      const startY = position.y;
      const startZ = position.z;
      const total = 0.55;

      this.active.push({
        entity: piece,
        remaining: total,
        total,
        fade: (entity, t) => {
          const time = t * total;
          const x = startX + vx * time;
          const z = startZ + vz * time;
          const y = startY + vy * time - 5.5 * time * time;
          entity.setPosition(x, Math.max(0.02, y), z);
          entity.setEulerAngles(t * 360, t * 540, t * 240);
        }
      });
    }
  }
}
