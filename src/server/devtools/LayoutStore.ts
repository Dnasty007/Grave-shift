import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { QuaternionLike, Vector3Like } from "hytopia";

/**
 * LayoutStore — persists dev-placed model transforms to assets/dev-layout.json.
 *
 * The map JSON files store BLOCKS, not entities, so prop positions can't live
 * there. Instead each editable prop carries a stable `layoutId`; this store maps
 * layoutId -> { modelUri, scale, position, rotation }. On spawn the Director
 * applies any saved override so edits survive a restart.
 *
 * Keyed by map id so each map keeps its own layout.
 */

export type LayoutEntry = {
  modelUri: string;
  scale: number;
  position: Vector3Like;
  rotation: QuaternionLike;
};

type LayoutFile = Record<string, Record<string, LayoutEntry>>; // mapId -> layoutId -> entry

// Resolve assets/dev-layout.json next to the bundled server entry (same trick the
// old debug log used) so it works in both `hytopia dev` and packaged runs.
const LAYOUT_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..", "..", "..", "assets", "dev-layout.json"
);

let cache: LayoutFile | null = null;

function load(): LayoutFile {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(LAYOUT_PATH, "utf8");
    cache = JSON.parse(raw) as LayoutFile;
  } catch {
    cache = {};
  }
  return cache;
}

/** All saved overrides for a map (layoutId -> entry), or {} if none. */
export function getLayoutForMap(mapId: string): Record<string, LayoutEntry> {
  return load()[mapId] ?? {};
}

/** Write one prop's transform and flush to disk. Returns true on success. */
export function saveLayoutEntry(mapId: string, layoutId: string, entry: LayoutEntry): boolean {
  const data = load();
  if (!data[mapId]) data[mapId] = {};
  data[mapId][layoutId] = {
    modelUri: entry.modelUri,
    scale: entry.scale,
    position: { x: round(entry.position.x), y: round(entry.position.y), z: round(entry.position.z) },
    rotation: {
      x: round(entry.rotation.x), y: round(entry.rotation.y),
      z: round(entry.rotation.z), w: round(entry.rotation.w),
    },
  };
  return flush();
}

/** Remove one prop's saved override (revert to default). */
export function deleteLayoutEntry(mapId: string, layoutId: string): boolean {
  const data = load();
  if (data[mapId]?.[layoutId]) {
    delete data[mapId][layoutId];
    return flush();
  }
  return false;
}

function flush(): boolean {
  try {
    fs.mkdirSync(path.dirname(LAYOUT_PATH), { recursive: true });
    fs.writeFileSync(LAYOUT_PATH, JSON.stringify(cache, null, 2));
    return true;
  } catch (err) {
    console.warn("[LayoutStore] failed to write dev-layout.json:", err);
    return false;
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
