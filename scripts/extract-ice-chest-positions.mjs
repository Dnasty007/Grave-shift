/**
 * Scan Ice_Map.obj for Mineways chest object groups and cluster face centroids
 * into individual crate positions for iceCrateConfig.ts.
 *
 * Run: node scripts/extract-ice-chest-positions.mjs
 */
import { createReadStream, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const sourceObj =
  process.env.ICE_MAP_OBJ ??
  "c:\\OFF ONE DRIVE\\game maps\\Ice map\\Ice_Map.obj";

const CHEST_OBJECTS = new Set(["Chest", "Ender_Chest", "Trapped_Chest"]);
const CLUSTER_RADIUS = 1.25;

/** @type {Array<[number, number, number]>} */
const verts = [];
/** @type {Array<{ name: string, faceCenters: Array<[number, number, number]> }>} */
const objects = [];
let current = null;

function parseFaceCenter(line) {
  const parts = line.trim().split(/\s+/);
  const idxs = [];
  for (let i = 1; i < parts.length; i++) {
    const vi = parseInt(parts[i].split("/")[0], 10);
    if (Number.isFinite(vi) && vi > 0) idxs.push(vi);
  }
  if (idxs.length < 3) return null;
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const vi of idxs) {
    const v = verts[vi - 1];
    if (!v) return null;
    sx += v[0];
    sy += v[1];
    sz += v[2];
  }
  return [sx / idxs.length, sy / idxs.length, sz / idxs.length];
}

function clusterPoints(points) {
  /** @type {Array<{ x: number, y: number, z: number, n: number }>} */
  const clusters = [];
  for (const [x, y, z] of points) {
    let best = null;
    let bestDist = CLUSTER_RADIUS;
    for (const c of clusters) {
      const d = Math.hypot(c.x - x, c.y - y, c.z - z);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    if (best) {
      const n = best.n + 1;
      best.x = (best.x * best.n + x) / n;
      best.y = (best.y * best.n + y) / n;
      best.z = (best.z * best.n + z) / n;
      best.n = n;
    } else {
      clusters.push({ x, y, z, n: 1 });
    }
  }
  return clusters.filter((c) => c.n >= 4);
}

function flushObject() {
  if (!current?.faceCenters.length) return;
  objects.push(current);
  current = null;
}

await new Promise((resolve, reject) => {
  const stream = createReadStream(sourceObj, { encoding: "utf8", highWaterMark: 8 * 1024 * 1024 });
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.startsWith("v ")) {
        const p = line.split(/\s+/);
        verts.push([+p[1], +p[2], +p[3]]);
      } else if (line.startsWith("o ")) {
        flushObject();
        const name = line.slice(2).trim();
        if (CHEST_OBJECTS.has(name)) current = { name, faceCenters: [] };
      } else if (current && line.startsWith("f ")) {
        const c = parseFaceCenter(line);
        if (c) current.faceCenters.push(c);
      }
    }
  });
  stream.on("end", () => {
    flushObject();
    resolve();
  });
  stream.on("error", reject);
});

/** @type {Array<{ id: string, kind: string, x: number, y: number, z: number }>} */
const crates = [];
let id = 0;

for (const obj of objects) {
  const clusters = clusterPoints(obj.faceCenters);
  for (const c of clusters) {
    id++;
    crates.push({
      id: `${obj.name.toLowerCase().replace(/_/g, "-")}-${id}`,
      kind: obj.name,
      x: +c.x.toFixed(2),
      y: +c.y.toFixed(2),
      z: +c.z.toFixed(2),
    });
  }
  console.log(`${obj.name}: ${obj.faceCenters.length} faces → ${clusters.length} crates`);
}

crates.sort((a, b) => a.z - b.z || a.x - b.x);

const outPath = join(root, "assets", "ice-chest-positions.json");
writeFileSync(outPath, JSON.stringify({ source: sourceObj, count: crates.length, crates }, null, 2) + "\n");
console.log(`Wrote ${crates.length} crate positions → ${outPath}`);
