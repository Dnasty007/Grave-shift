import * as pc from "playcanvas";
import { GAME_CONFIG } from "./config";

export type TeddyBearShotTarget = {
  alive: boolean;
  getCenter(): pc.Vec3;
  hitRadius: number;
};

type BearInstance = {
  root: pc.Entity;
  alive: boolean;
};

/**
 * Three hidden GLB teddies for hitscan. Ground Y is resolved via {@link snapGround}.
 */
export class TeddyBearEasterEgg {
  private readonly bears: BearInstance[] = [];
  private readonly cfg = GAME_CONFIG.teddyBearEasterEgg;

  constructor(
    private readonly app: pc.Application,
    private readonly snapGround: (x: number, z: number, refY: number) => number
  ) {}

  /** Hit spheres for {@link PlayerController.fire}. */
  getShotTargets(): TeddyBearShotTarget[] {
    return this.bears.map((b) => ({
      alive: b.alive,
      getCenter: () => {
        const p = b.root.getPosition();
        return new pc.Vec3(p.x, p.y + this.cfg.hitCenterYOffset, p.z);
      },
      hitRadius: this.cfg.hitRadius
    }));
  }

  /**
   * First hit on bear `index` disables it. Returns whether this shot newly broke a bear
   * and whether all three are now gone.
   */
  applyHit(index: number): { newHit: boolean; allDestroyed: boolean } {
    const b = this.bears[index];
    const allGone = this.bears.every((x) => !x.alive);
    if (!b || !b.alive) {
      return { newHit: false, allDestroyed: allGone };
    }
    b.alive = false;
    b.root.enabled = false;
    return {
      newHit: true,
      allDestroyed: this.bears.every((x) => !x.alive)
    };
  }

  async loadAndSpawn(): Promise<void> {
    if (!this.cfg.enabled) {
      return;
    }

    const url = this.cfg.modelUrl;
    await new Promise<void>((resolve) => {
      const asset = new pc.Asset("teddy-easter-bear", "container", { url });
      asset.on("error", (err: string) => {
        console.warn(`[TeddyBearEasterEgg] GLB failed (${url}):`, err);
        resolve();
      });
      asset.ready(() => {
        try {
          const res = asset.resource as pc.ContainerResource;
          for (let i = 0; i < this.cfg.spawnPositions.length; i++) {
            const spec = this.cfg.spawnPositions[i]!;
            const ent = res.instantiateRenderEntity();
            ent.name = `teddy-easter-${i}`;
            const s = this.cfg.modelScale;
            const cur = ent.getLocalScale();
            ent.setLocalScale(
              Math.max(Math.abs(cur.x), 0.001) * s,
              Math.max(Math.abs(cur.y), 0.001) * s,
              Math.max(Math.abs(cur.z), 0.001) * s
            );
            const gy = this.snapGround(spec.x, spec.z, spec.y);
            ent.setPosition(spec.x, gy + this.cfg.modelYOffset, spec.z);
            this.app.root.addChild(ent);
            this.bears.push({ root: ent, alive: true });
          }
        } catch (e) {
          console.warn("[TeddyBearEasterEgg] instantiate failed:", e);
        }
        resolve();
      });
      this.app.assets.add(asset);
      this.app.assets.load(asset);
    });
  }

  destroy(): void {
    for (const b of this.bears) {
      b.root.destroy();
    }
    this.bears.length = 0;
  }
}
