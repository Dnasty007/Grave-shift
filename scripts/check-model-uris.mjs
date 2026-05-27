import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const root = join(import.meta.dirname, "..");
const sourceRoots = [join(root, "index.ts"), join(root, "src")];
const assetRoots = [
  join(root, "assets"),
  join(root, "node_modules", "@hytopia.com", "assets"),
];
const modelUriPattern = /modelUri:\s*["']([^"']+)["']/g;
const failures = [];

function walk(path) {
  if (!existsSync(path)) return [];
  const statEntries = readdirSync(path, { withFileTypes: true });
  return statEntries.flatMap((entry) => {
    const child = join(path, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  });
}

const files = sourceRoots.flatMap((sourcePath) => {
  if (!existsSync(sourcePath)) return [];
  return extname(sourcePath) ? [sourcePath] : walk(sourcePath);
}).filter((file) => extname(file) === ".ts");

for (const file of files) {
  const contents = readFileSync(file, "utf8");
  for (const match of contents.matchAll(modelUriPattern)) {
    const modelUri = match[1];
    if (!modelUri.startsWith("models/")) continue;

    const existsInAssetRoot = assetRoots.some((assetRoot) => existsSync(join(assetRoot, modelUri)));
    if (!existsInAssetRoot) {
      failures.push(`${relative(root, file)} references missing ${modelUri}`);
    }
  }
}

if (failures.length) {
  console.error("Missing modelUri assets:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`OK: checked ${files.length} TypeScript files for modelUri assets.`);
