import * as pc from "playcanvas";
import { MAP_CONFIG } from "./config";
import { rayIntersectTriangle } from "./math";
import { CollisionWorld } from "./CollisionWorld";
import { Door } from "./Door";
import { SpawnGate } from "./SpawnGate";
import { WallBuy } from "./WallBuy";
import { buildHytopiaMapEntityAsync, type HytopiaMapJson } from "./hytopiaMapMesh";
import { HYTOPIA } from "./hytopiaContent";

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
  private importedMapAsset: pc.Asset | null = null;
  private mapAssetSerial = 0;

  /** Scratch for wall-hit world position (foliage pass-through, no per-triangle alloc). */
  private readonly wallHitLocal = new pc.Vec3();
  private readonly wallHitWorld = new pc.Vec3();

  private readonly meshGeometryCache = new WeakMap<
    pc.Mesh,
    { positions: Float32Array; indexBuf: Uint16Array | Uint32Array | null }
  >();

  private readonly lampMaterial: pc.StandardMaterial;
  private readonly groundMaterial: pc.StandardMaterial;
  private readonly wallMaterial: pc.StandardMaterial;
  private readonly fenceMaterial: pc.StandardMaterial;
  private readonly hazardMaterial: pc.StandardMaterial;

  private readonly lampLights: pc.Entity[] = [];
  private flickerPhase = 0;
  private flickerStrength = 0;

  private get replacesArena(): boolean {
    return MAP_CONFIG.importVisual.enabled && MAP_CONFIG.importVisual.replacesArena;
  }

  /** True when terrain height should be sampled (GLB root or flat procedural test plane). */
  private terrainSamplingActive(): boolean {
    const vis = MAP_CONFIG.importVisual;
    if (!vis.enabled) return false;
    if (vis.useProceduralTestGround) return true;
    return this.importedMapRoot != null;
  }

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

  // --- Arena build pipeline (skipped when import is on: no procedural mesh, no 2D box collision) ---

  build(): MapBuildResult {
    if (MAP_CONFIG.importVisual.enabled) {
      this.collision.clear();
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
    if (MAP_CONFIG.importVisual.enabled) {
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

  private unloadImportedMapAsset(app: pc.Application): void {
    if (this.importedMapAsset) {
      app.assets.remove(this.importedMapAsset);
      this.importedMapAsset = null;
    }
  }

  /** Destroys all world entities and clears arena/import bookkeeping (before `build` + `loadImportedVisual`). */
  teardownWorld(app: pc.Application): void {
    this.unloadImportedMapAsset(app);
    const children = this.root.children;
    while (children.length > 0) {
      children[0].destroy();
    }
    this.importedMapRoot = null;
    this.doors.length = 0;
    this.gates.length = 0;
    this.wallBuys.length = 0;
    for (const z of Object.keys(this.doorsByZone) as ZoneId[]) {
      this.doorsByZone[z].length = 0;
      this.gatesByZone[z].length = 0;
    }
    this.lampLights.length = 0;
    this.openedZones.clear();
    this.openedZones.add("hub");
    this.collision.clear();
  }

  /** Full reload when switching map mode at run start (import vs procedural yard). */
  async rebuildWorld(app: pc.Application): Promise<MapBuildResult> {
    this.teardownWorld(app);
    const built = this.build();
    await this.loadImportedVisual(app);
    return built;
  }

  // --- Imported mesh: Hytopia `map.json` or Mineways GLB (`MAP_CONFIG.importVisual`) ---

  /**
   * Loads voxel JSON, procedural test plane, or converted GLB. Safe on every boot; failures log.
   * When `replacesArena` is on, there is no procedural arena fallback shell.
   */
  loadImportedVisual(app: pc.Application): Promise<void> {
    if (!MAP_CONFIG.importVisual.enabled) {
      return Promise.resolve();
    }

    this.unloadImportedMapAsset(app);

    if (MAP_CONFIG.importVisual.useProceduralTestGround) {
      this.buildProceduralTestGroundPlane(app);
      return Promise.resolve();
    }

    const jsonUrl = MAP_CONFIG.importVisual.jsonVoxelMapUrl?.trim();
    if (jsonUrl) {
      return new Promise((resolve) => {
        fetch(jsonUrl)
          .then((r) => {
            if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
            return r.json() as Promise<HytopiaMapJson>;
          })
          .then(async (data) => {
            try {
              const vis = MAP_CONFIG.importVisual;
              const base =
                vis.jsonVoxelTextureBaseUrl?.trim() || HYTOPIA.blockTextures;
              const entity = await buildHytopiaMapEntityAsync(app, data, {
                textureBaseUrl: base,
                crop: vis.jsonVoxelCrop
                  ? {
                      center: vis.jsonVoxelCrop.center,
                      halfExtents: vis.jsonVoxelCrop.halfExtents
                    }
                  : undefined
              });
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
              console.warn("[Map] Hytopia JSON map build failed:", e);
            }
            resolve();
          })
          .catch((e) => {
            console.warn("[Map] Could not load Hytopia JSON map:", jsonUrl, e);
            resolve();
          });
      });
    }

    return new Promise((resolve) => {
      const { glbUrl } = MAP_CONFIG.importVisual;
      const asset = new pc.Asset(`imported-map-${++this.mapAssetSerial}`, "container", {
        url: glbUrl
      });
      this.importedMapAsset = asset;
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

  /** One-time copy of mesh positions + index buffer for CPU ray tests (hot path). */
  private getCachedMeshGeometry(mesh: pc.Mesh): {
    positions: Float32Array;
    indexBuf: Uint16Array | Uint32Array | null;
  } | null {
    const existing = this.meshGeometryCache.get(mesh);
    if (existing) {
      return existing;
    }
    const vb = mesh.vertexBuffer;
    const numVertices = vb?.numVertices ?? 0;
    if (numVertices <= 0) {
      return null;
    }
    const positions = new Float32Array(numVertices * 3);
    mesh.getPositions(positions);
    const ib0 = mesh.indexBuffer[0];
    const hasIdx = ib0 != null && ib0.numIndices > 0;
    let indexBuf: Uint16Array | Uint32Array | null = null;
    if (hasIdx && ib0) {
      indexBuf =
        ib0.numIndices > 65535
          ? new Uint32Array(ib0.numIndices)
          : new Uint16Array(ib0.numIndices);
      mesh.getIndices(indexBuf);
    }
    const row = { positions, indexBuf };
    this.meshGeometryCache.set(mesh, row);
    return row;
  }

  // --- Terrain height under (wx,wz): vertical CPU ray vs imported mesh triangles ---

  /**
   * Long downward ray from `terrainRayTopY` (outdoor / legacy). Prefer
   * `sampleImportedTerrainYNearFeet` for characters so ceilings are not treated as floor.
   */
  sampleImportedTerrainY(wx: number, wz: number): number | null {
    if (!this.terrainSamplingActive()) {
      return null;
    }
    if (MAP_CONFIG.importVisual.useProceduralTestGround) {
      return 0;
    }
    const topY = MAP_CONFIG.importVisual.terrainRayTopY;
    const botY = MAP_CONFIG.importVisual.terrainRayBottomY;
    return this.sampleTerrainAlongDownRay(wx, wz, topY, topY - botY);
  }

  /**
   * Samples ground under `(wx,wz)` using **current feet height** as a hint so the first hit is
   * local floor/stairs, not the building roof or sky shell when indoors.
   */
  sampleImportedTerrainYNearFeet(wx: number, wz: number, referenceFeetY: number): number | null {
    if (!this.terrainSamplingActive()) {
      return null;
    }
    if (MAP_CONFIG.importVisual.useProceduralTestGround) {
      return 0;
    }
    const cfg = MAP_CONFIG.importVisual;
    const startY = Math.min(cfg.terrainRayTopY, referenceFeetY + cfg.terrainRayStartAboveFeet);
    const minEndY = Math.max(cfg.terrainRayBottomY, referenceFeetY - cfg.terrainRayMaxDropFromRef);
    const maxRange = Math.max(0.65, startY - minEndY);
    return this.sampleTerrainAlongDownRay(wx, wz, startY, maxRange);
  }

  /**
   * World down-ray from `(wx, rayTopY, wz)`, returns first hit Y below the origin within `maxRange`.
   */
  private sampleTerrainAlongDownRay(wx: number, wz: number, rayTopY: number, maxRange: number): number | null {
    if (!this.importedMapRoot || !MAP_CONFIG.importVisual.enabled) {
      return null;
    }

    const rayOrigin = new pc.Vec3(wx, rayTopY, wz);
    const rayDirWorld = new pc.Vec3(0, -1, 0);
    const ray = new pc.Ray(rayOrigin, rayDirWorld);

    const worldMat = new pc.Mat4();
    const invMat = new pc.Mat4();
    const oLocal = new pc.Vec3();
    const dLocal = new pc.Vec3();
    const dirWorldScratch = new pc.Vec3();
    const hitLocal = new pc.Vec3();
    const hitWorld = new pc.Vec3();

    let bestTWorld = Infinity;
    let bestY: number | null = null;

    const renders = this.importedMapRoot.findComponents("render") as pc.RenderComponent[];
    for (const render of renders) {
      const list = render.meshInstances;
      if (!list) continue;

      for (let m = 0; m < list.length; m++) {
        const mi = list[m];
        const mesh = mi.mesh;
        if (!mesh) continue;

        if (!mi.aabb.intersectsRay(ray)) {
          continue;
        }

        worldMat.copy(mi.node.getWorldTransform());
        invMat.copy(worldMat).invert();
        invMat.transformPoint(rayOrigin, oLocal);
        dirWorldScratch.copy(rayDirWorld);
        invMat.transformVector(dirWorldScratch, dLocal);
        const dLen = dLocal.length();
        if (dLen < 1e-10) continue;
        dLocal.mulScalar(1 / dLen);

        const geo = this.getCachedMeshGeometry(mesh);
        if (!geo) continue;
        const { positions, indexBuf } = geo;

        const processTri = (ia: number, ib: number, ic: number): void => {
          const t = rayIntersectTriangle(
            oLocal.x,
            oLocal.y,
            oLocal.z,
            dLocal.x,
            dLocal.y,
            dLocal.z,
            positions[ia],
            positions[ia + 1],
            positions[ia + 2],
            positions[ib],
            positions[ib + 1],
            positions[ib + 2],
            positions[ic],
            positions[ic + 1],
            positions[ic + 2]
          );
          if (t == null || t > maxRange * 4) return;

          hitLocal.set(
            oLocal.x + dLocal.x * t,
            oLocal.y + dLocal.y * t,
            oLocal.z + dLocal.z * t
          );
          worldMat.transformPoint(hitLocal, hitWorld);

          const tWorld = rayOrigin.y - hitWorld.y;
          if (tWorld >= -0.01 && tWorld <= maxRange + 0.02 && tWorld < bestTWorld) {
            bestTWorld = tWorld;
            bestY = hitWorld.y;
          }
        };

        const prims = mesh.primitive;

        for (let p = 0; p < prims.length; p++) {
          const prim = prims[p];
          if (prim.type !== pc.PRIMITIVE_TRIANGLES) continue;

          if (prim.indexed && indexBuf) {
            for (let j = 0; j + 2 < prim.count; j += 3) {
              const i0 = indexBuf[prim.base + j] * 3;
              const i1 = indexBuf[prim.base + j + 1] * 3;
              const i2 = indexBuf[prim.base + j + 2] * 3;
              processTri(i0, i1, i2);
            }
          } else {
            for (let j = 0; j + 2 < prim.count; j += 3) {
              const i0 = (prim.base + j + prim.baseVertex) * 3;
              const i1 = (prim.base + j + 1 + prim.baseVertex) * 3;
              const i2 = (prim.base + j + 2 + prim.baseVertex) * 3;
              if (i2 + 2 < positions.length) {
                processTri(i0, i1, i2);
              }
            }
          }
        }
      }
    }

    if (bestY == null || !Number.isFinite(bestY)) {
      return null;
    }
    return bestY;
  }

  /**
   * Blocks horizontal moves into imported Mineways geometry (steep faces only; floors ignored).
   * Call after `CollisionWorld.resolvePlayerMovement` when mesh collision is enabled.
   * @param rayFeetY Optional feet height for chest ray (default `current.y`). Use after a step-up
   * so the riser is cast from the raised body and forward motion can finish onto the tread.
   */
  resolveImportedWallCollision(
    current: pc.Vec3,
    target: pc.Vec3,
    radius: number,
    rayFeetY: number = current.y
  ): pc.Vec3 {
    if (!this.importedMapRoot || !MAP_CONFIG.importVisual.replacesArena) {
      return target.clone();
    }

    const rayYOffset = 0.82;
    const skin = 0.06;
    const cap = 64;
    const rayY = rayFeetY + rayYOffset;

    let nx = target.x;
    let nz = target.z;

    const dx = target.x - current.x;
    if (Math.abs(dx) > 1e-6) {
      const sign = Math.sign(dx);
      const dist = this.horizontalWallHitDistance(
        current.x,
        rayY,
        current.z,
        sign,
        0,
        Math.min(cap, Math.abs(dx) + radius + skin),
        rayFeetY
      );
      if (dist != null) {
        const allow = Math.max(0, dist - radius - skin);
        nx = current.x + sign * Math.min(Math.abs(dx), allow);
      }
    }

    const dz = target.z - current.z;
    if (Math.abs(dz) > 1e-6) {
      const sign = Math.sign(dz);
      const dist = this.horizontalWallHitDistance(
        nx,
        rayY,
        current.z,
        0,
        sign,
        Math.min(cap, Math.abs(dz) + radius + skin),
        rayFeetY
      );
      if (dist != null) {
        const allow = Math.max(0, dist - radius - skin);
        nz = current.z + sign * Math.min(Math.abs(dz), allow);
      }
    }

    return new pc.Vec3(nx, target.y, nz);
  }

  /** World-space distance along horizontal (dx,0,dz) to nearest mostly-vertical mesh face. */
  private horizontalWallHitDistance(
    ox: number,
    oy: number,
    oz: number,
    dirx: number,
    dirz: number,
    maxDist: number,
    feetRefForFoliage: number | undefined
  ): number | null {
    const root = this.importedMapRoot;
    if (!root || !MAP_CONFIG.importVisual.replacesArena || maxDist <= 1e-4) {
      return null;
    }

    const rayDirWorld = new pc.Vec3(dirx, 0, dirz);
    const len = rayDirWorld.length();
    if (len < 1e-10) return null;
    rayDirWorld.mulScalar(1 / len);

    const rayOrigin = new pc.Vec3(ox, oy, oz);
    const ray = new pc.Ray(rayOrigin, rayDirWorld);

    const worldMat = new pc.Mat4();
    const invMat = new pc.Mat4();
    const oLocal = new pc.Vec3();
    const dLocal = new pc.Vec3();
    const dirWorldScratch = new pc.Vec3();
    const e1 = new pc.Vec3();
    const e2 = new pc.Vec3();
    const nLocal = new pc.Vec3();
    const nWorld = new pc.Vec3();
    const nTmp = new pc.Vec3();

    const wallNyMax = MAP_CONFIG.importVisual.importWallNormalYNMax;
    const passH = MAP_CONFIG.importVisual.importMeshFoliagePassThroughHeight;
    const groundClear = MAP_CONFIG.importVisual.groundSnapClearance;

    let bestT: number | null = null;

    const renders = root.findComponents("render") as pc.RenderComponent[];
    for (const render of renders) {
      const list = render.meshInstances;
      if (!list) continue;

      for (let m = 0; m < list.length; m++) {
        const mi = list[m];
        const mesh = mi.mesh;
        if (!mesh) continue;

        if (!mi.aabb.intersectsRay(ray)) continue;

        worldMat.copy(mi.node.getWorldTransform());
        invMat.copy(worldMat).invert();
        invMat.transformPoint(rayOrigin, oLocal);
        dirWorldScratch.copy(rayDirWorld);
        invMat.transformVector(dirWorldScratch, dLocal);
        const dl = dLocal.length();
        if (dl < 1e-10) continue;
        dLocal.mulScalar(1 / dl);

        const geo = this.getCachedMeshGeometry(mesh);
        if (!geo) continue;
        const { positions, indexBuf } = geo;

        const processTri = (ia: number, ib: number, ic: number): void => {
          const ax = positions[ia];
          const ay = positions[ia + 1];
          const az = positions[ia + 2];
          const bx = positions[ib];
          const by = positions[ib + 1];
          const bz = positions[ib + 2];
          const cx = positions[ic];
          const cy = positions[ic + 1];
          const cz = positions[ic + 2];

          e1.set(bx - ax, by - ay, bz - az);
          e2.set(cx - ax, cy - ay, cz - az);
          nLocal.cross(e1, e2);
          const nMag = nLocal.length();
          if (nMag < 1e-14) return;
          nLocal.mulScalar(1 / nMag);

          nTmp.copy(nLocal);
          worldMat.transformVector(nTmp, nWorld);
          const nwLen = nWorld.length();
          if (nwLen < 1e-14) return;
          nWorld.mulScalar(1 / nwLen);
          if (Math.abs(nWorld.y) > wallNyMax) return;

          const t = rayIntersectTriangle(
            oLocal.x,
            oLocal.y,
            oLocal.z,
            dLocal.x,
            dLocal.y,
            dLocal.z,
            ax,
            ay,
            az,
            bx,
            by,
            bz,
            cx,
            cy,
            cz
          );
          if (t == null || t <= 1e-4 || t > maxDist + 1e-3) return;
          if (passH > 0 && feetRefForFoliage != null) {
            this.wallHitLocal.set(
              oLocal.x + dLocal.x * t,
              oLocal.y + dLocal.y * t,
              oLocal.z + dLocal.z * t
            );
            worldMat.transformPoint(this.wallHitLocal, this.wallHitWorld);
            const ground = this.sampleImportedTerrainYNearFeet(
              this.wallHitWorld.x,
              this.wallHitWorld.z,
              feetRefForFoliage
            );
            if (ground != null && this.wallHitWorld.y <= ground + groundClear + passH) {
              return;
            }
          }
          if (bestT == null || t < bestT) {
            bestT = t;
          }
        };

        const prims = mesh.primitive;

        for (let p = 0; p < prims.length; p++) {
          const prim = prims[p];
          if (prim.type !== pc.PRIMITIVE_TRIANGLES) continue;

          if (prim.indexed && indexBuf) {
            for (let j = 0; j + 2 < prim.count; j += 3) {
              const i0 = indexBuf[prim.base + j] * 3;
              const i1 = indexBuf[prim.base + j + 1] * 3;
              const i2 = indexBuf[prim.base + j + 2] * 3;
              processTri(i0, i1, i2);
            }
          } else {
            for (let j = 0; j + 2 < prim.count; j += 3) {
              const i0 = (prim.base + j + prim.baseVertex) * 3;
              const i1 = (prim.base + j + 1 + prim.baseVertex) * 3;
              const i2 = (prim.base + j + 2 + prim.baseVertex) * 3;
              if (i2 + 2 < positions.length) {
                processTri(i0, i1, i2);
              }
            }
          }
        }
      }
    }

    return bestT;
  }

  /**
   * Places entity feet at (wx, ·, wz) on the imported mesh (open world + snap on).
   */
  snapEntityFeetToImportedGround(entity: pc.Entity, wx: number, wz: number, referenceFeetY?: number): boolean {
    const ref = referenceFeetY ?? entity.getPosition().y;
    const y = this.sampleImportedTerrainYNearFeet(wx, wz, ref);
    if (y == null) {
      return false;
    }
    const up = MAP_CONFIG.importVisual.groundSnapClearance;
    entity.setPosition(wx, y + up, wz);
    return true;
  }

  /**
   * Places `playerRoot` feet on the imported mesh under playerSpawn.x/z.
   */
  snapPlayerFeetToImportedGround(playerRoot: pc.Entity): boolean {
    const vis = MAP_CONFIG.importVisual;
    if (
      (!this.importedMapRoot && !vis.useProceduralTestGround) ||
      !vis.replacesArena ||
      !vis.snapFeetToGround
    ) {
      return false;
    }

    const { x: sx, z: sz } = MAP_CONFIG.importVisual.playerSpawn;
    const refY = MAP_CONFIG.importVisual.playerSpawn.y + 3;
    const y = this.sampleImportedTerrainYNearFeet(sx, sz, refY);
    if (y == null) {
      return false;
    }
    const up = MAP_CONFIG.importVisual.groundSnapClearance;
    playerRoot.setPosition(sx, y + up, sz);
    return true;
  }

  /**
   * Perf-test ground: 100×100 plane centered at the origin, dark grid material.
   * Adds a static box collider + rigidbody when PlayCanvas physics systems are present
   * (player still uses CPU terrain at y = 0; physics is for future / tooling consistency).
   */
  private buildProceduralTestGroundPlane(app: pc.Application): void {
    const plane = new pc.Entity("procedural-test-ground");
    const mat = new pc.StandardMaterial();
    mat.diffuse = new pc.Color(0.1, 0.1, 0.12);
    mat.emissive = new pc.Color(0.02, 0.02, 0.025);
    mat.diffuseMap = this.createTestGroundGridTexture(app.graphicsDevice);
    mat.diffuseMapTiling.set(32, 32);
    mat.update();

    plane.addComponent("render", { type: "plane", material: mat });
    plane.setLocalPosition(0, 0, 0);
    plane.setLocalScale(100, 1, 100);
    this.root.addChild(plane);

    const rbSys = app.systems.rigidbody;
    const colSys = app.systems.collision;
    if (rbSys && colSys) {
      plane.addComponent("collision", {
        type: "box",
        halfExtents: new pc.Vec3(50, 0.05, 50)
      });
      plane.addComponent("rigidbody", { type: "static" });
    }
  }

  private createTestGroundGridTexture(device: pc.GraphicsDevice): pc.Texture {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return new pc.Texture(device, {
        width: 4,
        height: 4,
        format: pc.PIXELFORMAT_RGBA8,
        mipmaps: false
      });
    }
    ctx.fillStyle = "#18181c";
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = "#3c3f48";
    ctx.lineWidth = 1;
    const cells = 16;
    const step = size / cells;
    for (let i = 0; i <= cells; i++) {
      const p = Math.round(i * step) + 0.5;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, p);
      ctx.lineTo(size, p);
      ctx.stroke();
    }
    const tex = new pc.Texture(device, {
      width: size,
      height: size,
      format: pc.PIXELFORMAT_RGBA8,
      mipmaps: false,
      minFilter: pc.FILTER_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      addressU: pc.ADDRESS_REPEAT,
      addressV: pc.ADDRESS_REPEAT
    });
    tex.setSource(canvas);
    return tex;
  }

  // --- Procedural pieces (arena yard only) ---

  private buildGround(): void {
    if (!this.replacesArena) {
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
    if (!this.replacesArena) {
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

    const autoPistolBuy = new WallBuy({
      parent: this.root,
      weaponId: "autoPistol",
      position: new pc.Vec3(28.6, 0, 0),
      rotationY: 90
    });
    this.wallBuys.push(autoPistolBuy);

    const ar15Buy = new WallBuy({
      parent: this.root,
      weaponId: "ar15",
      position: new pc.Vec3(-28.6, 0, 0),
      rotationY: -90
    });
    this.wallBuys.push(ar15Buy);

    const ak47Buy = new WallBuy({
      parent: this.root,
      weaponId: "ak47",
      position: new pc.Vec3(0, 0, -28.6),
      rotationY: 0
    });
    this.wallBuys.push(ak47Buy);

    const autoShotgunBuy = new WallBuy({
      parent: this.root,
      weaponId: "autoShotgun",
      position: new pc.Vec3(5.5, 0, -28.6),
      rotationY: 0
    });
    this.wallBuys.push(autoShotgunBuy);
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
    if (this.replacesArena) {
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
