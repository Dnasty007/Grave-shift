# Local client preview (when hytopia.com/play is unavailable)

This project runs a **HYTOPIA game server** with `npm run dev` (`hytopia start`). The **3D browser client** that connects to that server is **not** shipped inside the `hytopia` npm package as a separate terminal app you can launch with one command.

When the hosted play page is down, use the **open-source web client** from the HYTOPIA monorepo and point it at your local server.

## How many terminals? (two)

You only need **two** terminal sessions for local play:

| # | Command | Role |
|---|---------|------|
| **1** | `npm run dev` | Game server (`hytopia start`) — keep this running |
| **2** | `npm run play-local` | Browser client (Vite) — keep this running |

**Do not** start `npm run dev` or `npm run play-local` more than once each; extra runs fight for the same ports and you end up with many terminal tabs.

**Clean slate:** run **`npm run stop`** in `grave-shift` (frees ports **8080–8082** and **5174–5176**), **Ctrl+C** any stragglers, then close extra terminal tabs. After that, use only the two terminals below.

**Stopping:** In each terminal, press **Ctrl+C** to stop that server. Then you can close the terminal tab (**trash icon** on the panel in Cursor). The IDE does not auto-close tabs when a process exits.

**Cleaning up stray servers:** If ports stay busy after Ctrl+C, run **`npm run stop`** again, or restart Cursor once.

## If nothing works (read this first)

Three separate things must succeed: **(1) game server HTTPS**, **(2) browser trusts that HTTPS**, **(3) Vite client**.

### 1) Confirm the game server (terminal)

From **`grave-shift`**:

```powershell
npm run dev
```

Wait until you see **`WebServer.start(): Server running on port …`** (default **8080**). In another terminal:

```powershell
npm run check-server
```

You should see **`HTTP 200`** and JSON like `{"status":"OK","version":"0.15.2",…}`. If this fails, fix the server / port (`PORT` env) before touching the browser.

### 2) Trust the dev HTTPS certificate (browser — required)

The SDK serves **`https://localhost:8080/`** with a **self-signed** certificate. The web client probes that URL before it connects. If the browser has never trusted it, **`fetch` fails** and the client loops on “could not connect” / connection dialogs.

**Do this once per browser profile:**

1. With **`npm run dev`** still running, open a new tab to **`https://localhost:8080/`**  
2. Chromium will warn about the certificate — use **Advanced** → **Proceed to localhost (unsafe)** (wording varies).  
3. You should see **JSON** (`status`, `version`, `playerCount`).  
4. **Use `localhost` in `?join=`, not `127.0.0.1`**, so the hostname matches what you just trusted.

Then use the client URL: **`http://127.0.0.1:5174/?join=localhost:8080`** (or whatever port `play-local` uses).

**Brave / strict browsers:** temporarily lower Shields for **`localhost`** / **`127.0.0.1`** if connections still fail after trusting the cert.

### 3) Local network access (Chromium)

If the client is on **`127.0.0.1:5174`** and the game on **`localhost:8080`**, some builds still treat that as a local-network request. If prompted, allow **local network access** for the client origin. If it still fails, try **Google Chrome** for a clean test.

### 4) Order of operations

1. **`npm run dev`** (grave-shift) — wait for “Server running on port …”  
2. Visit **`https://localhost:8080/`** — accept cert — confirm JSON  
3. **`npm run play-local`** — open **`http://127.0.0.1:5174/?join=localhost:8080`**

## Quick answers

### 1) Standalone client from the SDK / a single CLI command?

**No.** The `hytopia` CLI exposes `start`, `run`, `build`, `package`, etc. It starts the **Node game server**, not a bundled desktop or second-process “local player client.” `npx hytopia --help` does not list an offline or embedded-client mode.

### 2) A minimal `index.html` that uses “Hytopia Client SDK” for `localhost:8080`?

**Not in a practical sense.** The real client is a full **Vite + TypeScript** application (Three.js, networking, UI). The npm scope `@hytopia.com/lib` is a separate library (APIs, auth, marketplace-related pieces in its published tree), not a drop-in “connect to my server and render the world” script you paste into one HTML file.

The supported approach is: **run the official open-source client app** (below), not a hand-rolled static page.

### 3) Offline mode via Hytopia CLI?

**No documented command.** The CLI has no `offline` / `preview-client` subcommand; it only runs the server side of the stack.

---

## Recommended workflow: open-source client + local server

### Automated (this repo)

From **`grave-shift`**:

```powershell
npm run play-local
```

Or double‑click **`play-local.bat`**. First run: shallow `git clone` into **`hytopia-client/`** (ignored by git), **`npm install`** inside **`hytopia-client/client`**, then Vite on **`127.0.0.1:5174`**. Your browser should open **`http://127.0.0.1:5174/?join=localhost:8080`** automatically (set `PLAY_LOCAL_NO_OPEN=1` to disable). If you land on the bare **`5174`** URL or see a connection dialog, see the section below.

Run **`npm run dev`** in a second terminal for the **game server** (port **8080** by default).

### If you see “Connect to a HYTOPIA server…”

That appears when the address bar is **`http://127.0.0.1:5174`** with **no** `?join=` query string.

- **Easiest:** use the full URL **`http://127.0.0.1:5174/?join=localhost:8080`** (bookmark it).  
- **Or in the dialog:** type **`localhost:8080`** (no `https://`) and click OK — that is your `hytopia start` / `npm run dev` server in **grave-shift**.

Leaving the field blank is **not** the same as `localhost:8080`; the client falls back to other defaults that may not reach your machine.

---

### Manual (upstream repo)

The browser client lives in **[hytopiagg/hytopia-source](https://github.com/hytopiagg/hytopia-source)** under **`client/`**. Its startup flow reads the `join` query parameter and probes your server over **HTTPS** before connecting.

Reference (upstream): `client/src/network/Servers.ts` — behavior summarized here:

- **`?join=HOST:PORT`** — hostname (and optional port) of your HYTOPIA server. Example: `join=localhost:8080`.
- If `join` is missing, the client **prompts** for a hostname; leaving it blank defaults to **`local.hytopiahosting.com:8080`**, with a fallback attempt to **`localhost:8080`** for local dev.
- The client validates the server with **`fetch('https://' + host)`** (HTTPS, not plain HTTP). Your **`hytopia start`** dev server is expected to answer that health check on the loopback interface.

### Steps (two terminals)

**Terminal A — game server (this repo)**

```powershell
cd path\to\grave-shift
npm install   # if needed
npm run dev
```

Leave it running. Confirm the port in the log line (default is often **8080**; override with `PORT` if your environment sets it).

**Terminal B — open-source client**

```powershell
git clone https://github.com/hytopiagg/hytopia-source.git
cd hytopia-source\client
npm install
# Prefer explicit IPv4 + a free port (avoids clashes with other tools on 5173)
npm run dev -- --host 127.0.0.1 --port 5174
```

Then open a Chromium-based browser using **the exact URL Vite prints** (host + port). With the command above:

```text
http://127.0.0.1:5174/?join=localhost:8080
```

If you omit `--host` / `--port`, Vite’s default is often port **5173**; use whatever appears in the terminal. Keep the `join` value aligned with your game server’s **HTTPS** listen address and port (usually `localhost:8080` for `hytopia start`).

### Troubleshooting: “404” or “page not found” on port 5173

**Restarting `hytopia start` (port 8080) does not fix the browser client URL.** The client is a **separate** dev server (Vite). If you never ran `npm run dev` inside **`hytopia-source/client`**, nothing valid is serving that URL—or **another program** may already be using **5173** (on Windows, sometimes only on IPv6 `::1`), which can produce confusing **404** responses when the browser hits the wrong process.

1. Confirm the Hytopia **client** terminal shows Vite ready (look for `Local:` / `Network:` lines).
2. On Windows, check what is listening: `netstat -ano | findstr ":5173"`.
3. If 5173 is busy or wrong, pick another port and bind IPv4 explicitly, for example:  
   `npm run dev -- --host 127.0.0.1 --port 5174`  
   Then use **`http://127.0.0.1:5174/`** in the address bar (not only the hostname `localhost`, if your machine resolves `localhost` differently from where Vite is listening).

### Browser and “local network” / loopback

Upstream messaging in `Servers.ts` assumes many users load the client from **hytopia.com** and then connect to **localhost**; Chromium may require **local network access** permission for that cross-site case. When you self-host the client on **`http://localhost:5173`**, you are on the same machine as the server; if the health check fails, try Chrome / Edge / Brave, confirm nothing else is bound to the server port, and check the browser’s site permissions for **localhost** if prompted.

### SDK version alignment

The open-source client includes a **minimum server version** check and may redirect very old servers to a **compat** play host. Your project uses **`hytopia` ^0.15.x**; keep the **client** repo reasonably current (pull `main` / latest release) so protocol and version gates stay in sync.

---

## World Editor vs “Direct Connect”

The **World Editor** is for building **maps/assets** that export into `assets/map.json` (and related files). It is **not** a general-purpose substitute for the **play client** that speaks the live game protocol to `hytopia start`. For playtesting while the website is down, use the **open-source `client/`** flow above.

---

## If compat / fallback hosts are also unreachable

The client may redirect to alternate **play** subdomains for older protocol versions (`Servers.ts` / `CLIENT_COMPAT_VERSIONS` in the same repo). If those hosts are offline too, your only path is a **local build of the matching client revision** that does not redirect away—still the same `hytopia-source` project, pinned to a commit that matches your server SDK.
