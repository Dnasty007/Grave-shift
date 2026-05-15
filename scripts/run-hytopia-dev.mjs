/**
 * Run `hytopia start` with PORT set (default 8080). Use when 8080 is EADDRINUSE.
 * Usage: node scripts/run-hytopia-dev.mjs [port]
 */
import { spawnSync } from "node:child_process";

const port = process.argv[2] ?? process.env.PORT ?? "8080";
process.env.PORT = port;

const join = `localhost:${port}`;
const httpsUrl = `https://${join}/`;
const playLocalHint = `Set PLAY_LOCAL_JOIN=${join} when running npm run play-local (or use ?join=${join} in the client URL).`;

console.log(`
--- HYTOPIA dev server (PORT=${port}) ---
If startup crashes with EADDRINUSE, Hytopia never prints its green "play" line — use another port: npm run dev:8081
After you see "Server running on port ${port}":
  • Trust HTTPS:  ${httpsUrl}
  • Local client:  npm run play-local   (${playLocalHint})
  • Hosted play (when site is up only):  https://hytopia.com/play/?join=${join}
`);

const r = spawnSync("npx", ["hytopia", "start"], {
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

process.exit(r.status ?? 1);
