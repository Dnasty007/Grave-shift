/**
 * Copied into hytopia-client/client/play-local-vite.config.mjs by play-local.mjs.
 * Paths are relative to that client directory.
 */
import { mergeConfig } from "vite";
import base from "./vite.config.js";

/** host:port for ?join= (no scheme); must match PLAY_LOCAL_JOIN in play-local.mjs */
const joinHost = process.env.PLAY_LOCAL_JOIN ?? "localhost:8080";

function playLocalClientUrl(server) {
  const addr = server.httpServer?.address();
  const port =
    typeof addr === "object" && addr && "port" in addr
      ? addr.port
      : server.config.server.port ?? 5174;
  let host = server.config.server.host;
  if (host === true || host === "0.0.0.0" || host === "::") host = "127.0.0.1";
  if (!host || host === false) host = "127.0.0.1";
  return `http://${host}:${port}/?join=${joinHost}`;
}

/** Replace Vite's bare Local URL so terminal links include ?join=. */
function playLocalJoinPrintUrls() {
  return {
    name: "play-local-join-print-urls",
    configureServer(server) {
      server.printUrls = () => {
        const url = playLocalClientUrl(server);
        server.config.logger.info(`  ➜  Local:   ${url}`);
        console.log("\n--- Project Gehenna (local client) ---");
        console.log(`Open in browser:  ${url}\n`);
      };
    },
  };
}

function playLocalJoinRedirect() {
  return {
    name: "play-local-join-redirect",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.method !== "GET" && req.method !== "HEAD") return next();
        const raw = req.url ?? "";
        if (raw.startsWith("/@") || raw.startsWith("/node_modules")) return next();
        let pathname;
        let search;
        try {
          const u = new URL(raw, "http://vite.local");
          pathname = u.pathname;
          search = u.search;
        } catch {
          return next();
        }
        if (pathname !== "/" && pathname !== "/index.html") return next();
        if (search.includes("join=")) return next();
        const loc = `${pathname}?join=${encodeURIComponent(joinHost)}`;
        res.writeHead(302, { Location: loc });
        res.end();
      });
    },
  };
}

export default mergeConfig(base, {
  plugins: [playLocalJoinRedirect(), playLocalJoinPrintUrls()],
});
