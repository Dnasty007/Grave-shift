# Grave Shift

`Grave Shift` is a browser-first zombie survival prototype built to be easy to
extend in Cursor. The current foundation is intentionally small but real:

- First-person movement for desktop and touch devices
- Wave-based zombie spawning
- Hitscan shooting
- Health, points, game over, and restart flow
- PlayCanvas + TypeScript structure that can grow into a larger project

## Why this stack

This project is set up for a `web first -> mobile wrapper later` workflow:

- `PlayCanvas` handles the 3D game runtime and performs well in browsers.
- `Vite` keeps the dev loop fast in Cursor.
- `TypeScript` gives us safer code as the project grows.

Once the core loop feels good, we can wrap this same game with `Capacitor` for
iOS packaging on a Mac with Xcode.

## Run it

From this folder:

```powershell
npm.cmd install
npm.cmd run dev
```

Then open the local URL Vite prints. This project uses a **dedicated dev port** so it does not fight other Vite apps on the machine:

- `http://localhost:5733`

### Custom map (OBJ / Mineways → GLB)

PlayCanvas loads **glTF binary (`.glb`)**, not `.obj`. Put `Map1test.obj`, `Map1test.mtl`, and the texture atlases Mineways emitted (`Map1test-RGB.png`, `Map1test-RGBA.png`, `Map1test-Alpha.png`, etc.) under `public/maps/`, then:

```powershell
npm.cmd run convert-map
```

That writes `public/maps/Map1test.glb`. Tweak **`MAP_CONFIG.importVisual`** in `src/game/config.ts`: `replacesArena: true` uses only the imported world (no old yard, doors, or wall buys), **`playerSpawn`** / **`spawnRing`**, **scale** (usually `1,1,1` when Mineways uses 1 m blocks), and **camera / fog**.

**Note:** Huge exports are slow to load. **Building geometry is still visual-only** (player and zombies do not collide with voxels yet), so you can walk through walls until we add mesh or proxy colliders.

If you want to test on your phone on the same Wi-Fi, Vite is already configured
with `host: true`, so you can use the LAN URL it prints.

## Project layout

```text
src/
  game/
    GameApp.ts
    Hud.ts
    InputManager.ts
    PlayerController.ts
    WaveDirector.ts
    Zombie.ts
    config.ts
    math.ts
  main.ts
  styles.css
```

## Good next steps

These are the best upgrades after the foundation is running:

1. Add one real weapon system with ammo and reload.
2. Add barricades, doors, or a second lane of the map.
3. Add a mystery-reward mechanic with original theming.
4. Add audio, hit feedback, and stronger death animation.
5. Wrap the game with Capacitor for iOS testing.

## Cursor workflow

Keep a running spec in [GAME_SPEC.md](./GAME_SPEC.md), then make changes in
small prompts like:

- `Add a sprint stamina bar that recharges when not sprinting.`
- `Create a second zombie type that rushes faster but has low health.`
- `Add an upgrade station that doubles fire rate for 30 seconds.`
- `Make the touch aiming feel less slippery on phones.`
