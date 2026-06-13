/**
 * Generates assets/test-map.json — Full Combat Arena TEST ROOM.
 * This is the dedicated developer/QA test facility (not a normal playable map).
 *
 * Run: node scripts/generate-test-map.mjs
 *
 * Layout (spawn at center hub):
 *   West: lethal range (walk-in 999 charges for all 4 lethals)
 *   North: full weapon range (official guns + imported grid — walk-in to equip)
 *   South: PaP + Mystery for economy testing
 *   East: boss pit + red pillar (manual Ice Dragon summon)
 *   Hub controls (F interact on pillars):
 *     Lime  = Next/Advance Wave
 *     Yellow = Replay Current Wave
 *     Cyan   = Clear All Hostiles (instant nuke current zombies + boss)
 *     Blue   = God Mode toggle (invincibility for safe testing)
 *     Purple = Max Kit (strong gun + high PaP + points + ammo)
 *     Red    = Force Ice Dragon
 *
 * Bright day lighting + open arena for maximum visibility while testing mechanics.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "assets", "test-map.json");

const BLOCK = {
  glass: 1,
  grass: 2,
  oakLeaves: 3,
  oakPlanks: 4,
  sand: 5,
  stoneBricks: 6,
  redConcrete: 7,
  limeConcrete: 8,
  yellowConcrete: 9,
  cyanConcrete: 10,
  blueConcrete: 11,
  purpleConcrete: 12,
};

/** Inclusive arena extents (world X/Z == block X/Z). */
const ARENA = { min: -48, max: 48 };
const HUB = { half: 7 }; // 15×15 hub platform
const WALL = { inset: 46, height: 3 }; // perimeter ring

const blocks = {};

function setBlock(x, y, z, id) {
  blocks[`${x},${y},${z}`] = id;
}

function fillRect(x0, z0, x1, z1, y, id) {
  for (let x = x0; x <= x1; x++) {
    for (let z = z0; z <= z1; z++) {
      setBlock(x, y, z, id);
    }
  }
}

function fillPad(cx, cz, half, y, id) {
  fillRect(cx - half, cz - half, cx + half, cz + half, y, id);
}

/** Solid pillar from y=2 upward (y=1 stays walkable floor). */
function buildPillar(cx, cz, half, height, id) {
  for (let y = 2; y <= height + 1; y++) {
    fillRect(cx - half, cz - half, cx + half, cz + half, y, id);
  }
}

// ── Base terrain ─────────────────────────────────────────────────────────────
// Outer grass buffer (one block beyond walls).
for (let x = ARENA.min - 4; x <= ARENA.max + 4; x++) {
  for (let z = ARENA.min - 4; z <= ARENA.max + 4; z++) {
    const inside =
      x >= ARENA.min && x <= ARENA.max && z >= ARENA.min && z <= ARENA.max;
    if (!inside) setBlock(x, 1, z, BLOCK.grass);
  }
}

// Main combat floor — stone bricks across the full arena.
fillRect(ARENA.min, ARENA.min, ARENA.max, ARENA.max, 1, BLOCK.stoneBricks);

// Raised hub platform (oak planks) at center spawn.
fillRect(-HUB.half, -HUB.half, HUB.half, HUB.half, 1, BLOCK.oakPlanks);
fillRect(-HUB.half, -HUB.half, HUB.half, HUB.half, 2, BLOCK.oakPlanks);

// Cardinal paths from hub (oak plank walkways).
fillRect(-HUB.half, -38, HUB.half, -12, 1, BLOCK.oakPlanks); // south path
fillRect(-HUB.half, 12, HUB.half, 38, 1, BLOCK.oakPlanks);   // north path
fillRect(-38, -HUB.half, -12, HUB.half, 1, BLOCK.oakPlanks); // west path
fillRect(12, -HUB.half, 38, HUB.half, 1, BLOCK.oakPlanks);   // east path

// ── Zone pads (pickup markers) ───────────────────────────────────────────────
// West — lethals
for (const z of [-6, -2, 2, 6]) fillPad(-38, z, 2, 1, BLOCK.sand);

// South — economy plaza pads
fillPad(-10, -35, 3, 1, BLOCK.oakPlanks);
fillPad(10, -35, 3, 1, BLOCK.oakPlanks);
fillRect(-14, -38, 14, -32, 1, BLOCK.stoneBricks); // plaza floor accent

// North — official gun row
for (const x of [-25, -15, -5, 5, 15, 25]) fillPad(x, 32, 2, 1, BLOCK.oakPlanks);

// North — imported gun grid (3×5)
for (const z of [42, 48, 54]) {
  for (let col = 0; col < 5; col++) {
    fillPad(-32 + col * 8, z, 2, 1, BLOCK.oakPlanks);
  }
}

// East — boss combat pit (sand bowl) + blood-red summon pillar
fillRect(28, -12, 48, 12, 1, BLOCK.sand);
buildPillar(38, 0, 1, 6, BLOCK.redConcrete); // 3×3 thick boss call-in pillar

// ── Hub Test Control Cluster — MINIMAL "BLOCK + OVERHEAD UI SCREEN" ────────────
// Each station is intentionally tiny and clean:
//   • One single-block "Button" (the thing you stand next to and press F on)
//   • Tiny 1x1 colored floor accent directly under it (easy to spot, not huge cubes)
//   • A prominent glowing overhead entity (the "UI Screen") spawned by code with
//     title + clear instructions visible as its label/name.
//
// No giant colored walls, platforms, or oversized blocks for the controls.
// The arena should stay mostly neutral stone so the overhead screens stand out.
//
// Controls (stand on/at the single block + press F):
//   Lime block   (12, 0)   = NEXT WAVE / Advance
//   Yellow block (-12, 0)  = REPLAY current wave
//   Cyan block   (0, 12)   = CLEAR HORDE (nukes all live zombies + boss instantly)
//   Blue block   (0, -12)  = GOD MODE toggle (you stop taking damage from enemies)
//   Purple block (12, 12)  = MAX KIT (gives strong gun + PaP + points + full ammo/lethals)
//   Red (east pit)         = Force Ice Dragon

// Legacy wave controls — just the single button block + 1x1 accent
setBlock(12, 2, 0, BLOCK.limeConcrete);
setBlock(-12, 2, 0, BLOCK.yellowConcrete);
setBlock(12, 1, 0, BLOCK.limeConcrete);
setBlock(-12, 1, 0, BLOCK.yellowConcrete);

// New test utility stations — extremely minimal (one block + 1x1 accent)
setBlock(0, 2, 12, BLOCK.glass);   // Clear Horde target
setBlock(0, 1, 12, BLOCK.cyanConcrete);

setBlock(0, 2, -12, BLOCK.glass);  // God Mode target
setBlock(0, 1, -12, BLOCK.blueConcrete);

setBlock(12, 2, 12, BLOCK.glass);  // Max Kit target
setBlock(12, 1, 12, BLOCK.purpleConcrete);

// Corner explosion test pits (sand, away from lanes).
for (const [cx, cz] of [[-36, 36], [-36, -36], [20, 36]]) {
  fillPad(cx, cz, 4, 1, BLOCK.sand);
}

// ── Perimeter walls ──────────────────────────────────────────────────────────
const GATE_OFFSETS = [-1, 0, 1];

function isGate(x, z) {
  if (z === -WALL.inset || z === WALL.inset) return GATE_OFFSETS.includes(x);
  if (x === -WALL.inset || x === WALL.inset) return GATE_OFFSETS.includes(z);
  return false;
}

for (let x = -WALL.inset; x <= WALL.inset; x++) {
  for (let h = 2; h <= WALL.height + 1; h++) {
    if (!isGate(x, -WALL.inset)) setBlock(x, h, -WALL.inset, BLOCK.stoneBricks);
    if (!isGate(x, WALL.inset)) setBlock(x, h, WALL.inset, BLOCK.stoneBricks);
  }
}
for (let z = -WALL.inset + 1; z <= WALL.inset - 1; z++) {
  for (let h = 2; h <= WALL.height + 1; h++) {
    if (!isGate(-WALL.inset, z)) setBlock(-WALL.inset, h, z, BLOCK.stoneBricks);
    if (!isGate(WALL.inset, z)) setBlock(WALL.inset, h, z, BLOCK.stoneBricks);
  }
}

// Corner pillars (visual landmarks).
for (const [cx, cz] of [
  [-WALL.inset, -WALL.inset],
  [WALL.inset, -WALL.inset],
  [-WALL.inset, WALL.inset],
  [WALL.inset, WALL.inset],
]) {
  for (let h = 2; h <= WALL.height + 3; h++) setBlock(cx, h, cz, BLOCK.stoneBricks);
}

// Sparse foliage markers in far NE (teddy easter-egg corner) — kept as foliage for ground snap.
for (const [x, z] of [
  [42, 42],
  [45, 44],
  [40, 45],
]) {
  setBlock(x, 2, z, BLOCK.oakLeaves);
}

const map = {
  blockTypes: [
    { id: 1, name: "glass", textureUri: "blocks/glass.png", isCustom: false, isMultiTexture: false, isLiquid: false },
    { id: 2, name: "grass", textureUri: "blocks/grass.png", isCustom: false, isMultiTexture: false, isLiquid: false },
    { id: 3, name: "oak-leaves", textureUri: "blocks/oak-leaves.png", isCustom: false, isMultiTexture: false, isLiquid: false },
    { id: 4, name: "oak-planks", textureUri: "blocks/oak-planks.png", isCustom: false, isMultiTexture: false, isLiquid: false },
    { id: 5, name: "sand", textureUri: "blocks/sand.png", isCustom: false, isMultiTexture: false, isLiquid: false },
    { id: 6, name: "stone-bricks", textureUri: "blocks/stone-bricks.png", isCustom: false, isMultiTexture: false, isLiquid: false },
    { id: 7, name: "red-concrete", textureUri: "blocks/red-concrete.png", isCustom: false, isMultiTexture: false, isLiquid: false },
    { id: 8, name: "lime-concrete", textureUri: "blocks/lime-concrete.png", isCustom: false, isMultiTexture: false, isLiquid: false },
    { id: 9, name: "yellow-concrete", textureUri: "blocks/yellow-concrete.png", isCustom: false, isMultiTexture: false, isLiquid: false },
    { id: 10, name: "cyan-concrete", textureUri: "blocks/cyan-concrete.png", isCustom: false, isMultiTexture: false, isLiquid: false },
    { id: 11, name: "blue-concrete", textureUri: "blocks/blue-concrete.png", isCustom: false, isMultiTexture: false, isLiquid: false },
    { id: 12, name: "purple-concrete", textureUri: "blocks/purple-concrete.png", isCustom: false, isMultiTexture: false, isLiquid: false },
  ],
  blocks,
  zones: [
    {
      id: "zone_spawn_hub",
      label: "spawn_point",
      type: "box",
      position: { x: 0, y: 1, z: 0 },
      dimensions: { width: 1, height: 3, depth: 1 },
      color: "#22c55e",
      metadata: {},
      from: { x: 0, y: 1, z: 0 },
      to: { x: 0, y: 3, z: 0 },
    },
    {
      id: "zone_lethal_lane",
      label: "lethal_range",
      type: "box",
      position: { x: -38, y: 1, z: 0 },
      dimensions: { width: 6, height: 3, depth: 16 },
      color: "#f97316",
      metadata: {},
      from: { x: -41, y: 1, z: -8 },
      to: { x: -35, y: 3, z: 8 },
    },
    {
      id: "zone_wave_next",
      label: "wave_next",
      type: "box",
      position: { x: 12, y: 1, z: 0 },
      dimensions: { width: 4, height: 6, depth: 4 },
      color: "#84cc16",
      metadata: {},
      from: { x: 10, y: 1, z: -2 },
      to: { x: 14, y: 6, z: 2 },
    },
    {
      id: "zone_wave_replay",
      label: "wave_replay",
      type: "box",
      position: { x: -12, y: 1, z: 0 },
      dimensions: { width: 4, height: 6, depth: 4 },
      color: "#eab308",
      metadata: {},
      from: { x: -14, y: 1, z: -2 },
      to: { x: -10, y: 6, z: 2 },
    },
    {
      id: "zone_boss_pillar",
      label: "boss_summon",
      type: "box",
      position: { x: 38, y: 1, z: 0 },
      dimensions: { width: 4, height: 8, depth: 4 },
      color: "#dc2626",
      metadata: {},
      from: { x: 36, y: 1, z: -2 },
      to: { x: 40, y: 7, z: 2 },
    },
    {
      id: "zone_clear_horde",
      label: "test_clear",
      type: "box",
      position: { x: 0, y: 1, z: 12 },
      dimensions: { width: 4, height: 6, depth: 4 },
      color: "#06b6d4",
      metadata: {},
      from: { x: -2, y: 1, z: 10 },
      to: { x: 2, y: 6, z: 14 },
    },
    {
      id: "zone_god_mode",
      label: "test_god",
      type: "box",
      position: { x: 0, y: 1, z: -12 },
      dimensions: { width: 4, height: 6, depth: 4 },
      color: "#3b82f6",
      metadata: {},
      from: { x: -2, y: 1, z: -14 },
      to: { x: 2, y: 6, z: -10 },
    },
    {
      id: "zone_max_kit",
      label: "test_maxkit",
      type: "box",
      position: { x: 12, y: 1, z: 12 },
      dimensions: { width: 4, height: 5, depth: 4 },
      color: "#a855f7",
      metadata: {},
      from: { x: 10, y: 1, z: 10 },
      to: { x: 14, y: 5, z: 14 },
    },
  ],
  version: "2.0.0",
};

writeFileSync(OUT, JSON.stringify(map, null, 2) + "\n", "utf8");
console.log(`Wrote ${OUT} (${Object.keys(blocks).length} blocks)`);
