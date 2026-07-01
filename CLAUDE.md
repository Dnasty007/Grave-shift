# Grave Shift — Project Gehenna (CLAUDE.md)

Onboarding for any Claude/agent working on this game. Everything here is verified against the repo.

## What this is
A HYTOPIA SDK zombie-survival FPS ("Project Gehenna / Grave Shift"). TypeScript, server-authoritative game logic, HTML/JS client UI. Waves, guns, lethals, a boss (Ice Dragon), multiple maps, and an in-game dev/WorldEdit toolkit.

## Locations (all paths absolute)
- **Project root (open this in Cursor):** `C:\Users\Pennl\OneDrive\Documents\Playground\grave-shift`
- **GitHub remote:** `https://github.com/Dnasty007/Grave-shift.git` — branch `main`
- **SDK docs (offline):** `docs/HYTOPIA_BIBLE/` and `docs/HYTOPIA_BIBLE.md`
- **Official FPS reference (studied, don't edit):** `docs/official-zombies-fps/`
- **Big map source assets kept LOCAL ONLY (gitignored, >100MB):**
  - `assets/models/environment/Ice-Map/Ice_Map.glb` (~125MB)
  - `assets/models/environment/Draculas-Castle/Dracula.glb` (~80MB)
  These are NOT in git — see `.gitignore`. Don't try to commit them; GitHub rejects >100MB.

## Run it (from project root)
- `npm run dev` — start the game server (binds `https://localhost:8080`). First boot optimizes all models; the two big map GLBs add several minutes.
- `npm run play-local` — launch the local web client (Vite on `127.0.0.1:5174`); opens `http://127.0.0.1:5174/?join=localhost:8080`.
- `npm run stop` — free ports 8080–8082 / 5174–5176.
- `npm run check-server` — health-check the running server (expects `{"status":"OK"}`).
- `npm run check-assets` — verify every `modelUri` in TS resolves to a real file.
- `npx tsc --noEmit` — typecheck. NOTE: one pre-existing warning in `loadoutConfig.ts` about a `.ts` extension import is EXPECTED (that file is imported by a plain-node test); filter it with `| grep -v loadoutConfig`. Everything else must be clean.
- Tests: `node tests/mapConfig.test.ts`, `node tests/loadoutConfig.test.ts`, `node tests/draculaDoorsConfig.test.ts` (plain node, no runner).

## Architecture map
- `index.ts` — server entry. Spawns the player (`soldier-player.gltf` @ 0.5), wires `PlayerUIEvent.DATA` → Director, per-map sky/lighting (`applyGehennaSky`), routes UI messages (`startGame`, `devTool`, `devScroll`, `toggleFly`, `gehennaQuit`, etc.).
- `src/server/GehennaDirector.ts` — THE core. ~3.6k lines. Owns waves, zombies/dogs, boss, shooting, lethals, economy, maps, dev tools, fly mode, portals/doors. Most gameplay changes land here.
- `src/server/guns/` — gun system (faithful port of official zombies-fps `GunEntity`). `GunEntity.ts` base + one class per gun; `importedGunCatalog.ts` for Blockbench-imported guns; `index.ts` is the factory/registry.
- `src/server/lethals/LethalSystem.ts` — frag / sticky (N74 ST) / C4 / S-Mine physics + damage.
- `src/server/bosses/IceDragonBoss.ts` — Ice Dragon state machine (ported from a Minecraft MythicMobs kit); wide hit-box math for full-body damage.
- `src/server/devtools/` — in-game WorldEdit toolkit: `LayoutEditor.ts` (grab/move/scale/rotate/spawn/delete props) + `LayoutStore.ts` (persists transforms to `assets/dev-layout.json`).
- `src/server/mapConfig.ts` — all map ids, JSON paths, bounds, spawns, per-map flags. Single source of truth for maps.
- `src/server/loadoutConfig.ts`, `draculaDoorsConfig.ts`, `WeaponManager.ts`, `VFX.ts` — support modules.
- `assets/ui/index.html` — the ENTIRE client UI (menu, HUD, map-select, dev panel). One big file; server talks to it via `player.ui.sendData(...)` and receives `hytopia.sendData(...)`.

## Maps
6 maps, defined in `mapConfig.ts` (`GehennaMapId`): `industrial_yard` (default), `test_zone` (dev sandbox), `high_bastion`, `the_sprawl`, `draculas_castle`, `ice_map`.
- Voxel maps are `assets/*.json` (`{"x,y,z": blockTypeId}` + `blockTypes[]`). Water blocks use `isLiquid: true` (engine gives free swim physics).
- Dracula's Castle and Ice Map are **GLB models** spawned as TRIMESH entities (their `.json` is a near-empty spawn stub); the model is the terrain. Regenerate via `npm run setup-draculas-castle` / `npm run setup-ice-map`.
- Map images for the menu go in `assets/icons/maps/<id>.png` (fallback to gradient if missing — see that folder's README).

## In-game dev tools (Test Map / edit maps only)
Right-edge DEV panel in `assets/ui/index.html` + chat commands. Fly (V) = true noclip. Pickaxe breaks blocks; Builder places selected block types. Grab a prop → scroll resize, LMB place, RMB rotate. Layout persists to `assets/dev-layout.json`. Doors in the Test Map portal into other maps in edit mode.

## Conventions & gotchas
- **`Player` has NO `.position`** — position lives on `PlayerEntity`. Get it via `world.entityManager.getPlayerEntitiesByPlayer(player)[0]`. This is the #1 recurring bug source.
- `Entity extends RigidBody` — `setLinearVelocity`, `setPosition`, `setType`, `setModelScale`, etc. are directly on entities.
- Only `.gltf`/`.glb` load in-engine (not `.obj`/`.bbmodel`). Blockbench/Mineways exports must be converted (see the setup scripts).
- Blockbench GLBs with rest-pose scale-0 nodes CRASH Hytopia's optimizer — patch zeros to `1e-4` first (see the ice-dragon history).
- Player rig is the OFFICIAL `soldier-player.gltf` with **underscore** animation names (`idle_gun_both`, `shoot_gun_both`, `idle_lower`). Guns attach to `hand_right_anchor` at local `{0,0,-0.2}` + `Quaternion.fromEuler(-90,0,0)` — one universal transform, never hand-tune.
- **Verify before shipping:** `npx tsc --noEmit` clean (minus the loadoutConfig line) AND a real `npm run dev` boot that binds 8080. UI-only changes just need the boot.
- **Commit/push only what the user asks.** End commit messages with a Co-Authored-By line. Never commit the big map GLBs.

## Working alongside another agent (IMPORTANT)
The owner also runs Claude/Cursor in this same repo. To avoid clobbering each other:
- **`git pull` before you start and before you push.** Push small, focused commits often.
- Assume `GehennaDirector.ts`, `assets/ui/index.html`, and `mapConfig.ts` are hot files — check `git status`/`git log` first; if the working tree has uncommitted changes you didn't make, ask before overwriting.
- Never `git reset --hard`, force-push, or revert another agent's commits without the owner's OK.
- When you finish a unit of work, commit + push so the other side can pull it.

## Current state
`main` is healthy and boots. Recent work: menu map cards (images + horror quotes), the full in-game WorldEdit toolkit, true fly mode, the block builder. **Uncommitted in the working tree right now:** water/island terrain for Dracula's Castle — `scripts/add-dracula-water.mjs` (new) writes a water sea into `assets/draculas-castle-map.json` (already regenerated, ~353k blocks, water surface Y≈-59 since the castle floor sits far below the model origin). Don't discard these unless the owner says so.
