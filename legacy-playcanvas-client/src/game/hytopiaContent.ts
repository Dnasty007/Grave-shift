/**
 * Static URLs for Hytopia-derived assets under `public/` (maps, blocks, audio, skybox).
 *
 * **Upstream references** (clone paths are local; do not commit machine-specific dirs):
 *
 * 1. **`hytopia` SDK** (npm package / GitHub `hytopiagg/sdk`, e.g. local `sdk-main`) — server runtime,
 *    `server.d.ts`, `docs/`, and **`boilerplate/assets/map.json`** + `boilerplate/assets/ui/`. Project Gehenna
 *    does not run this server in-browser; use it for API docs, versioning, and refreshing the small
 *    boilerplate map (`boilerplateMapJson` below). Last reviewed: SDK **0.15.1**.
 * 2. **`sdk-examples`** (e.g. `big-world`) — large worlds, sample `index.ts`, extra assets. Typical sync:
 *    - `map.json` → `public/maps/hytopia-big-world-map.json`
 *    - `assets/blocks/` → `public/hytopia/blocks/`
 *    - `assets/audio/` → `public/hytopia/audio/` (extend `footstep-manifest.json` if needed)
 *    - Skybox dirs → `public/skyboxes/…`
 *
 * Spawn parity with big-world when tuning `MAP_CONFIG.importVisual.playerSpawn`: `{ x: 0, y: 10, z: 0 }`.
 */
export const HYTOPIA = {
  mapJson: "/maps/hytopia-big-world-map.json",
  /** Same voxel palette/shape as npm `hytopia` → `boilerplate/assets/map.json` (copy over when updating). */
  boilerplateMapJson: "/maps/castle-boilerplate-map.json",
  blockTextures: "/hytopia/blocks",
  audioRoot: "/hytopia/audio",
  footstepManifest: "/hytopia/audio/footstep-manifest.json",
  /** Cubemap under `public/skyboxes/partly-cloudy/` (copied from Hytopia skyboxes). */
  skyboxPartlyCloudy: "/skyboxes/partly-cloudy"
} as const;
