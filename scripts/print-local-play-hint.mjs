/**
 * Print how to play locally (ignore hytopia.com when it is down / maintenance).
 * Run automatically before `npm run dev` via npm `predev` hook.
 */
const port = process.env.PORT ?? "8080";
/** Matches the dev server's TLS certificate (see check-game-server.mjs). */
const join = process.env.PLAY_LOCAL_JOIN ?? `local.hytopiahosting.com:${port}`;
const httpsUrl = `https://${join.split(":")[0]}:${port}/`;
const clientPort = process.env.PLAY_LOCAL_CLIENT_PORT ?? "5174";

console.log(`
--- LOCAL PLAY (Project Gehenna) ---
The Hytopia CLI may still print https://hytopia.com/play — ignore it if that site is on maintenance.

  1) After the server starts, trust HTTPS once:  ${httpsUrl}
  2) In a SECOND terminal (same folder):  npm run play-local
     (Opens the browser. Manual URL: http://127.0.0.1:${clientPort}/?join=${join})
  3) If ports are stuck from old runs:  npm run stop
---
`);
