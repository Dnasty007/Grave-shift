import * as pc from "playcanvas";

let gateCounter = 0;

type SpawnGateOptions = {
  parent: pc.Entity;
  position: pc.Vec3;
  facingY: number;
  zone: string;
};

export class SpawnGate {
  readonly id = `spawn-gate-${gateCounter++}`;
  readonly zone: string;
  readonly position: pc.Vec3;

  private readonly root = new pc.Entity(this.id);
  private readonly portalLight = new pc.Entity("portal-light");
  private readonly portalDisc = new pc.Entity("portal-disc");
  private readonly portalMat = new pc.StandardMaterial();
  private intensity = 0;
  private targetIntensity = 0;
  private flickerPhase = 0;

  constructor(options: SpawnGateOptions) {
    this.zone = options.zone;
    this.position = options.position.clone();

    this.root.setPosition(options.position);
    this.root.setEulerAngles(0, options.facingY, 0);
    options.parent.addChild(this.root);

    const frameMat = new pc.StandardMaterial();
    frameMat.diffuse = new pc.Color(0.05, 0.05, 0.06);
    frameMat.emissive = new pc.Color(0.02, 0.018, 0.018);
    frameMat.update();

    const frame = new pc.Entity("gate-frame");
    frame.addComponent("render", { type: "box", material: frameMat });
    frame.setLocalScale(2.4, 2.6, 0.16);
    frame.setLocalPosition(0, 1.3, 0);
    this.root.addChild(frame);

    const top = new pc.Entity("gate-top");
    top.addComponent("render", { type: "box", material: frameMat });
    top.setLocalScale(2.6, 0.18, 0.5);
    top.setLocalPosition(0, 2.7, 0);
    this.root.addChild(top);

    this.portalMat.diffuse = new pc.Color(0, 0, 0);
    this.portalMat.emissive = new pc.Color(0.65, 0.18, 0.04);
    this.portalMat.useLighting = false;
    this.portalMat.opacity = 0;
    this.portalMat.blendType = pc.BLEND_ADDITIVE;
    this.portalMat.update();

    this.portalDisc.addComponent("render", { type: "plane", material: this.portalMat });
    this.portalDisc.setLocalEulerAngles(90, 0, 0);
    this.portalDisc.setLocalScale(2.1, 1, 2.4);
    this.portalDisc.setLocalPosition(0, 1.25, 0.05);
    this.root.addChild(this.portalDisc);

    this.portalLight.addComponent("light", {
      type: "omni",
      color: new pc.Color(1, 0.35, 0.1),
      intensity: 0,
      range: 6
    });
    this.portalLight.setLocalPosition(0, 1.3, 0.1);
    this.root.addChild(this.portalLight);
  }

  setActive(active: boolean): void {
    this.targetIntensity = active ? 1 : 0;
  }

  pulse(): void {
    this.intensity = 1.4;
  }

  update(dt: number): void {
    this.intensity += (this.targetIntensity - this.intensity) * Math.min(1, dt * 4);
    this.flickerPhase += dt * 9;

    const flicker = 0.7 + 0.3 * Math.sin(this.flickerPhase * 1.7) * Math.cos(this.flickerPhase * 0.6);
    const visible = Math.max(0, this.intensity * flicker);

    this.portalMat.opacity = Math.min(1, visible * 0.85);
    this.portalMat.update();

    const lightComponent = this.portalLight.light;
    if (lightComponent) {
      lightComponent.intensity = visible * 1.4;
    }

    const scale = 1 + visible * 0.06;
    this.portalDisc.setLocalScale(2.1 * scale, 1, 2.4 * scale);
  }

  getSpawnPosition(): pc.Vec3 {
    return this.position.clone();
  }
}
