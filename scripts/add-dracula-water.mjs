/**
 * Adds a water sea + solid lakebed around Dracula's Castle, turning it into an island.
 *
 * WHY: the castle is a single GLB model with no voxel terrain under it, so "the floor
 * doesn't exist." Hytopia's liquid BLOCKS are first-class (auto swim physics), so the
 * sea is built from real water blocks written into draculas-castle-map.json. The castle
 * model still spawns on top via the Director — this just fills the JSON the map loads.
 *
 * The player spawns at Y≈-59 (the castle's walkable floor sits far below the model
 * origin), so the water surface is placed near that level, NOT Y=0.
 *
 * Re-runnable: rebuilds the water layers from scratch each time, preserves zones.
 *
 * Tunables (env):
 *   DRACULA_WATER_RADIUS  half-extent of the square sea in blocks   (default 150)
 *   DRACULA_WATER_Y       water SURFACE y level                      (default -59)
 *   DRACULA_WATER_DEPTH   how many water layers down from surface    (default 4)
 *   DRACULA_ISLAND_RADIUS no-water square cut-out around the castle  (default 70)
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mapPath = join(__dirname, "..", "assets", "draculas-castle-map.json");

const RADIUS        = clampInt(process.env.DRACULA_WATER_RADIUS, 150, 16, 400);
const WATER_Y       = intOr(process.env.DRACULA_WATER_Y, -59);
const DEPTH         = clampInt(process.env.DRACULA_WATER_DEPTH, 4, 1, 24);
const ISLAND_RADIUS = clampInt(process.env.DRACULA_ISLAND_RADIUS, 70, 0, RADIUS);

const WATER_ID = 16;   // matches the water block id used in map.json / high-bastion
const BED_ID   = 6;    // stone-bricks lakebed (the map's existing solid block)

const map = JSON.parse(readFileSync(mapPath, "utf8"));

// --- ensure both block types exist (water as liquid, stone-bricks as solid) ---
map.blockTypes = map.blockTypes ?? [];
upsertBlockType(map.blockTypes, {
  id: BED_ID, name: "stone-bricks", textureUri: "blocks/stone-bricks.png",
  isCustom: false, isMultiTexture: false, isLiquid: false,
});
upsertBlockType(map.blockTypes, {
  id: WATER_ID, name: "water", textureUri: "blocks/water.png",
  isCustom: false, isMultiTexture: false, isLiquid: true,
});

// --- rebuild blocks: drop any previously generated water/bed, keep everything else ---
const kept = {};
for (const [key, id] of Object.entries(map.blocks ?? {})) {
  if (id !== WATER_ID && id !== BED_ID) kept[key] = id;
}
const blocks = kept;

const bedY = WATER_Y - DEPTH;       // solid floor one layer below the deepest water
let water = 0, bed = 0;

for (let x = -RADIUS; x <= RADIUS; x++) {
  for (let z = -RADIUS; z <= RADIUS; z++) {
    // Leave a square island gap so the castle isn't flooded.
    const inIsland = Math.abs(x) <= ISLAND_RADIUS && Math.abs(z) <= ISLAND_RADIUS;
    if (inIsland) continue;

    // Solid lakebed so you don't sink forever.
    blocks[`${x},${bedY},${z}`] = BED_ID;
    bed++;

    // Water column from just above the bed up to the surface.
    for (let y = bedY + 1; y <= WATER_Y; y++) {
      blocks[`${x},${y},${z}`] = WATER_ID;
      water++;
    }
  }
}

map.blocks = blocks;
writeFileSync(mapPath, JSON.stringify(map, null, 2));

console.log(`[dracula-water] sea ±${RADIUS}, surface Y=${WATER_Y}, depth ${DEPTH}, island gap ±${ISLAND_RADIUS}`);
console.log(`[dracula-water] wrote ${water} water + ${bed} lakebed blocks → ${mapPath}`);

// ── helpers ──────────────────────────────────────────────────────────────────
function upsertBlockType(arr, bt) {
  const i = arr.findIndex((b) => b.id === bt.id);
  if (i >= 0) arr[i] = bt; else arr.push(bt);
}
function intOr(v, d) { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; }
function clampInt(v, d, lo, hi) { return Math.max(lo, Math.min(hi, intOr(v, d))); }
