/**
 * Free default Hytopia + Vite dev ports (Windows-friendly).
 * Kills the owning process for LISTENING sockets on known dev ports.
 */
import { execSync } from "node:child_process";

const ports = [8080, 8081, 8082, 5174, 5175, 5176];
const pids = new Set();

for (const port of ports) {
  try {
    const out = execSync(`cmd /c netstat -ano ^| findstr ":${port} " ^| findstr LISTENING`, {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    for (const line of out.split(/\r?\n/)) {
      const m = line.trim().match(/(\d+)\s*$/);
      if (m) pids.add(Number(m[1]));
    }
  } catch {
    /* no listener */
  }
}

for (const pid of pids) {
  if (!pid || pid === 0) continue;
  try {
    execSync(`taskkill /F /PID ${pid}`, { stdio: "pipe" });
    console.log(`Stopped process ${pid}`);
  } catch {
    console.log(`Could not stop PID ${pid} (may require admin or already exited)`);
  }
}

console.log("\nPorts 8080–8082 and 5174–5176 should be free. Start fresh:  npm run dev   then   npm run play-local\n");
