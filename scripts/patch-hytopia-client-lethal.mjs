/**
 * Map keyboard G → Hytopia wire key "n" so lethal throw works during pointer lock.
 * Hytopia's input schema has no "g"; the game server polls `player.input.n`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const inputManager = join(
  root,
  "hytopia-client",
  "client",
  "src",
  "input",
  "InputManager.ts"
);

if (!existsSync(inputManager)) {
  console.log("patch-hytopia-client-lethal: hytopia-client not present — skip.");
  process.exit(0);
}

const MARKER = "'KeyG': 'n'";
const src = readFileSync(inputManager, "utf8");

if (src.includes(MARKER)) {
  console.log("patch-hytopia-client-lethal: already patched.");
  process.exit(0);
}

const anchor = "  'KeyF': 'f',";
if (!src.includes(anchor)) {
  console.warn("patch-hytopia-client-lethal: anchor not found — manual patch needed.");
  process.exit(1);
}

const patched = src.replace(
  anchor,
  `${anchor}\n  ${MARKER}, /* Project Gehenna: G → lethal (server polls input.n) */`
);

writeFileSync(inputManager, patched, "utf8");
console.log("patch-hytopia-client-lethal: mapped KeyG → wire key n.");
