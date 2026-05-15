# Legacy PlayCanvas + Vite client (archived)

This directory holds the **previous** Project Gehenna stack:

- `src/` — PlayCanvas + TypeScript game
- `vite.config.ts`, `index.html` — Vite dev/build
- `public/` — static assets (maps, models, audio) used by the browser build

It is **not** wired to the HYTOPIA server in the repo root. Useful for porting gameplay ideas or recovering art paths.

**What still lives here (not in HYTOPIA `index.ts` yet):** `WaveDirector`, `Zombie`, `Weapon` / `WeaponWheel`, `PackAPunchMachine`, `MysteryBox`, `MenuController`, `AudioEngine`, `Hud`, doors / wall buys, boss, etc.—all orchestrated from `src/game/GameApp.ts`.

To run this stack again (standalone), you would need to restore `package.json` dependencies (`playcanvas`, `vite`, …) and point Vite at `legacy-playcanvas-client/` — not maintained as part of the HYTOPIA migration.
