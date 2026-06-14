/**
 * Copies Mineways Ice_Map export into assets/, converts to GLB for Hytopia, writes ice-map-map.json.
 *
 * Default source: c:\OFF ONE DRIVE\game maps\Ice map
 * Override: ICE_MAP_SOURCE_DIR="D:\path" node scripts/setup-ice-map.mjs
 * Texture size: ICE_MAP_TEX_SIZE=512 (default)
 */
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import obj2gltf from "obj2gltf";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const sourceDir =
  process.env.ICE_MAP_SOURCE_DIR ??
  "c:\\OFF ONE DRIVE\\game maps\\Ice map";

const modelDir = join(root, "assets", "models", "environment", "Ice-Map");
const archiveDir = join(root, "assets", "ice-map");
const mapOut = join(root, "assets", "ice-map-map.json");

const objName = "Ice_Map.obj";
const mtlName = "Ice_Map.mtl";
const glbName = "Ice_Map.glb";

const TEX_SIZE = Math.min(
  1024,
  Math.max(64, Number(process.env.ICE_MAP_TEX_SIZE ?? 512) || 512)
);

function copyExport() {
  const srcObj = join(sourceDir, objName);
  const srcMtl = join(sourceDir, mtlName);
  const srcTex = join(sourceDir, "tex");

  if (!existsSync(srcObj)) {
    console.error(`Missing source OBJ: ${srcObj}`);
    console.error("Set ICE_MAP_SOURCE_DIR to your Mineways export folder.");
    process.exit(1);
  }

  mkdirSync(modelDir, { recursive: true });
  mkdirSync(archiveDir, { recursive: true });

  cpSync(srcObj, join(modelDir, objName));
  cpSync(srcObj, join(archiveDir, objName));
  console.log(`Copied ${objName} → ${modelDir}`);

  if (existsSync(srcMtl)) {
    cpSync(srcMtl, join(modelDir, mtlName));
    cpSync(srcMtl, join(archiveDir, mtlName));
    console.log(`Copied ${mtlName}`);
  }

  if (existsSync(srcTex)) {
    cpSync(srcTex, join(modelDir, "tex"), { recursive: true });
    cpSync(srcTex, join(archiveDir, "tex"), { recursive: true });
    console.log("Copied tex/ folder");
  } else {
    console.warn("No tex/ folder beside OBJ — textures may be missing in-game.");
  }
}

async function upscaleTextures(texDir) {
  if (!existsSync(texDir)) return;

  const files = readdirSync(texDir).filter((f) => f.endsWith(".png"));
  if (!files.length) return;

  console.log(`Upscaling ${files.length} textures to ${TEX_SIZE}×${TEX_SIZE}…`);
  const t0 = performance.now();

  for (const file of files) {
    const path = join(texDir, file);
    const meta = await sharp(path).metadata();
    if (meta.width === TEX_SIZE && meta.height === TEX_SIZE) continue;

    const buf = await sharp(path)
      .resize(TEX_SIZE, TEX_SIZE, { kernel: sharp.kernel.nearest })
      .png({ compressionLevel: 6 })
      .toBuffer();
    writeFileSync(path, buf);
  }

  console.log(`Texture upscale done in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}

async function convertToGlb() {
  const objPath = join(modelDir, objName);
  const glbPath = join(modelDir, glbName);
  const archiveGlb = join(archiveDir, glbName);

  console.log(`Converting ${objName} → ${glbName} (large map — may take several minutes)…`);
  const t0 = performance.now();

  const glb = await obj2gltf(objPath, { binary: true, checkTransparency: true });
  writeFileSync(glbPath, Buffer.from(glb));
  cpSync(glbPath, archiveGlb);

  const mb = (glb.byteLength / (1024 * 1024)).toFixed(1);
  console.log(`Wrote ${glbName} (${mb} MB) in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}

function writeMapJson() {
  const map = {
    blockTypes: [
      {
        id: 1,
        name: "stone-bricks",
        textureUri: "blocks/stone-bricks.png",
        isCustom: false,
        isMultiTexture: false,
        isLiquid: false,
      },
    ],
    blocks: {},
    zones: [
      {
        id: "zone_spawn_ice",
        label: "spawn_point",
        type: "box",
        position: { x: 0, y: 1, z: 0 },
        dimensions: { width: 1, height: 3, depth: 1 },
        color: "#38bdf8",
        metadata: {},
        from: { x: 0, y: 1, z: 0 },
        to: { x: 0, y: 3, z: 0 },
      },
    ],
    version: "2.0.0",
  };

  writeFileSync(mapOut, JSON.stringify(map, null, 2) + "\n", "utf8");
  console.log(`Wrote ${mapOut}`);
}

copyExport();
await upscaleTextures(join(modelDir, "tex"));
await upscaleTextures(join(archiveDir, "tex"));
await convertToGlb();
writeMapJson();
console.log("Ice Map setup complete. Restart npm run dev to load the map.");
