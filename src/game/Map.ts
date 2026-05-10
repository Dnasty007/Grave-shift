import * as pc from "playcanvas";
import { MAP_CONFIG } from "./config";
import { CollisionWorld } from "./CollisionWorld";
import { Door } from "./Door";
import { SpawnGate } from "./SpawnGate";
import { WallBuy } from "./WallBuy";

/**
 * World root under PlayCanvas `app.root`: procedural arena **or** empty shell + imported GLB.
 *
 * | Area | Game effect |
 * | ---- | ----------- |
 * | `build()` + `build*` private | Yard geometry, gates, wall buys, 2D collision boxes (arena only) |
 * | `loadImportedVisual` | Mineways GLB parented under map root |
 * | Terrain pick helpers | Player/zombie feet Y on mesh (`MAP_CONFIG` gated) |
 * | `pickRandomActiveSpawnPosition` | Zombie spawn: gate pulse vs open-world ring |
 * | `update` | Doors, gate pulse, lamp flicker |
 */
export type ZoneId = "hub" | "loadingBay" | "office" | "powerYard";

export type MapBuildResult = {
  doors: Door[];
  wallBuys: WallBuy[];
  spawnGates: SpawnGate[];
};

const ARENA_HALF = 30;
const WALL_HEIGHT = 4;

export class Map {
  private readonly app: pc.Application;
  private readonly collision: CollisionWorld;
  private readonly root = new pc.Entity("map");

  private readonly doorsByZone: Record<ZoneId, Door[]> = {
    hub: [],
    loadingBay: [],
    office: [],
    powerYard: []
  };
  private readonly gatesByZone: Record<ZoneId, SpawnGate[]> = {
    hub: [],
    loadingBay: [],
    office: [],
    powerYard: []
  };
  private readonly wallBuys: WallBuy[] = [];
  private readonly doors: Door[] = [];
  private readonly gates: SpawnGate[] = [];
  private readonly openedZones = new Set<ZoneId>(["hub"]);

  private importedMapRoot: pc.Entity | null = null;
  private terrainPicker: pc.Picker | null = null;
  private terrainSnapCam: pc.Entity | null = null;

  private readonly lampMaterial: pc.StandardMaterial;
  private readonly groundMaterial: pc.StandardMaterial;
  private readonly wallMaterial: pc.StandardMaterial;
  private readonly fenceMaterial: pc.StandardMaterial;
  private readonly hazardMaterial: pc.StandardMaterial;

  private readonly lampLights: pc.Entity[] = [];
  private flickerPhase = 0;
  private flickerStrength = 0;

  private readonly replacesArena =
    MAP_CONFIG.importVisual.enabled && MAP_CONFIG.importVisual.replacesArena;

  /** Old “dollhouse” mode: import visible but keep procedural yard + collision. */
  private readonly hideProceduralDecor =
    MAP_CONFIG.importVisual.enabled && !MAP_CONFIG.importVisual.replacesArena;

  constructor(app: pc.Application, collision: CollisionWorld) {
    this.app = app;
    this.collision = collision;
    this.app.root.addChild(this.root);

    this.groundMaterial = new pc.StandardMaterial();
    this.groundMaterial.diffuse = new pc.Color(0.07, 0.07, 0.08);
    this.groundMaterial.emissive = new pc.Color(0.012, 0.012, 0.014);
    this.groundMaterial.update();

    this.wallMaterial = new pc.StandardMaterial();
    this.wallMaterial.diffuse = new pc.Color(0.13, 0.11, 0.09);
    this.wallMaterial.emissive = new pc.Color(0.022, 0.018, 0.012);
    this.wallMaterial.update();

    this.fenceMaterial = new pc.StandardMaterial();
    this.fenceMaterial.diffuse = new pc.Color(0.1, 0.09, 0.08);
    this.fenceMaterial.emissive = new pc.Color(0.025, 0.02, 0.014);
    this.fenceMaterial.update();

    this.hazardMaterial = new pc.StandardMaterial();
    this.hazardMaterial.diffuse = new pc.Color(0.85, 0.55, 0.1);
    this.hazardMaterial.emissive = new pc.Color(0.5, 0.18, 0.02);
    this.hazardMaterial.useLighting = false;
    this.hazardMaterial.update();

    this.lampMaterial = new pc.StandardMaterial();
    this.lampMaterial.diffuse = new pc.Color(0.95, 0.6, 0.18);
    this.lampMaterial.emissive = new pc.Color(1.6, 0.55, 0.12);
    this.lampMaterial.useLighting = false;
    this.lampMaterial.update();
  }

  // --- Arena build pipeline (skipped entirely when `replacesArena`) ---

  build(): MapBuildResult {
    if (this.replacesArena) {
      return { doors: [], wallBuys: [], spawnGates: [] };
    }

    this.buildGround();
    this.buildPerimeter();
    this.buildInternalWalls();
    this.buildProps();
    this.buildLights();
    this.buildDoors();
    this.buildWallBuys();
    this.buildSpawnGates();

    for (const gate of this.gatesByZone.hub) {
      gate.setActive(true);
    }

    return {
      doors: this.doors,
      wallBuys: this.wallBuys,
      spawnGates: this.gates
    };
  }

  reset(): void {
    if (this.replacesArena) {
      return;
    }

    this.openedZones.clear();
    this.openedZones.add("hub");

    for (const zoneId of Object.keys(this.gatesByZone) as ZoneId[]) {
      const isHub = zoneId === "hub";
      for (const gate of this.gatesByZone[zoneId]) {
        gate.setActive(isHub);
      }
    }
  }

  // --- Runtime: animated doors, gate pulse, lamp flicker ---

  update(dt: number): void {
    for (const door of this.doors) door.update(dt);
    for (const gate of this.gates) gate.update(dt);

    this.flickerPhase += dt * 12;
    this.flickerStrength = Math.max(0, this.flickerStrength - dt * 0.6);
    const flickerFactor = 1 - this.flickerStrength * (0.5 + 0.5 * Math.sin(this.flickerPhase));

    for (const lamp of this.lampLights) {
      const lightComp = lamp.light;
      if (!lightComp) continue;
      const baseIntensity = (lamp as unknown as { _baseIntensity?: number })._baseIntensity ?? 1.4;
      lightComp.intensity = Math.max(0.05, baseIntensity * flickerFactor);
    }
  }

  triggerFlicker(strength = 1): void {
    this.flickerStrength = Math.max(this.flickerStrength, Math.min(1, strength));
  }

  openZone(zoneId: ZoneId): void {
    if (this.openedZones.has(zoneId)) return;
    this.openedZones.add(zoneId);
    for (const gate of this.gatesByZone[zoneId]) {
      gate.setActive(true);
    }
  }

  isZoneOpen(zoneId: ZoneId): boolean {
    return this.openedZones.has(zoneId);
  }

  // --- Spawning: gate entities vs open-world ring around player ---

  pickRandomActiveSpawnPosition(playerPosition: pc.Vec3, minDistance = 12): pc.Vec3 | null {
    if (this.replacesArena) {
      const ring = MAP_CONFIG.importVisual.spawnRing;
      const ringMin = Math.max(minDistance, ring.min);
      const ringMax = Math.max(ringMin + 2, ring.max);
      const radius = ringMin + Math.random() * (ringMax - ringMin);
      const theta = Math.random() * Math.PI * 2;
      const x = playerPosition.x + Math.sin(theta) * radius;
      const z = playerPosition.z + Math.cos(theta) * radius;
      const y = playerPosition.y;
      return new pc.Vec3(x, y, z);
    }

    const activeGates: SpawnGate[] = [];
    for (const zoneId of this.openedZones) {
      activeGates.push(...this.gatesByZone[zoneId]);
    }
    if (activeGates.length === 0) return null;

    const shuffled = [...activeGates].sort(() => Math.random() - 0.5);
    for (const gate of shuffled) {
      const distance = gate.position.distance(playerPosition);
      if (distance >= minDistance) {
        gate.pulse();
        return gate.getSpawnPosition();
      }
    }

    const fallback = shuffled[0];
    fallback.pulse();
    return fallback.getSpawnPosition();
  }

  getRoot(): pc.Entity {
    return this.root;
  }

  // --- Imported Mineways mesh (`MAP_CONFIG.importVisual.glbUrl`) ---

  /**
   * Loads the converted GLB (see `MAP_CONFIG.importVisual`). Safe to call on every boot;
   * failures are logged. When `replacesArena` is on, there is no procedural fallback shell.
   */
  loadImportedVisual(app: pc.Application): Promise<void> {
    if (!MAP_CONFIG.importVisual.enabled) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const { glbUrl } = MAP_CONFIG.importVisual;
      const asset = new pc.Asset("imported-map", "container", { url: glbUrl });
      asset.on("error", (err: string) => {
        console.warn("[Map] Could not load imported map:", err);
        resolve();
      });

      app.assets.add(asset);

      asset.ready((loaded: pc.Asset) => {
        const resource = loaded.resource as {
          instantiateRenderEntity?: (options?: object) => pc.Entity;
        } | null;
        if (!resource?.instantiateRenderEntity) {
          console.warn("[Map] Imported map asset has no container resource");
          resolve();
          return;
        }

        try {
          const entity = resource.instantiateRenderEntity();
          entity.name = "imported-map";

          const [sx, sy, sz] = MAP_CONFIG.importVisual.scale;
          entity.setLocalScale(sx, sy, sz);

          const [px, py, pz] = MAP_CONFIG.importVisual.position;
          entity.setLocalPosition(px, py, pz);

          const [rx, ry, rz] = MAP_CONFIG.importVisual.eulerDegrees;
          entity.setLocalEulerAngles(rx, ry, rz);

          this.root.addChild(entity);
          this.importedMapRoot = entity;
        } catch (e) {
          console.warn("[Map] instantiateRenderEntity failed:", e);
        }
        resolve();
      });

      app.assets.load(asset);
    });
  }

  // --- Terrain height under (wx,wz): median depth picks for feet / cling ---

  /**
   * World-space terrain height under (wx, wz): median of several depth picks in one pass
   * (rejects isolated treetop / roof hits). Returns null if the mesh is missing or all picks miss.
   */
  async sampleImportedTerrainY(
    app: pc.Application,
    wx: number,
    wz: number
  ): Promise<number | null> {
    if (
      !this.importedMapRoot ||
      !MAP_CONFIG.importVisual.replacesArena ||
      !MAP_CONFIG.importVisual.snapFeetToGround
    ) {
      return null;
    }

    const bounds = this.getImportedRenderWorldYBounds();
    if (!bounds) {
      console.warn("[Map] Ground snap: could not infer mesh bounds.");
      return null;
    }

    const { minY, maxY } = bounds;
    const pickRes = MAP_CONFIG.importVisual.terrainPickResolution;
    const picker = this.getOrCreateTerrainPicker(app, pickRes);
    const camEnt = this.ensureTerrainSnapCamera(app, minY, maxY);

    const camY = maxY + 120;
    camEnt.setPosition(wx, camY, wz);
    camEnt.lookAt(wx, minY - 50, wz, 0, 1, 0);

    await waitAppFrames(app, 2);

    const cam = camEnt.camera;
    if (!cam) {
      return null;
    }

    picker.prepare(cam, app.scene);

    const half = pickRes * 0.5;
    const samples: number[] = [];
    const maxPx = pickRes - 1;
    for (const [ox, oy] of MAP_CONFIG.importVisual.terrainSamplePixelOffsets) {
      const px = Math.min(maxPx, Math.max(0, Math.floor(half + ox)));
      const py = Math.min(maxPx, Math.max(0, Math.floor(half + oy)));
      const hit = await picker.getWorldPointAsync(px, py);
      if (!hit) continue;
      if (hit.y < minY - 4 || hit.y > maxY + 4) continue;
      samples.push(hit.y);
    }

    if (samples.length === 0) {
      console.warn("[Map] Ground snap: no depth hits at", wx, wz);
      return null;
    }

    return median(samples);
  }

  /**
   * Places entity feet at (wx, ·, wz) on the imported mesh (open world + snap on).
   */
  async snapEntityFeetToImportedGround(
    app: pc.Application,
    entity: pc.Entity,
    wx: number,
    wz: number
  ): Promise<boolean> {
    const y = await this.sampleImportedTerrainY(app, wx, wz);
    if (y == null) {
      return false;
    }
    const up = MAP_CONFIG.importVisual.groundSnapClearance;
    entity.setPosition(wx, y + up, wz);
    return true;
  }

  /**
   * Places `playerRoot` feet on the imported mesh under playerSpawn.x/z using depth picks.
   */
  async snapPlayerFeetToImportedGround(
    app: pc.Application,
    playerRoot: pc.Entity
  ): Promise<boolean> {
    if (
      !this.importedMapRoot ||
      !MAP_CONFIG.importVisual.replacesArena ||
      !MAP_CONFIG.importVisual.snapFeetToGround
    ) {
      return false;
    }

    const { x: sx, z: sz } = MAP_CONFIG.importVisual.playerSpawn;
    const y = await this.sampleImportedTerrainY(app, sx, sz);
    if (y == null) {
      return false;
    }
    const up = MAP_CONFIG.importVisual.groundSnapClearance;
    playerRoot.setPosition(sx, y + up, sz);
    return true;
  }

  private getImportedRenderWorldYBounds(): { minY: number; maxY: number } | null {
    if (!this.importedMapRoot) {
      return null;
    }

    let maxY = -Infinity;
    let minY = Infinity;
    const renders = this.importedMapRoot.findComponents("render") as pc.RenderComponent[];
    for (const render of renders) {
      const list = render.meshInstances;
      if (!list) continue;
      for (const mi of list) {
        const hi = mi.aabb.getMax().y;
        const lo = mi.aabb.getMin().y;
        maxY = Math.max(maxY, hi);
        minY = Math.min(minY, lo);
      }
    }

    if (!Number.isFinite(maxY) || !Number.isFinite(minY) || maxY <= minY) {
      return null;
    }
    return { minY, maxY };
  }

  private getOrCreateTerrainPicker(app: pc.Application, size: number): pc.Picker {
    if (!this.terrainPicker) {
      this.terrainPicker = new pc.Picker(app, size, size, true);
    }
    this.terrainPicker.resize(size, size);
    return this.terrainPicker;
  }

  private ensureTerrainSnapCamera(app: pc.Application, minY: number, maxY: number): pc.Entity {
    if (!this.terrainSnapCam) {
      const ent = new pc.Entity("terrain-snap-cam");
      ent.addComponent("camera", {
        clearColor: new pc.Color(0.02, 0.02, 0.03),
        fov: 50,
        nearClip: 0.25,
        farClip: Math.max(4000, maxY - minY + 400),
        enabled: false
      });
      app.root.addChild(ent);
      this.terrainSnapCam = ent;
    }
    const cam = this.terrainSnapCam.camera;
    if (cam) {
      cam.farClip = Math.max(4000, maxY - minY + 400);
    }
    return this.terrainSnapCam;
  }

  // --- Procedural pieces (arena yard only) ---

  private buildGround(): void {
    if (!this.hideProceduralDecor) {
      const ground = new pc.Entity("ground");
      ground.addComponent("render", { type: "plane", material: this.groundMaterial });
      ground.setLocalScale(ARENA_HALF * 2, 1, ARENA_HALF * 2);
      this.root.addChild(ground);

      this.addHazardStrip(0, 12, 4, 0.6, 0);
      this.addHazardStrip(12, 0, 0.6, 4, 90);
      this.addHazardStrip(-12, 0, 0.6, 4, 90);
      this.addHazardStrip(0, -12, 4, 0.6, 0);

      const beacon = new pc.Entity("beacon");
      const beaconMat = new pc.StandardMaterial();
      beaconMat.diffuse = new pc.Color(0.22, 0.07, 0.04);
      beaconMat.emissive = new pc.Color(0.85, 0.18, 0.05);
      beaconMat.update();
      beacon.addComponent("render", { type: "box", material: beaconMat });
      beacon.setLocalScale(2.4, 0.32, 2.4);
      beacon.setLocalPosition(0, 0.16, 0);
      this.root.addChild(beacon);
    }
  }

  private addHazardStrip(x: number, z: number, sx: number, sz: number, rotY: number): void {
    const strip = new pc.Entity("hazard");
    strip.addComponent("render", { type: "plane", material: this.hazardMaterial });
    strip.setLocalScale(sx, 1, sz);
    strip.setLocalPosition(x, 0.025, z);
    strip.setLocalEulerAngles(0, rotY, 0);
    this.root.addChild(strip);
  }

  private buildPerimeter(): void {
    const T = 1.2;

    this.addStaticWall(0, ARENA_HALF, ARENA_HALF * 2 + T, T);
    this.addStaticWall(0, -ARENA_HALF, ARENA_HALF * 2 + T, T);
    this.addStaticWall(ARENA_HALF, 0, T, ARENA_HALF * 2 + T);
    this.addStaticWall(-ARENA_HALF, 0, T, ARENA_HALF * 2 + T);
  }

  private buildInternalWalls(): void {
    const T = 0.9;

    this.addStaticWall(12, -7, T, 10);
    this.addStaticWall(12, 7, T, 10);

    this.addStaticWall(-12, -7, T, 10);
    this.addStaticWall(-12, 7, T, 10);

    this.addStaticWall(-7, -12, 10, T);
    this.addStaticWall(7, -12, 10, T);

    this.addStaticWall(21, 12, 18, T);
    this.addStaticWall(-21, 12, 18, T);

    this.addStaticWall(21, -12, 18, T);
    this.addStaticWall(-21, -12, 18, T);
  }

  private addStaticWall(x: number, z: number, sx: number, sz: number): void {
    this.collision.addFromCenter(x, z, sx, sz, true);
    if (!this.hideProceduralDecor) {
      const wall = new pc.Entity("wall");
      wall.addComponent("render", { type: "box", material: this.wallMaterial });
      wall.setLocalScale(sx, WALL_HEIGHT, sz);
      wall.setLocalPosition(x, WALL_HEIGHT * 0.5, z);
      this.root.addChild(wall);
    }
  }

  private buildDoors(): void {
    const east = new Door({
      parent: this.root,
      collisionWorld: this.collision,
      position: new pc.Vec3(12, 0, 0),
      size: { x: 0.6, y: 3.4, z: 4 },
      rotationY: 0,
      cost: 1000,
      label: "Loading Bay Gate"
    });
    this.doors.push(east);
    this.doorsByZone.loadingBay.push(east);

    const west = new Door({
      parent: this.root,
      collisionWorld: this.collision,
      position: new pc.Vec3(-12, 0, 0),
      size: { x: 0.6, y: 3.4, z: 4 },
      rotationY: 0,
      cost: 1250,
      label: "Office Block Gate"
    });
    this.doors.push(west);
    this.doorsByZone.office.push(west);

    const north = new Door({
      parent: this.root,
      collisionWorld: this.collision,
      position: new pc.Vec3(0, 0, -12),
      size: { x: 4, y: 3.4, z: 0.6 },
      rotationY: 0,
      cost: 1750,
      label: "Power Yard Gate"
    });
    this.doors.push(north);
    this.doorsByZone.powerYard.push(north);
  }

  private buildWallBuys(): void {
    const shotgun = new WallBuy({
      parent: this.root,
      weaponId: "shotgun",
      position: new pc.Vec3(-7.5, 0, 11.6),
      rotationY: 180
    });
    this.wallBuys.push(shotgun);

    const smg = new WallBuy({
      parent: this.root,
      weaponId: "smg",
      position: new pc.Vec3(28.6, 0, 0),
      rotationY: 90
    });
    this.wallBuys.push(smg);

    const rifle = new WallBuy({
      parent: this.root,
      weaponId: "rifle",
      position: new pc.Vec3(-28.6, 0, 0),
      rotationY: -90
    });
    this.wallBuys.push(rifle);

    const magnum = new WallBuy({
      parent: this.root,
      weaponId: "magnum",
      position: new pc.Vec3(0, 0, -28.6),
      rotationY: 0
    });
    this.wallBuys.push(magnum);
  }

  private buildSpawnGates(): void {
    const hubA = new SpawnGate({
      parent: this.root,
      position: new pc.Vec3(8, 0, 12.4),
      facingY: 180,
      zone: "hub"
    });
    const hubB = new SpawnGate({
      parent: this.root,
      position: new pc.Vec3(-8, 0, 12.4),
      facingY: 180,
      zone: "hub"
    });
    this.gates.push(hubA, hubB);
    this.gatesByZone.hub.push(hubA, hubB);

    const eastA = new SpawnGate({
      parent: this.root,
      position: new pc.Vec3(28, 0, 8),
      facingY: 90,
      zone: "loadingBay"
    });
    const eastB = new SpawnGate({
      parent: this.root,
      position: new pc.Vec3(28, 0, -8),
      facingY: 90,
      zone: "loadingBay"
    });
    this.gates.push(eastA, eastB);
    this.gatesByZone.loadingBay.push(eastA, eastB);

    const westA = new SpawnGate({
      parent: this.root,
      position: new pc.Vec3(-28, 0, 8),
      facingY: -90,
      zone: "office"
    });
    const westB = new SpawnGate({
      parent: this.root,
      position: new pc.Vec3(-28, 0, -8),
      facingY: -90,
      zone: "office"
    });
    this.gates.push(westA, westB);
    this.gatesByZone.office.push(westA, westB);

    const northA = new SpawnGate({
      parent: this.root,
      position: new pc.Vec3(8, 0, -28),
      facingY: 0,
      zone: "powerYard"
    });
    const northB = new SpawnGate({
      parent: this.root,
      position: new pc.Vec3(-8, 0, -28),
      facingY: 0,
      zone: "powerYard"
    });
    this.gates.push(northA, northB);
    this.gatesByZone.powerYard.push(northA, northB);
  }

  private buildProps(): void {
    if (this.hideProceduralDecor) {
      return;
    }

    const positions: Array<[number, number, number]> = [
      [-5, 0, 5],
      [5, 0, 4],
      [0, 0, -7],
      [-2, 0, 8],
      [22, 0, 6],
      [22, 0, -8],
      [25, 0, 0],
      [-22, 0, -6],
      [-22, 0, 8],
      [-25, 0, 2],
      [3, 0, -22],
      [-3, 0, -25],
      [7, 0, -27],
      [-7, 0, -22]
    ];

    for (const [x, _y, z] of positions) {
      this.addCrate(x, z);
    }

    this.addBarrel(-3, 4);
    this.addBarrel(3, -4);
    this.addBarrel(24, -4);
    this.addBarrel(-24, 5);
    this.addBarrel(0, -22);
  }

  private addCrate(x: number, z: number): void {
    const crate = new pc.Entity("crate");
    const crateMat = new pc.StandardMaterial();
    crateMat.diffuse = new pc.Color(0.22, 0.16, 0.1);
    crateMat.emissive = new pc.Color(0.04, 0.025, 0.012);
    crateMat.update();

    crate.addComponent("render", { type: "box", material: crateMat });
    const w = 0.9 + Math.random() * 0.5;
    const h = 0.6 + Math.random() * 0.8;
    crate.setLocalScale(w, h, w);
    crate.setLocalPosition(x, h * 0.5, z);
    crate.setLocalEulerAngles(0, Math.random() * 360, 0);
    this.root.addChild(crate);

    this.collision.addFromCenter(x, z, w * 1.05, w * 1.05, false);
  }

  private addBarrel(x: number, z: number): void {
    const barrel = new pc.Entity("barrel");
    const mat = new pc.StandardMaterial();
    mat.diffuse = new pc.Color(0.4, 0.18, 0.06);
    mat.emissive = new pc.Color(0.1, 0.04, 0.012);
    mat.update();
    barrel.addComponent("render", { type: "cylinder", material: mat });
    barrel.setLocalScale(0.7, 1.2, 0.7);
    barrel.setLocalPosition(x, 0.6, z);
    this.root.addChild(barrel);

    this.collision.addFromCenter(x, z, 0.8, 0.8, false);
  }

  private buildLights(): void {
    const lampPositions: Array<[number, number, number, number]> = [
      [-10, 5.6, 8, 1.5],
      [10, 5.6, 8, 1.5],
      [-10, 5.6, -8, 1.5],
      [10, 5.6, -8, 1.5],
      [22, 5.6, 0, 1.4],
      [-22, 5.6, 0, 1.4],
      [0, 5.6, -22, 1.6]
    ];

    for (const [x, y, z, intensity] of lampPositions) {
      const lamp = new pc.Entity("lamp-housing");
      lamp.addComponent("render", { type: "box", material: this.lampMaterial });
      lamp.setLocalScale(0.9, 0.22, 0.5);
      lamp.setLocalPosition(x, y + 0.05, z);
      this.root.addChild(lamp);

      const light = new pc.Entity("lamp-light");
      light.addComponent("light", {
        type: "omni",
        color: new pc.Color(1, 0.55, 0.18),
        intensity,
        range: 16
      });
      light.setLocalPosition(x, y - 0.6, z);
      (light as unknown as { _baseIntensity?: number })._baseIntensity = intensity;
      this.root.addChild(light);
      this.lampLights.push(light);

      const post = new pc.Entity("lamp-post");
      post.addComponent("render", { type: "box", material: this.fenceMaterial });
      post.setLocalScale(0.18, y, 0.18);
      post.setLocalPosition(x, y * 0.5, z);
      this.root.addChild(post);
    }

    const center = new pc.Entity("center-flood");
    center.addComponent("light", {
      type: "omni",
      color: new pc.Color(1, 0.5, 0.18),
      intensity: 1.2,
      range: 22
    });
    center.setPosition(0, 8, 0);
    (center as unknown as { _baseIntensity?: number })._baseIntensity = 1.2;
    this.root.addChild(center);
    this.lampLights.push(center);
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) * 0.5;
}

function waitAppFrames(app: pc.Application, count: number): Promise<void> {
  return new Promise((resolve) => {
    let left = count;
    const onFrame = () => {
      left--;
      if (left <= 0) {
        app.off("update", onFrame);
        resolve();
      }
    };
    app.on("update", onFrame);
  });
}
