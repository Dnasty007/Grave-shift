import * as pc from "playcanvas";

/**
 * Hytopia `map.json`: sparse voxels + palette (big-world / boilerplate).
 * Supports optional AABB crop for huge maps and diffuse textures under `/hytopia/blocks/`.
 */
export type HytopiaBlockType = {
  id: number;
  name: string;
  textureUri?: string;
  isMultiTexture?: boolean;
  isLiquid?: boolean;
  isCustom?: boolean;
};

export type HytopiaMapJson = {
  blockTypes: HytopiaBlockType[];
  blocks: Record<string, number>;
};

export type HytopiaMapBuildOptions = {
  /** Parent directory for `textureUri` paths like `blocks/foo.png` → `{textureBaseUrl}/foo.png`. */
  textureBaseUrl: string;
  crop?: {
    center: [number, number, number];
    halfExtents: [number, number, number];
  };
};

const FACE_DIRS: ReadonlyArray<readonly [number, number, number]> = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1]
];

function faceDirKey(dir: readonly [number, number, number]): string {
  return `${dir[0]},${dir[1]},${dir[2]}`;
}

/** Top / bottom / horizontal sides — matches Hytopia cube-face folders (`+y`, `-y`, `+x`, …). */
const FACE_DIR_TOP = new Set<string>([faceDirKey([0, 1, 0])]);
const FACE_DIR_BOTTOM = new Set<string>([faceDirKey([0, -1, 0])]);
const FACE_DIR_SIDES = new Set<string>([
  faceDirKey([1, 0, 0]),
  faceDirKey([-1, 0, 0]),
  faceDirKey([0, 0, 1]),
  faceDirKey([0, 0, -1])
]);

/**
 * `hytopia-big-world-map.json` references some textures from the full Hytopia asset pack; the
 * public `sdk-examples/big-world/assets/blocks` tree is smaller. Map those to shipped files, and
 * map folder-style URIs (`blocks/grass-block`) to cube-face PNGs we do have (`grass/+y.png`).
 */
const TEXTURE_REL_ALIASES: Record<string, string> = {
  "deepslate.png": "dragons-stone.png",
  "granite.png": "stone.png",
  "pink-concrete.png": "infected-shadowrock.png",
  "water.png": "water-still.png",
  "grass-block": "grass/+y.png",
  "spruce-log": "log/+x.png"
};

function stripBlocksPrefix(textureUri: string): string {
  return textureUri.startsWith("blocks/")
    ? textureUri.slice("blocks/".length)
    : textureUri;
}

function hasImageExtension(rel: string): boolean {
  const lower = rel.toLowerCase();
  return (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".webp")
  );
}

/**
 * Relative paths under `textureBaseUrl`, first success wins (browser fetch).
 */
function textureRelCandidates(textureUri: string): string[] {
  const raw = stripBlocksPrefix(textureUri);
  const aliased = TEXTURE_REL_ALIASES[raw] ?? raw;
  const out: string[] = [];
  const add = (rel: string): void => {
    if (!out.includes(rel)) out.push(rel);
  };

  const expand = (rel: string): void => {
    if (hasImageExtension(rel)) {
      add(rel);
      return;
    }
    add(`${rel}/+y.png`);
    add(`${rel}/+x.png`);
    add(`${rel}.png`);
  };

  if (aliased !== raw) {
    expand(aliased);
    expand(raw);
  } else {
    expand(raw);
  }
  return out;
}

function textureUrlCandidates(textureBaseUrl: string, textureUri: string): string[] {
  const base = textureBaseUrl.replace(/\/$/, "");
  return textureRelCandidates(textureUri).map((rel) => `${base}/${rel}`);
}

/** Fallback colors when a texture fails to load or is missing. */
const BLOCK_COLOR_BY_NAME: Record<string, [number, number, number]> = {
  andesite: [0.45, 0.45, 0.48],
  bricks: [0.62, 0.35, 0.32],
  clay: [0.5, 0.38, 0.36],
  cobblestone: [0.42, 0.42, 0.44],
  "mossy-coblestone": [0.38, 0.44, 0.35],
  dirt: [0.45, 0.32, 0.22],
  grass: [0.35, 0.58, 0.3],
  gravel: [0.48, 0.46, 0.44],
  ice: [0.75, 0.9, 0.95],
  glass: [0.85, 0.9, 0.92],
  sand: [0.82, 0.78, 0.58],
  stone: [0.52, 0.52, 0.54],
  "stone-bricks": [0.48, 0.48, 0.5],
  "oak-leaves": [0.32, 0.55, 0.22],
  "oak-planks": [0.58, 0.42, 0.26],
  "log-side": [0.4, 0.3, 0.2],
  "log-top": [0.48, 0.38, 0.28],
  "diamond-ore": [0.45, 0.8, 0.85],
  dragons: [0.35, 0.22, 0.5],
  "dragons-stone": [0.28, 0.18, 0.42],
  "infected-shadowrock": [0.32, 0.2, 0.38],
  shadowrock: [0.35, 0.32, 0.4],
  nuit: [0.15, 0.12, 0.25],
  void: [0.2, 0.1, 0.35],
  "void-sand": [0.45, 0.35, 0.55],
  water: [0.2, 0.45, 0.85],
  "water-still": [0.2, 0.45, 0.85],
  "birch-leaves": [0.45, 0.72, 0.38],
  "coal-ore": [0.22, 0.22, 0.24],
  "grass-block-pine": [0.35, 0.55, 0.28],
  "grass-block": [0.4, 0.62, 0.3],
  "oak-log": [0.48, 0.38, 0.24],
  "spruce-leaves": [0.26, 0.45, 0.24],
  "spruce-log": [0.34, 0.28, 0.2]
};

function key(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

function filterBlocks(
  blocks: Record<string, number>,
  crop: HytopiaMapBuildOptions["crop"]
): Record<string, number> {
  if (!crop) {
    return { ...blocks };
  }
  const [cx, cy, cz] = crop.center;
  const [hx, hy, hz] = crop.halfExtents;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(blocks)) {
    const p = k.split(",");
    if (p.length !== 3) continue;
    const x = parseInt(p[0], 10);
    const y = parseInt(p[1], 10);
    const z = parseInt(p[2], 10);
    if (!Number.isFinite(x + y + z)) continue;
    if (
      Math.abs(x - cx) <= hx &&
      Math.abs(y - cy) <= hy &&
      Math.abs(z - cz) <= hz
    ) {
      out[k] = v;
    }
  }
  return out;
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Image failed: ${url}`));
    img.src = url;
  });
}

function createTexturedMaterialFromImage(
  app: pc.Application,
  img: HTMLImageElement,
  fallbackName: string,
  options?: { foliageCutout?: boolean; emissiveIntensity?: number }
): pc.StandardMaterial {
  const tex = new pc.Texture(app.graphicsDevice, {
    name: `hytopia-${fallbackName}`,
    width: img.width,
    height: img.height,
    // WebGPU: PIXELFORMAT_SRGB8 has no `gpuTextureFormats` entry (unsupported) → black textures.
    format: pc.PIXELFORMAT_SRGBA8,
    mipmaps: true,
    minFilter: pc.FILTER_LINEAR_MIPMAP_LINEAR,
    magFilter: pc.FILTER_LINEAR,
    addressU: pc.ADDRESS_REPEAT,
    addressV: pc.ADDRESS_REPEAT
  });
  tex.setSource(img);
  tex.upload();
  const mat = new pc.StandardMaterial();
  // Albedo tint must be white or diffuseMap reads as black in the lit shader.
  mat.diffuse = new pc.Color(1, 1, 1);
  mat.diffuseMap = tex;
  mat.useMetalness = false;
  mat.metalness = 0;
  mat.specular = new pc.Color(0.06, 0.06, 0.07);
  mat.gloss = 0.42;
  // Soft unlit boost so shadowed voxel faces stay readable (outdoor map lighting).
  mat.emissiveMap = tex;
  mat.emissive = new pc.Color(1, 1, 1);
  mat.emissiveIntensity = options?.emissiveIntensity ?? 0.28;
  /** Leaf / cutout PNGs: without alphaTest, transparent texels fight the depth buffer → “half missing” canopies. */
  if (options?.foliageCutout) {
    mat.alphaTest = 0.42;
    mat.alphaToCoverage = true;
  }
  mat.update();
  return mat;
}

async function loadFirstImage(urls: string[]): Promise<HTMLImageElement | null> {
  for (const u of urls) {
    try {
      return await loadImage(u);
    } catch {
      /* try next */
    }
  }
  return null;
}

function createSolidMaterial(name: string): pc.StandardMaterial {
  let rgb = BLOCK_COLOR_BY_NAME[name];
  if (!rgb) {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
    const r = 0.35 + ((h & 0xff) / 255) * 0.35;
    const g = 0.35 + (((h >> 8) & 0xff) / 255) * 0.35;
    const b = 0.35 + (((h >> 16) & 0xff) / 255) * 0.35;
    rgb = [r, g, b];
  }
  const mat = new pc.StandardMaterial();
  mat.diffuse = new pc.Color(rgb[0], rgb[1], rgb[2]);
  mat.emissive = new pc.Color(
    rgb[0] * 0.12 + 0.04,
    rgb[1] * 0.12 + 0.04,
    rgb[2] * 0.12 + 0.04
  );
  mat.emissiveIntensity = 0.85;
  mat.update();
  return mat;
}

function blockUsesFoliageCutout(blockType: HytopiaBlockType | undefined): boolean {
  const n = blockType?.name ?? "";
  return (
    n.includes("leaves") || n.includes("sapling") || n.includes("flower")
  );
}

async function materialForBlockType(
  app: pc.Application,
  blockType: HytopiaBlockType | undefined,
  textureBaseUrl: string
): Promise<pc.StandardMaterial> {
  const name = blockType?.name ?? "unknown";
  const uri = blockType?.textureUri?.trim();
  if (!uri) {
    return createSolidMaterial(name);
  }
  const urls = textureUrlCandidates(textureBaseUrl, uri);
  const img = await loadFirstImage(urls);
  if (img) {
    return createTexturedMaterialFromImage(app, img, name, {
      foliageCutout: blockUsesFoliageCutout(blockType)
    });
  }
  return createSolidMaterial(name);
}

function multiTextureFolderRel(textureUri: string): string | null {
  const raw = stripBlocksPrefix(textureUri.trim());
  if (hasImageExtension(raw)) return null;
  return raw;
}

async function loadCubeFaceImage(
  textureBaseUrl: string,
  folderRel: string,
  face: "+x" | "-x" | "+y" | "-y" | "+z" | "-z"
): Promise<HTMLImageElement | null> {
  const base = textureBaseUrl.replace(/\/$/, "");
  const url = `${base}/${folderRel}/${face}.png`;
  try {
    return await loadImage(url);
  } catch {
    return null;
  }
}

/**
 * Hytopia multi-face folders (`grass-block/+y.png`, …). One atlas texture was being reused on all
 * six faces — sides looked “blank” or wrong. Split into top / bottom / side materials.
 */
async function materialsForMultiTextureFolder(
  app: pc.Application,
  blockType: HytopiaBlockType,
  textureBaseUrl: string,
  folderRel: string
): Promise<{
  top: pc.StandardMaterial;
  side: pc.StandardMaterial;
  bottom: pc.StandardMaterial;
} | null> {
  const name = blockType.name ?? "multi";
  const imgTop =
    (await loadCubeFaceImage(textureBaseUrl, folderRel, "+y")) ??
    (await loadFirstImage(textureUrlCandidates(textureBaseUrl, blockType.textureUri!)));
  if (!imgTop) return null;

  const imgSide =
    (await loadCubeFaceImage(textureBaseUrl, folderRel, "+x")) ??
    (await loadCubeFaceImage(textureBaseUrl, folderRel, "+z")) ??
    imgTop;
  const imgBottom =
    (await loadCubeFaceImage(textureBaseUrl, folderRel, "-y")) ??
    (await loadCubeFaceImage(textureBaseUrl, folderRel, "+y")) ??
    imgTop;

  const foliage = blockUsesFoliageCutout(blockType);
  return {
    top: createTexturedMaterialFromImage(app, imgTop, `${name}-top`, {
      foliageCutout: foliage,
      emissiveIntensity: 0.26
    }),
    side: createTexturedMaterialFromImage(app, imgSide, `${name}-side`, {
      foliageCutout: foliage,
      emissiveIntensity: 0.24
    }),
    bottom: createTexturedMaterialFromImage(app, imgBottom, `${name}-bottom`, {
      foliageCutout: foliage,
      emissiveIntensity: 0.22
    })
  };
}

/**
 * Per-face UVs [0,1] on each unit cube face (texture-friendly).
 */
function pushFace(
  bx: number,
  by: number,
  bz: number,
  dir: readonly [number, number, number],
  positions: number[],
  normals: number[],
  uvs: number[]
): void {
  const dx = dir[0];
  const dy = dir[1];
  const dz = dir[2];

  let ax: number;
  let ay: number;
  let az: number;
  let bx1: number;
  let by1: number;
  let bz1: number;
  let cx: number;
  let cy: number;
  let cz: number;
  let dx2: number;
  let dy2: number;
  let dz2: number;

  let u0: number;
  let v0: number;
  let u1: number;
  let v1: number;
  let u2: number;
  let v2: number;
  let u3: number;
  let v3: number;

  if (dx === 1) {
    ax = bx + 1;
    ay = by;
    az = bz;
    bx1 = ax;
    by1 = by;
    bz1 = bz + 1;
    cx = ax;
    cy = by + 1;
    cz = bz + 1;
    dx2 = ax;
    dy2 = by + 1;
    dz2 = bz;
    u0 = 0;
    v0 = 0;
    u1 = 1;
    v1 = 0;
    u2 = 1;
    v2 = 1;
    u3 = 0;
    v3 = 1;
  } else if (dx === -1) {
    ax = bx;
    ay = by;
    az = bz + 1;
    bx1 = bx;
    by1 = by;
    bz1 = bz;
    cx = bx;
    cy = by + 1;
    cz = bz;
    dx2 = bx;
    dy2 = by + 1;
    dz2 = bz + 1;
    u0 = 0;
    v0 = 0;
    u1 = 1;
    v1 = 0;
    u2 = 1;
    v2 = 1;
    u3 = 0;
    v3 = 1;
  } else if (dy === 1) {
    ax = bx;
    ay = by + 1;
    az = bz;
    bx1 = bx + 1;
    by1 = ay;
    bz1 = bz;
    cx = bx + 1;
    cy = ay;
    cz = bz + 1;
    dx2 = bx;
    dy2 = ay;
    dz2 = bz + 1;
    u0 = 0;
    v0 = 0;
    u1 = 1;
    v1 = 0;
    u2 = 1;
    v2 = 1;
    u3 = 0;
    v3 = 1;
  } else if (dy === -1) {
    ax = bx;
    ay = by;
    az = bz + 1;
    bx1 = bx + 1;
    by1 = ay;
    bz1 = bz + 1;
    cx = bx + 1;
    cy = ay;
    cz = bz;
    dx2 = bx;
    dy2 = ay;
    dz2 = bz;
    u0 = 0;
    v0 = 0;
    u1 = 1;
    v1 = 0;
    u2 = 1;
    v2 = 1;
    u3 = 0;
    v3 = 1;
  } else if (dz === 1) {
    ax = bx;
    ay = by;
    az = bz + 1;
    bx1 = bx + 1;
    by1 = by;
    bz1 = bz + 1;
    cx = bx + 1;
    cy = by + 1;
    cz = bz + 1;
    dx2 = bx;
    dy2 = by + 1;
    dz2 = bz + 1;
    u0 = 0;
    v0 = 0;
    u1 = 1;
    v1 = 0;
    u2 = 1;
    v2 = 1;
    u3 = 0;
    v3 = 1;
  } else {
    ax = bx + 1;
    ay = by;
    az = bz;
    bx1 = bx;
    by1 = by;
    bz1 = bz;
    cx = bx;
    cy = by + 1;
    cz = bz;
    dx2 = bx + 1;
    dy2 = by + 1;
    dz2 = bz;
    u0 = 0;
    v0 = 0;
    u1 = 1;
    v1 = 0;
    u2 = 1;
    v2 = 1;
    u3 = 0;
    v3 = 1;
  }

  const nx = dx;
  const ny = dy;
  const nz = dz;
  const emit = (
    x: number,
    y: number,
    z: number,
    u: number,
    v: number
  ): void => {
    positions.push(x, y, z);
    normals.push(nx, ny, nz);
    uvs.push(u, v);
  };

  emit(ax, ay, az, u0, v0);
  emit(bx1, by1, bz1, u1, v1);
  emit(cx, cy, cz, u2, v2);
  emit(ax, ay, az, u0, v0);
  emit(cx, cy, cz, u2, v2);
  emit(dx2, dy2, dz2, u3, v3);
}

function buildMeshForType(
  device: pc.GraphicsDevice,
  typeId: number,
  cells: Array<[number, number, number]>,
  blockAt: Map<string, number>,
  liquidIds: Set<number>,
  faceDirFilter?: ReadonlySet<string> | null
): pc.Mesh | null {
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  const isSolidAt = (x: number, y: number, z: number): boolean => {
    const id = blockAt.get(key(x, y, z));
    if (id === undefined) return false;
    return !liquidIds.has(id);
  };

  for (const [bx, by, bz] of cells) {
    for (const dir of FACE_DIRS) {
      if (faceDirFilter && !faceDirFilter.has(faceDirKey(dir))) continue;
      const nx = bx + dir[0];
      const ny = by + dir[1];
      const nz = bz + dir[2];
      if (isSolidAt(nx, ny, nz)) continue;
      pushFace(bx, by, bz, dir, positions, normals, uvs);
    }
  }

  if (positions.length === 0) {
    return null;
  }

  const mesh = new pc.Mesh(device);
  mesh.setPositions(new Float32Array(positions));
  mesh.setNormals(new Float32Array(normals));
  mesh.setUvs(0, new Float32Array(uvs));
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}

/**
 * @deprecated Prefer {@link buildHytopiaMapEntityAsync} for texture + crop support.
 */
export function buildHytopiaMapEntity(
  app: pc.Application,
  data: HytopiaMapJson
): pc.Entity {
  const root = new pc.Entity("imported-map");
  const device = app.graphicsDevice;
  const filtered = filterBlocks(data.blocks, undefined);
  const liquidIds = new Set<number>();
  const idToType = new Map<number, HytopiaBlockType>();
  for (const t of data.blockTypes) {
    idToType.set(t.id, t);
    if (t.isLiquid) liquidIds.add(t.id);
  }
  const blockAt = new Map<string, number>();
  for (const [k, v] of Object.entries(filtered)) {
    blockAt.set(k, v);
  }
  const byType = new Map<number, Array<[number, number, number]>>();
  for (const en of Object.entries(filtered)) {
    const [kx, ky, kz] = en[0].split(",").map((n) => parseInt(n, 10));
    const id = en[1];
    if (!Number.isFinite(kx) || !Number.isFinite(ky) || !Number.isFinite(kz))
      continue;
    let list = byType.get(id);
    if (!list) {
      list = [];
      byType.set(id, list);
    }
    list.push([kx, ky, kz]);
  }
  const meshInstances: pc.MeshInstance[] = [];
  for (const typeId of byType.keys()) {
    if (liquidIds.has(typeId)) continue;
    const mesh = buildMeshForType(device, typeId, byType.get(typeId)!, blockAt, liquidIds, null);
    if (!mesh) continue;
    const name = idToType.get(typeId)?.name ?? `block-${typeId}`;
    const mat = createSolidMaterial(name);
    const mi = new pc.MeshInstance(mesh, mat, root);
    mi.castShadow = true;
    meshInstances.push(mi);
  }
  if (meshInstances.length > 0) {
    root.addComponent("render", { type: "asset", meshInstances });
  }
  return root;
}

export async function buildHytopiaMapEntityAsync(
  app: pc.Application,
  data: HytopiaMapJson,
  options: HytopiaMapBuildOptions
): Promise<pc.Entity> {
  const filtered = filterBlocks(data.blocks, options.crop);
  const n = Object.keys(filtered).length;
  if (options.crop) {
    console.log(
      `[hytopiaMapMesh] Cropped voxel map: ${n} blocks (full map had ${Object.keys(data.blocks).length}).`
    );
  }

  const liquidIds = new Set<number>();
  const idToType = new Map<number, HytopiaBlockType>();
  for (const t of data.blockTypes) {
    idToType.set(t.id, t);
    if (t.isLiquid) liquidIds.add(t.id);
  }

  const blockAt = new Map<string, number>();
  for (const [k, v] of Object.entries(filtered)) {
    blockAt.set(k, v);
  }

  const byType = new Map<number, Array<[number, number, number]>>();
  for (const en of Object.entries(filtered)) {
    const [kx, ky, kz] = en[0].split(",").map((n) => parseInt(n, 10));
    const id = en[1];
    if (!Number.isFinite(kx) || !Number.isFinite(ky) || !Number.isFinite(kz))
      continue;
    let list = byType.get(id);
    if (!list) {
      list = [];
      byType.set(id, list);
    }
    list.push([kx, ky, kz]);
  }

  const matCache = new Map<number, pc.StandardMaterial>();
  const multiMatCache = new Map<
    number,
    { top: pc.StandardMaterial; side: pc.StandardMaterial; bottom: pc.StandardMaterial }
  >();
  const typeIds = [...byType.keys()].filter((id) => !liquidIds.has(id));
  await Promise.all(
    typeIds.map(async (tid) => {
      const def = idToType.get(tid);
      const folder =
        def?.isMultiTexture && def.textureUri ? multiTextureFolderRel(def.textureUri) : null;
      if (folder) {
        const mats = await materialsForMultiTextureFolder(
          app,
          def!,
          options.textureBaseUrl,
          folder
        );
        if (mats) {
          multiMatCache.set(tid, mats);
          return;
        }
      }
      matCache.set(tid, await materialForBlockType(app, def, options.textureBaseUrl));
    })
  );

  const root = new pc.Entity("imported-map");
  const device = app.graphicsDevice;
  const meshInstances: pc.MeshInstance[] = [];

  for (const typeId of typeIds) {
    const cells = byType.get(typeId)!;
    const mats3 = multiMatCache.get(typeId);
    if (mats3) {
      const parts: Array<[ReadonlySet<string>, pc.StandardMaterial]> = [
        [FACE_DIR_TOP, mats3.top],
        [FACE_DIR_BOTTOM, mats3.bottom],
        [FACE_DIR_SIDES, mats3.side]
      ];
      for (const [filter, mat] of parts) {
        const mesh = buildMeshForType(device, typeId, cells, blockAt, liquidIds, filter);
        if (!mesh) continue;
        const mi = new pc.MeshInstance(mesh, mat, root);
        mi.castShadow = true;
        meshInstances.push(mi);
      }
    } else {
      const mesh = buildMeshForType(device, typeId, cells, blockAt, liquidIds, null);
      if (!mesh) continue;
      const mat = matCache.get(typeId) ?? createSolidMaterial("fallback");
      const mi = new pc.MeshInstance(mesh, mat, root);
      mi.castShadow = true;
      meshInstances.push(mi);
    }
  }

  if (meshInstances.length === 0) {
    console.warn("[hytopiaMapMesh] No solid geometry after crop/load.");
  } else {
    root.addComponent("render", { type: "asset", meshInstances });
  }

  return root;
}
