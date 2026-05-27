/**
 * Local HYTOPIA web client: clone upstream if needed, install client deps, run Vite on 127.0.0.1:5174.
 * Opens http://127.0.0.1:<port>/?join=… unless PLAY_LOCAL_NO_OPEN=1.
 * PLAY_LOCAL_JOIN (default localhost:8080), PLAY_LOCAL_CLIENT_PORT (default 5174).
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const repoDir = join(root, "hytopia-client");
const clientDir = join(repoDir, "client");
const clientPkg = join(clientDir, "package.json");
const cloneUrl = "https://github.com/hytopiagg/hytopia-source.git";
/** host:port for ?join= (no scheme). */
const joinHost = process.env.PLAY_LOCAL_JOIN ?? "localhost:8080";
const clientPort = process.env.PLAY_LOCAL_CLIENT_PORT ?? "5174";
const certUrl = `https://${joinHost}/`;

function run(cmd, args, cwd, label) {
  const r = spawnSync(cmd, args, {
    cwd,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (r.status !== 0) {
    console.error(`${label} failed (exit ${r.status ?? "unknown"}).`);
    process.exit(r.status ?? 1);
  }
}

if (!existsSync(clientPkg)) {
  if (existsSync(repoDir)) {
    console.error(
      "hytopia-client exists but client/package.json is missing. Remove the broken folder and retry:\n" +
        `  rmdir /s /q hytopia-client   (Windows)\n` +
        `  rm -rf hytopia-client        (macOS/Linux)`
    );
    process.exit(1);
  }
  console.log("Cloning hytopiagg/hytopia-source into hytopia-client (shallow clone)...\n");
  run("git", ["clone", "--depth", "1", cloneUrl, "hytopia-client"], root, "git clone");
}

if (!existsSync(join(clientDir, "node_modules"))) {
  console.log("Installing client dependencies (first run only)...\n");
  run("npm", ["install"], clientDir, "npm install");
}

copyFileSync(
  join(root, "scripts", "play-local-vite.config.client.mjs"),
  join(clientDir, "play-local-vite.config.mjs")
);

run("node", [join(root, "scripts", "patch-hytopia-client-lethal.mjs")], root, "lethal input patch");

const openUrl = `http://127.0.0.1:${clientPort}/?join=${joinHost}`;

console.log("\n--- HYTOPIA local client ---");
console.log(`URL:  http://127.0.0.1:${clientPort}/?join=${joinHost}`);
console.log(`Game: run npm run dev in grave-shift (target server: ${joinHost}).`);
console.log(`Tip: Use the "Local:" line or this URL (both include ?join=): ${openUrl}`);
console.log(
  `\n*** HTTPS cert (once per browser): open ${certUrl}, accept the self-signed cert, see JSON, then use the client URL. See docs/LOCAL_CLIENT_PREVIEW.md.\n`
);

/** Full URL so the browser opens the right tab even if Vite's relative open misbehaves. */
const viteArgs = [
  "run",
  "dev",
  "--",
  "--host",
  "127.0.0.1",
  "--port",
  clientPort,
  "--strictPort",
  "--config",
  "play-local-vite.config.mjs",
];
if (!process.env.PLAY_LOCAL_NO_OPEN) {
  viteArgs.push("--open", openUrl);
}

const child = spawn(
  "npm",
  viteArgs,
  {
    cwd: clientDir,
    stdio: "inherit",
    shell: process.platform === "win32",
  }
);

child.on("error", (err) => {
  console.error(err);
  process.exit(1);
});
child.on("exit", (code) => process.exit(code ?? 0));
