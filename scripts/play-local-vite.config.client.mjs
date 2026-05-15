/**
 * Copied into hytopia-client/client/play-local-vite.config.mjs by play-local.mjs.
 * Paths are relative to that client directory.
 */
import { mergeConfig } from "vite";
import base from "./vite.config.js";

/** host:port for ?join= (no scheme); must match PLAY_LOCAL_JOIN in play-local.mjs */
const joinHost = process.env.PLAY_LOCAL_JOIN ?? "localhost:8080";

/** Re-print the full client URL after Vite’s own startup lines (easy to miss the pre-spawn logs). */
function playLocalUrlBanner() {
  return {
    name: "play-local-url-banner",
    configureServer(server) {
      const httpServer = server.httpServer;
      if (!httpServer) return;
      httpServer.once("listening", () => {
        const addr = httpServer.address();
        const port =
          typeof addr === "object" && addr && "port" in addr
            ? addr.port
            : server.config.server.port ?? 5174;
        let host = server.config.server.host;
        if (host === true || host === "0.0.0.0" || host === "::") host = "127.0.0.1";
        if (!host || host === false) host = "127.0.0.1";
        const url = `http://${host}:${port}/?join=${joinHost}`;
        console.log("\n--- Project Gehenna (local client) ---");
        console.log(`Open in browser:  ${url}`);
        console.log("(Vite’s “Local:” line omits ?join= — use the line above.)\n");
      });
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
  plugins: [playLocalJoinRedirect(), playLocalUrlBanner()],
});
