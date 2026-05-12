import * as pc from "playcanvas";
import { GAME_CONFIG } from "./config";
import { HYTOPIA } from "./hytopiaContent";

/**
 * Scene sky: either Hytopia PNG cubemap dirs or a procedural starfield ({@link SceneSkyboxConfig.procedural}).
 * PlayCanvas cubemap face order: [+X, -X, +Y, -Y, +Z, -Z] for {@link Texture#setSource}.
 *
 * Lighting / fog: {@link GameApp.configureScene} and {@link GAME_CONFIG.sceneLook.outerSpaceSky}.
 */

const CUBEMAP_FACE_FILES = ["+x.png", "-x.png", "+y.png", "-y.png", "+z.png", "-z.png"] as const;

const OUTER_SPACE_FACE_SIZE = 512;

function mulberry32(seed: number): () => number {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Six canvas faces for a starfield + soft nebula (no external assets; WebGPU-safe SRGBA8 upload).
 */
function createOuterSpaceCubemapFaces(): HTMLCanvasElement[] {
  const faces: HTMLCanvasElement[] = [];
  for (let face = 0; face < 6; face++) {
    const rnd = mulberry32(0x9e3779b9 + face * 0xface + 1337);
    const c = document.createElement("canvas");
    c.width = OUTER_SPACE_FACE_SIZE;
    c.height = OUTER_SPACE_FACE_SIZE;
    const ctx = c.getContext("2d");
    if (!ctx) {
      faces.push(c);
      continue;
    }
    const w = c.width;
    const h = c.height;

    ctx.fillStyle = "#030510";
    ctx.fillRect(0, 0, w, h);

    // Soft nebula patches (screen-additive feel)
    ctx.globalCompositeOperation = "screen";
    for (let n = 0; n < 5; n++) {
      const cx = rnd() * w;
      const cy = rnd() * h;
      const rad = (0.25 + rnd() * 0.55) * Math.max(w, h);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      const r = 25 + rnd() * 55;
      const gch = 20 + rnd() * 45;
      const b = 70 + rnd() * 90;
      const a = 0.06 + rnd() * 0.14;
      g.addColorStop(0, `rgba(${r},${gch},${b},${a})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }

    // Milky-way band on +Y face (index 2 in PlayCanvas order)
    if (face === 2) {
      ctx.save();
      ctx.translate(w * 0.5, h * 0.5);
      ctx.rotate(-0.85);
      ctx.globalCompositeOperation = "screen";
      const band = ctx.createLinearGradient(-w, 0, w, 0);
      band.addColorStop(0, "rgba(15,20,45,0)");
      band.addColorStop(0.35, "rgba(55,50,95,0.12)");
      band.addColorStop(0.5, "rgba(120,110,160,0.2)");
      band.addColorStop(0.65, "rgba(55,50,95,0.12)");
      band.addColorStop(1, "rgba(15,20,45,0)");
      ctx.fillStyle = band;
      ctx.fillRect(-w * 1.5, -h * 0.14, w * 3, h * 0.28);
      ctx.restore();
    }

    ctx.globalCompositeOperation = "source-over";

    // Stars
    const starCount = face === 2 ? 2400 : 1700;
    for (let i = 0; i < starCount; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const t = rnd();
      let radius: number;
      let alpha: number;
      let tint = "#ffffff";
      if (t > 0.997) {
        radius = 1.8 + rnd() * 1.4;
        alpha = 0.85 + rnd() * 0.15;
      } else if (t > 0.985) {
        radius = 1.1 + rnd() * 0.7;
        alpha = 0.55 + rnd() * 0.35;
      } else {
        radius = 0.35 + rnd() * 0.55;
        alpha = 0.15 + rnd() * 0.55;
      }
      const roll = rnd();
      if (roll < 0.14) tint = "#b8d4ff";
      else if (roll < 0.2) tint = "#ccd8ff";
      else if (roll < 0.23) tint = "#ffd4b0";

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle =
        tint === "#ffffff"
          ? `rgba(255,255,255,${alpha})`
          : tint === "#b8d4ff"
            ? `rgba(184,212,255,${alpha})`
            : tint === "#ccd8ff"
              ? `rgba(204,216,255,${alpha})`
              : `rgba(255,212,176,${alpha})`;
      ctx.fill();
    }

    faces.push(c);
  }
  return faces;
}

export type SceneSkyboxConfig = {
  /** URL directory containing the six face PNGs (no trailing slash). Ignored when {@link procedural} is set. */
  cubemapBaseUrl: string;
  /** {@link Scene#skyboxIntensity} — balance with directional sun / exposure. */
  intensity: number;
  procedural?: "outer-space" | null;
};

/** Hytopia partly-cloudy PNG cubemap under `public/skyboxes/partly-cloudy/`. */
export const PARTLY_CLOUDY_SCENE_SKYBOX: SceneSkyboxConfig = {
  cubemapBaseUrl: HYTOPIA.skyboxPartlyCloudy,
  intensity: 1.55,
  procedural: null
};

/** Procedural starfield; no `public/` assets required. */
export const OUTER_SPACE_SCENE_SKYBOX: SceneSkyboxConfig = {
  cubemapBaseUrl: "",
  intensity: 1.28,
  procedural: "outer-space"
};

/** Sky preset from {@link GAME_CONFIG.sceneLook.outerSpaceSky}. */
export function getSceneSkyboxConfig(): SceneSkyboxConfig {
  return GAME_CONFIG.sceneLook.outerSpaceSky ? OUTER_SPACE_SCENE_SKYBOX : PARTLY_CLOUDY_SCENE_SKYBOX;
}

/** @deprecated Use {@link getSceneSkyboxConfig} or {@link PARTLY_CLOUDY_SCENE_SKYBOX}. */
export const DEFAULT_SCENE_SKYBOX = PARTLY_CLOUDY_SCENE_SKYBOX;

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load skybox face: ${url}`));
    img.src = url;
  });
}

function buildCubemapTexture(
  app: pc.Application,
  sources: Array<HTMLImageElement | HTMLCanvasElement>,
  intensity: number
): pc.Texture {
  const w = sources[0].width;
  const h = sources[0].height;

  const texture = new pc.Texture(app.graphicsDevice, {
    name: "grave-shift-skybox",
    cubemap: true,
    width: w,
    height: h,
    format: pc.PIXELFORMAT_SRGBA8,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE
  });

  texture.setSource(sources as unknown as HTMLImageElement[], 0);
  texture.upload();

  app.scene.skybox = texture;
  app.scene.skyboxIntensity = intensity;
  app.scene.skyboxMip = 0;

  return texture;
}

/**
 * Builds a cubemap, assigns {@link Scene#skybox}, and disposes `replaceTexture` after clearing the scene reference.
 */
export function applySceneSkybox(
  app: pc.Application,
  config: SceneSkyboxConfig,
  replaceTexture: pc.Texture | null
): Promise<pc.Texture | null> {
  if (config.procedural === "outer-space") {
    try {
      if (replaceTexture) {
        app.scene.skybox = null;
        replaceTexture.destroy();
      }
      const faces = createOuterSpaceCubemapFaces();
      const tex = buildCubemapTexture(app, faces, config.intensity);
      return Promise.resolve(tex);
    } catch (e) {
      console.warn("[SceneSkybox] Procedural outer-space cubemap failed:", e);
      return Promise.resolve(replaceTexture);
    }
  }

  const urls = CUBEMAP_FACE_FILES.map((f) => `${config.cubemapBaseUrl}/${f}`);
  return Promise.all(urls.map(loadImageElement))
    .then((images) => {
      if (replaceTexture) {
        app.scene.skybox = null;
        replaceTexture.destroy();
      }
      return buildCubemapTexture(app, images, config.intensity);
    })
    .catch((e) => {
      console.warn("[SceneSkybox] Could not apply cubemap sky:", e);
      return replaceTexture;
    });
}
