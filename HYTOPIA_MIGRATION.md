# HYTOPIA Neo / official SDK migration

This folder is now a **HYTOPIA TypeScript game server** (server-authoritative multiplayer). The previous **PlayCanvas + Vite** browser client was moved to `legacy-playcanvas-client/` for reference only; it is **not** started by `npm run dev` anymore.

## Package name vs GitHub

- **npm:** [`hytopia`](https://www.npmjs.com/package/hytopia) — this is the official SDK published from **[hytopiagg/sdk](https://github.com/hytopiagg/sdk)** on GitHub.
- There is **no separate `@hytopiagg/sdk` install** on npm today; depend on `hytopia` (same codebase the docs call the HYTOPIA SDK).

## CLI (ships inside `hytopia`)

After `npm install`, the CLI is available as:

- `npx hytopia <command>` (recommended), or  
- `npm exec hytopia -- <command>`

Global install (optional):

```powershell
npm install -g hytopia@latest
```

Then use `hytopia start` from any shell.

## Exact commands (Windows PowerShell)

From **this directory** (`grave-shift`):

> **If `npm install` fails with `ENOSPC`:** free disk space on the drive (npm cache + `node_modules` can be several GB), then retry.

```powershell
# 1) Clean old PlayCanvas/Vite deps and install HYTOPIA SDK + TypeScript
Remove-Item -Recurse -Force node_modules -ErrorAction SilentlyContinue
Remove-Item -Force package-lock.json -ErrorAction SilentlyContinue
npm install

# 2) (Optional) Shared block/audio pack used by many official examples
npm install --save-optional @hytopia.com/assets@latest

# 3) One-shot build + run (no file watch)
npm run run

# 4) Development: rebuild on save + run (nodemon + bun build, per Hytopia CLI)
npm run dev
# If port 8080 is already in use (EADDRINUSE), use another port, e.g.:
npm run dev:8081
# Then use the same port in the browser client: PLAY_LOCAL_JOIN=localhost:8081 npm run play-local
# same as: npm run start (start still runs hytopia start without the pre-banner)
```

Play in the browser (from Hytopia CLI help / init success text):

- Open: `https://hytopia.com/play/?join=localhost:8080`  
  (If your dev server uses another port, check the terminal line that says the server is listening.)

### When hytopia.com/play is unavailable

The **`hytopia` CLI does not bundle a second “local 3D client” process** and has **no documented offline / preview-client command**; `hytopia start` only runs the **game server**.

If the hosted play page is down, run the **open-source web client** from **[hytopiagg/hytopia-source](https://github.com/hytopiagg/hytopia-source)** (`client/`) and connect with `?join=localhost:8080` (or your `PORT`). Step-by-step notes, HTTPS health-check behavior, and version alignment are in **`docs/LOCAL_CLIENT_PREVIEW.md`**.

**One-command local client (recommended):** from `grave-shift`, run `npm run play-local` (or double‑click **`play-local.bat`**). The first run shallow‑clones the repo into **`hytopia-client/`** (gitignored), installs `client` dependencies, then starts Vite on **`http://127.0.0.1:5174`** and tries to open **`http://127.0.0.1:5174/?join=localhost:8080`** so you skip the “connect to server” dialog. If you still see that dialog, type **`localhost:8080`** and confirm your game server is running (`npm run dev`). Set **`PLAY_LOCAL_NO_OPEN=1`** to skip auto-opening the browser.

The game server uses **HTTPS with a self-signed certificate** on your dev port. You must open **`https://localhost:8080/`** once in the browser and accept the cert before the web client’s health check can succeed — see **`docs/LOCAL_CLIENT_PREVIEW.md`** (“If nothing works”). Use **`npm run check-server`** (with `npm run dev` running) to verify the server responds.

## Project layout

| Path | Purpose |
|------|--------|
| `index.ts` | Server entry — `startServer`, `world.loadMap`, player join/leave, teddy `Entity` spawns |
| `assets/map.json` | Standard HYTOPIA `map.json` (export from [World Editor](https://build.hytopia.com/)) |
| `assets/blocks/` | Block textures referenced by `textureUri` in `map.json` |
| `assets/models/teddy_bear.glb` | Static teddy props (`models/teddy_bear.glb`) |
| `assets/models/players/player.gltf` | Default HYTOPIA humanoid avatar (from `@hytopia.com/assets`; required for `DefaultPlayerEntity`) |
| `assets/skyboxes/partly-cloudy/*.png` | Full cubemap (six faces) so the client does not show missing-sky magenta |
| `assets/ui/index.html` | Player UI loaded via `player.ui.load('ui/index.html')` |

## Updating the SDK later

```powershell
npm run upgrade-project
# or pin: npm install hytopia@0.15.2 --save-exact
```

## Where is the “rest” of the game? (weapons, waves, PaP, zombies, menus, SFX)

The **HYTOPIA** project in the repo root is only a **server bootstrap** right now: `index.ts` loads `assets/map.json`, sets the skybox, spawns the teddy props, spawns a default player, and loads a small HTML UI (`assets/ui/index.html`). **None** of the Zombies-mode systems were reimplemented on the HYTOPIA stack yet.

The **full** Project Gehenna experience you remember (wave director, zombies, wall buys, Pack-a-Punch, mystery box, weapon wheel, menus, `AudioEngine`, `Hud`, `MenuController`, dragon boss, etc.) still lives in **`legacy-playcanvas-client/`** as a **PlayCanvas + Vite browser game**. That code was written for **single-player / client-side** simulation (`GameApp.ts` wires `WaveDirector`, `Zombie`, `PackAPunchMachine`, `Weapon`, …). It is **not connected** to `hytopia start` and was **not auto-migrated** when we switched engines.

**Why it is not “just turned on”:** HYTOPIA is **server-authoritative** multiplayer. Anything that affects world state (enemies, rounds, purchases, damage) has to be rebuilt as **server logic** (entities, physics, events) with the **official client** only rendering what the server sends. You cannot drop the old PlayCanvas `GameApp` into HYTOPIA unchanged.

**Practical paths:**

1. **Play the legacy build again (standalone)** — restore a `package.json` + deps under `legacy-playcanvas-client/` and run Vite there (see `README-LEGACY.md`). That gets the old full loop back in the browser **without** HYTOPIA.
2. **Port to HYTOPIA for real** — phased rewrite: e.g. round counter + zombie `Entity` spawns + basic hit detection, then weapons, then interactables (PaP, doors), then audio/UI. Large effort; we do it in milestones.

If you say which path you want first (**restore legacy runnable** vs **start HYTOPIA port milestone 1**), we can implement that next.

## Legacy PlayCanvas
