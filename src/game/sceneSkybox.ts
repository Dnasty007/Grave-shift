import * as pc from "playcanvas";
import { HYTOPIA } from "./hytopiaContent";

/**
 * Grave Shift sky: cubemap from Hytopia big-world `assets/skyboxes/partly-cloudy` (+/- axis PNGs).
 * PlayCanvas expects faces in order [+X, -X, +Y, -Y, +Z, -Z] for {@link Texture#setSource}.
 *
 * Lighting and fog still come from {@link GameApp.configureScene}; this only replaces the clear-color sky dome.
 */

/** Face file names (Hytopia layout matches PlayCanvas slot order). */
const CUBEMAP_FACE_FILES = ["+x.png", "-x.png", "+y.png", "-y.png", "+z.png", "-z.png"] as const;

export type SceneSkyboxConfig = {
  /** URL directory containing the six face PNGs (no trailing slash). */
  cubemapBaseUrl: string;
  /** {@link Scene#skyboxIntensity} — keep ~1 to balance with existing directional sun. */
  intensity: number;
};

/** Default: assets under {@link HYTOPIA.skyboxPartlyCloudy}. */
export const DEFAULT_SCENE_SKYBOX: SceneSkyboxConfig = {
  cubemapBaseUrl: HYTOPIA.skyboxPartlyCloudy,
  intensity: 1.35
};

function loadImageElement(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Failed to load skybox face: ${url}`));
    img.src = url;
  });
}

/**
 * Builds a cubemap, assigns {@link Scene#skybox}, and disposes `replaceTexture` after clearing the scene reference.
 */
export function applySceneSkybox(
  app: pc.Application,
  config: SceneSkyboxConfig,
  replaceTexture: pc.Texture | null
): Promise<pc.Texture | null> {
  const urls = CUBEMAP_FACE_FILES.map((f) => `${config.cubemapBaseUrl}/${f}`);
  return Promise.all(urls.map(loadImageElement))
    .then((images) => {
      if (replaceTexture) {
        app.scene.skybox = null;
        replaceTexture.destroy();
      }

      const w = images[0].width;
      const h = images[0].height;

      const texture = new pc.Texture(app.graphicsDevice, {
        name: "grave-shift-skybox",
        cubemap: true,
        width: w,
        height: h,
        format: pc.PIXELFORMAT_SRGB8,
        mipmaps: true,
        minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
        magFilter: pc.FILTER_LINEAR,
        addressU: pc.ADDRESS_CLAMP_TO_EDGE,
        addressV: pc.ADDRESS_CLAMP_TO_EDGE
      });

      texture.setSource(images as unknown as HTMLImageElement[], 0);
      texture.upload();

      app.scene.skybox = texture;
      app.scene.skyboxIntensity = config.intensity;
      app.scene.skyboxMip = 0;

      return texture;
    })
    .catch((e) => {
      console.warn("[SceneSkybox] Could not apply cubemap sky:", e);
      return replaceTexture;
    });
}
