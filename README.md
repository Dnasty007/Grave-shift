# Project Gehenna

**Project Gehenna** is a **first-person survival shooter** built for the **[Hytopia](https://hytopia.com/)** platform—round-based pressure, hitscan combat, a score economy, Pack-a-Punch–style hooks, and a “one more wave” loop in our own setting (inspired by classic COD Zombies–style pacing).

## Built for Hytopia (NEO engine + official SDK)

This repository is a **Hytopia TypeScript game server**: server-authoritative logic, Hytopia **world / entities / players / UI** APIs, and the **`hytopia` CLI** for dev and packaging. We previously prototyped in **PlayCanvas + Vite**; that stack is **not** the active runtime anymore.

| Topic | Details |
|--------|---------|
| **Engine / runtime** | Hytopia **NEO** stack (official TypeScript SDK on npm as **`hytopia`**) |
| **Entry** | `index.ts` — server bootstrap, world load, player lifecycle, Gehenna director |
| **UI** | `assets/ui/index.html` — loaded with `player.ui.load(...)`; menu, HUD, death screen, settings |
| **World** | `assets/map.json`, `assets/blocks/`, models under `assets/models/` |
| **Legacy reference** | `legacy-playcanvas-client/` — old browser client only; not started by `npm run dev` |

Deeper migration notes, CLI quirks, and local browser client options: **[HYTOPIA_MIGRATION.md](./HYTOPIA_MIGRATION.md)**. Local open-source client preview: **`docs/LOCAL_CLIENT_PREVIEW.md`**.

## Quick start (Windows / PowerShell)

```powershell
cd grave-shift
npm install
npm run dev
```

Then open the play URL from the terminal (commonly **`https://hytopia.com/play/?join=localhost:8080`**, or your chosen port if you use `dev:8081` / `dev:8082`).

Optional: **`npm run play-local`** — clones the Hytopia web client into `hytopia-client/` (gitignored) and opens a local Vite URL pointed at your server.

## Useful scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Hytopia dev server (watch + run) |
| `npm run stop` | Stop local dev processes / free default ports |
| `npm run build` | `hytopia build` |
| `npm run play-local` | Local web client + join hint |

## Map and content

- Replace **`assets/map.json`** and **`assets/blocks/`** with exports from the **[Hytopia World Editor](https://build.hytopia.com/)**.
- Props and avatars use **`modelUri`** paths under **`assets/models/`** (see `index.ts` and server code for spawn rules). Example static props (e.g. teddy bears) and spawn lists are configured in server code where documented.

## Versioning

- **`package.json`** pins **`hytopia`** (see `dependencies`). Upgrade when you intentionally align with a new Hytopia release (`npm install hytopia@latest`, then test).

---

*Hytopia is a third-party platform; SDK and play URLs are subject to their docs and terms.*
