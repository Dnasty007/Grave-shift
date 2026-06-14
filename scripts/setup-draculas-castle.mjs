/**
 * Copies Mineways Dracula.obj export into assets/, converts to GLB for Hytopia, and writes draculas-castle-map.json.
 *
 * Hytopia only loads .gltf/.glb models — OBJ is kept as source; Dracula.glb is what the game spawns.
 *
 * Mineways exports 16×16 block textures and ~72k flat "billboard" planes (torches, signs, flowers).
 * We upscale tex/*.png so they stay crisp at 1 block = 1 meter (default 256×256 HD).
 *
 * Default source: c:\OFF ONE DRIVE\new map\Dracula.obj
 * Override: DRACULA_SOURCE_DIR="D:\path\to\export" node scripts/setup-draculas-castle.mjs
 * Texture size: DRACULA_TEX_SIZE=1024 (default 512; 256 for smaller GLB)
 */
import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import obj2gltf from "obj2gltf";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const sourceDir =
  process.env.DRACULA_SOURCE_DIR ??
  "c:\\OFF ONE DRIVE\\new map";

const modelDir = join(root, "assets", "models", "environment", "Draculas-Castle");
const archiveDir = join(root, "assets", "draculas-castle");
const mapOut = join(root, "assets", "draculas-castle-map.json");

const objName = "Dracula.obj";
const mtlName = "Dracula.mtl";
const glbName = "Dracula.glb";

/** Target texel size per block face (Mineways default export is 16×16). */
const TEX_SIZE = Math.min(
  1024,
  Math.max(64, Number(process.env.DRACULA_TEX_SIZE ?? 512) || 512)
);

function copyExport() {
  const srcObj = join(sourceDir, objName);
  const srcMtl = join(sourceDir, mtlName);
  const srcTex = join(sourceDir, "tex");

  if (!existsSync(srcObj)) {
    console.error(`Missing source OBJ: ${srcObj}`);
    console.error("Set DRACULA_SOURCE_DIR to your Mineways export folder.");
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

/** Nearest-neighbor upscale — keeps Minecraft pixels sharp instead of blurry when stretched. */
async function upscaleTextures(texDir) {
  if (!existsSync(texDir)) return;

  const files = readdirSync(texDir).filter((f) => f.endsWith(".png"));
  if (!files.length) return;

  console.log(`Upscaling ${files.length} textures to ${TEX_SIZE}×${TEX_SIZE} (nearest-neighbor)…`);
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

/** OBJ → GLB (Hytopia requires glTF). Run from modelDir so tex/ paths resolve. */
async function convertToGlb() {
  const objPath = join(modelDir, objName);
  const glbPath = join(modelDir, glbName);
  const archiveGlb = join(archiveDir, glbName);

  console.log(`Converting ${objName} → ${glbName} (this may take a minute)…`);
  const t0 = performance.now();

  const glb = await obj2gltf(objPath, { binary: true, checkTransparency: true });
  writeFileSync(glbPath, Buffer.from(glb));
  cpSync(glbPath, archiveGlb);

  const mb = (glb.byteLength / (1024 * 1024)).toFixed(1);
  console.log(`Wrote ${glbName} (${mb} MB) in ${((performance.now() - t0) / 1000).toFixed(1)}s`);
}

/** Minimal voxel shell — castle mesh provides visuals + collision (Mineways, centered). */
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
        id: "zone_spawn_courtyard",
        label: "spawn_point",
        type: "box",
        position: { x: 15.68, y: -59.24, z: -74.77 },
        dimensions: { width: 1, height: 3, depth: 1 },
        color: "#dc2626",
        metadata: {},
        from: { x: 15.68, y: -59.24, z: -74.77 },
        to: { x: 15.68, y: -57.24, z: -74.77 },
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
console.log("Dracula's Castle setup complete. Restart npm run dev to load the map.");
