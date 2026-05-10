# Grave Shift

**Grave Shift** is a **browser-first, first-person survival shooter** we are
building in the spirit of **Call of Duty: World at War Zombies**—the slow push of
rounds, the pressure to keep moving and aiming clean, points for kills, and
that “one more wave” loop. We are **not** cloning maps or assets; we want the
**feel and readability** of that mode, then layer **our own setting and
gameplay twist**.

### What we are trying to capture (WaW DNA)

- **Round-based horde pressure**—waves escalate, spacing and headshots matter.
- **Simple, legible combat**—hitscan shooting, clear feedback, room to kite.
- **Score economy**—points for hits and kills; room for doors, buys, and
  upgrades as the project grows (arena mode already has wall buys and gates;
  open-world experiments use a spawn ring and pass-through map geometry).

### Our twist (direction)

- **Own art direction and spaces**—including **large exported “block” worlds**
  (e.g. Mineways → GLB) for a different kind of yard than the classic theater /
  bunker tileset, while we tune movement, spawns, and fog to match that pace.
- **Web-native workflow**—ship in the browser first, iterate fast in Cursor,
  then optional mobile wrap later.

### What’s in the repo today (foundation)

The codebase is **small but real**: first-person movement (desktop + touch),
wave spawning, multiple weapons with reload, health and game over, HUD, audio
and screen FX hooks, and a **PlayCanvas + TypeScript** layout that can grow
into the full WaW-style experience above.

## Why this stack

This project is set up for a **web first → mobile wrapper later** workflow:

- **PlayCanvas** runs the 3D game in the browser with solid performance.
- **Vite** keeps the dev loop fast in Cursor (fixed dev port **5733** so it
  doesn’t fight other apps).
- **TypeScript** keeps the growing systems safer to change.

Once the core loop feels right, we can wrap the same build with **Capacitor**
for iOS packaging on a Mac with Xcode.

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
    GameApp.ts        # run loop, waves, combat feedback, menus
    Map.ts            # procedural arena vs imported GLB, terrain snap
    PlayerController.ts
    WaveDirector.ts
    Zombie.ts
    Hud.ts
    InputManager.ts
    config.ts         # MAP_CONFIG / GAME_CONFIG tuning
    …
  main.ts
  styles.css
```

## Good next steps (toward the WaW-style loop)

Work that best serves the vision above:

1. **Tighter “yard” design**—risk/reward lanes in arena mode; open-world mode:
   collision + climbable cover so kiting uses the map, not just empty space.
2. **Economy depth**—more wall buys, door pricing curves, or an original
   perk-style station (theming stays ours).
3. **Enemy variety**—faster “runner” type, or armored head—same readability,
   different cadence.
4. **Presentation**—replace primitive zombie meshes with a single stylized GLB
   + simple animations when gameplay is locked.
5. **Capacitor**—when the web build is the source of truth, package for iOS.

## Cursor workflow

Keep a running spec in [GAME_SPEC.md](./GAME_SPEC.md), then make changes in
small prompts like:

- `Add a sprint stamina bar that recharges when not sprinting.`
- `Create a second zombie type that rushes faster but has low health.`
- `Add an upgrade station that doubles fire rate for 30 seconds.`
- `Make the touch aiming feel less slippery on phones.`
