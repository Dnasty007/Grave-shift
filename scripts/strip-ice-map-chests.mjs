/**
 * Remove baked Mineways chest geometry from Ice_Map.obj so Hytopia entities replace them.
 *
 * Usage: node scripts/strip-ice-map-chests.mjs [path/to/Ice_Map.obj]
 * Default: assets/models/environment/Ice-Map/Ice_Map.obj
 */
import { createReadStream, existsSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const STRIP_OBJECTS = new Set(["Chest", "Ender_Chest", "Trapped_Chest"]);

const objPath =
  process.argv[2] ??
  join(root, "assets", "models", "environment", "Ice-Map", "Ice_Map.obj");

if (!existsSync(objPath)) {
  console.error(`Missing OBJ: ${objPath}`);
  process.exit(1);
}

const tmpPath = `${objPath}.no-chests.tmp`;
/** @type {string[]} */
const outLines = [];

let skipObject = false;
let strippedFaces = 0;
let strippedObjects = 0;

await new Promise((resolve, reject) => {
  const stream = createReadStream(objPath, { encoding: "utf8", highWaterMark: 8 * 1024 * 1024 });
  let buf = "";
  stream.on("data", (chunk) => {
    buf += chunk;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const trimmed = line.trim();

      if (trimmed.startsWith("o ")) {
        const name = trimmed.slice(2).trim();
        skipObject = STRIP_OBJECTS.has(name);
        if (skipObject) strippedObjects++;
        if (!skipObject) outLines.push(line);
        continue;
      }

      if (skipObject && trimmed.startsWith("f ")) {
        strippedFaces++;
        continue;
      }

      if (!skipObject) outLines.push(line);
    }
  });
  stream.on("end", () => {
    if (buf.length && !skipObject) outLines.push(buf);
    resolve(undefined);
  });
  stream.on("error", reject);
});

writeFileSync(tmpPath, outLines.join("\n") + "\n", "utf8");
renameSync(tmpPath, objPath);

console.log(
  `Stripped ${strippedObjects} chest object groups (${strippedFaces} faces) from ${objPath}`
);
