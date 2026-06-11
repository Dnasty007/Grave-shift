/**
 * HYTOPIA server entry (Project Gehenna — Neo / official SDK).
 * Legacy PlayCanvas + Vite client lives in `legacy-playcanvas-client/`.
 *
 * Docs: https://dev.hytopia.com/ · SDK: https://www.npmjs.com/package/hytopia (repo: hytopiagg/sdk)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  startServer,
  DefaultPlayerEntity,
  DefaultPlayerEntityController,
  PlayerEvent,
  PlayerUIEvent,
  WorldEvent,
  type Player,
  type World,
  type WorldMap
} from "hytopia";
import worldMap from "./assets/map.json";
import { GehennaDirector } from "./src/server/GehennaDirector";
import {
  DEFAULT_MAP_ID,
  MAP_SPAWN,
  normalizeMapId,
  type GehennaMapId
} from "./src/server/mapConfig";

/** Co-located with bundled `index.mjs` so writes work in Hytopia/local runs. */
const AGENT_DEBUG_LOG = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "debug-agent-de4214.log"
);

function agentDbgFile(entry: Record<string, unknown>): void {
  try {
    fs.mkdirSync(path.dirname(AGENT_DEBUG_LOG), { recursive: true });
    fs.appendFileSync(
      AGENT_DEBUG_LOG,
      JSON.stringify({ sessionId: "de4214", timestamp: Date.now(), ...entry }) + "\n"
    );
  } catch {
    void 0;
  }
}

/** World-space spawn for menu / pre-deploy (defaults to industrial yard). */
const PLAYER_SPAWN = MAP_SPAWN[DEFAULT_MAP_ID];

/**
 * Sky presets for `world.setSkyboxUri(...)`.
 *
 * The npm package `@hytopia.com/assets` only vendors `partly-cloudy`, but the
 * HYTOPIA client resolves `skyboxes/*` against the platform CDN at runtime —
 * official SDK samples (e.g. Frontiers) use `skyboxes/black` for night / void.
 */
const SKYBOX_DAY = "skyboxes/partly-cloudy";
const SKYBOX_NIGHT = "skyboxes/black";

/**
 * Per-map sky/lighting profiles.
 * - "industrial_yard": moody night look (main game)
 * - "test_zone": bright clear day for mechanics QA and visibility during testing
 * - "high_bastion": overcast daylight for castle exploration
 * - "the_sprawl": amber urban dusk for the mega city map
 */
function applyGehennaSky(world: World, mapId: GehennaMapId = DEFAULT_MAP_ID): void {
  if (mapId === "the_sprawl") {
    world.setSkyboxUri(SKYBOX_NIGHT);
    world.setSkyboxIntensity(0.55);
    world.setAmbientLightColor({ r: 48, g: 42, b: 52 });
    world.setAmbientLightIntensity(1.0);
    world.setDirectionalLightColor({ r: 255, g: 175, b: 95 });
    world.setDirectionalLightIntensity(0.52);
    world.setDirectionalLightPosition({ x: 60, y: 80, z: -50 });
    world.setFogColor({ r: 28, g: 22, b: 18 });
    world.setFogNear(60);
    world.setFogFar(220);
    return;
  }

  if (mapId === "high_bastion") {
    world.setSkyboxUri(SKYBOX_DAY);
    world.setSkyboxIntensity(0.82);
    world.setAmbientLightColor({ r: 195, g: 200, b: 215 });
    world.setAmbientLightIntensity(0.72);
    world.setDirectionalLightColor({ r: 240, g: 235, b: 220 });
    world.setDirectionalLightIntensity(0.95);
    world.setDirectionalLightPosition({ x: -30, y: 100, z: 45 });
    world.setFogColor({ r: 140, g: 148, b: 165 });
    world.setFogNear(90);
    world.setFogFar(280);
    return;
  }

  if (mapId === "test_zone") {
    // Bright, clear test sky — maximum visibility for debugging lethals, weapons, zombies etc.
    world.setSkyboxUri(SKYBOX_DAY);
    world.setSkyboxIntensity(1.0);
    world.setAmbientLightColor({ r: 255, g: 255, b: 255 });
    world.setAmbientLightIntensity(0.85);
    world.setDirectionalLightColor({ r: 255, g: 250, b: 240 });
    world.setDirectionalLightIntensity(1.1);
    world.setDirectionalLightPosition({ x: 40, y: 120, z: -30 });
    world.setFogColor(undefined); // No heavy fog on test map
    return;
  }

  // Default moody night profile for industrial_yard
  world.setSkyboxUri(SKYBOX_NIGHT);
  world.setSkyboxIntensity(0.42);
  world.setAmbientLightColor({ r: 32, g: 40, b: 64 });
  world.setAmbientLightIntensity(1.15);
  world.setDirectionalLightColor({ r: 140, g: 168, b: 255 });
  world.setDirectionalLightIntensity(0.38);
  world.setDirectionalLightPosition({ x: 55, y: 95, z: -40 });
  world.setFogColor({ r: 10, g: 12, b: 22 });
  world.setFogNear(70);
  world.setFogFar(240);
}

startServer((world) => {
  const gehennaDirector = new GehennaDirector();
  /** Stable handler per player so we can `off` + `on` after each `player.ui.load`. */
  const uiDataHandlers = new WeakMap<Player, (payload: { data: unknown }) => void>();

  function bindPlayerUiDataListener(player: Player): void {
    let handler = uiDataHandlers.get(player);
    if (!handler) {
      handler = (evt: unknown) => {
        const w = world;

        /** Hytopia docs use `{ playerUI, data }`, but some builds pass the inner payload only. */
        let payload: Record<string, unknown> | null = null;
        if (evt != null && typeof evt === "object" && !Array.isArray(evt)) {
          const o = evt as Record<string, unknown>;
          const inner = o.data;
          if (inner != null && typeof inner === "object" && !Array.isArray(inner)) {
            payload = inner as Record<string, unknown>;
          } else if (typeof o.type === "string" || typeof o.cmd === "string") {
            payload = o as Record<string, unknown>;
          }
        } else if (typeof evt === "string") {
          try {
            payload = JSON.parse(evt) as Record<string, unknown>;
          } catch {
            return;
          }
        }
        if (!payload) return;

        const tRaw = payload.type;
        const t =
          typeof tRaw === "string" ? tRaw : tRaw != null ? String(tRaw) : "";
        const cmdRaw = payload.cmd;
        const cmd =
          typeof cmdRaw === "string"
            ? cmdRaw
            : cmdRaw != null
              ? String(cmdRaw)
              : "";
        /** Prefer `{ type: "gehenna", cmd: "…" }` if platform treats bare `quitToMenu` oddly. */
        const action =
          t === "gehenna" && cmd ? cmd : t === "restartRun" || t === "quitToMenu" || t === "toggleFly" ? t : "";

        // #region agent log
        const dbgRestartOrQuit =
          action === "restartRun" ||
          action === "quitToMenu" ||
          t === "gehennaRestart" ||
          t === "gehennaQuit";
        if (dbgRestartOrQuit) {
          void fetch("http://127.0.0.1:7457/ingest/ed9b07e2-465a-482e-b5a8-7dd1854cf52a", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Debug-Session-Id": "de4214" },
            body: JSON.stringify({
              sessionId: "de4214",
              hypothesisId: "H2",
              location: "index.ts:PlayerUI.DATA",
              message: "parsed_restart_or_quit",
              data: { t, cmd, action, playerId: player.id },
              timestamp: Date.now()
            })
          }).catch(() => {});
          agentDbgFile({
            hypothesisId: "H2",
            location: "index.ts:PlayerUI.DATA",
            message: "parsed_restart_or_quit_file",
            data: { t, cmd, action, playerId: player.id }
          });
        }
        if (t && t !== "settings") {
          agentDbgFile({
            hypothesisId: "S0",
            message: "ui_data_in",
            data: { t, cmd, action, playerId: player.id, hasW: !!w }
          });
        }
        if (w && dbgRestartOrQuit) {
          w.chatManager.sendPlayerMessage(
            player,
            `[DBG] UI rx action=${action} t=${t}`,
            "8888FF"
          );
        }
        // #endregion

        if (!w) return;

        if (t === "startGame") {
          const mapId = normalizeMapId(payload.map);
          gehennaDirector.handleStartGame(w, player, payload.map, payload.loadout);
          applyGehennaSky(w, mapId); // Apply correct sky/lighting for the chosen map (especially test_zone)
          return;
        }
        // NOTE: "useLethal" / "gehennaUseLethal" UI messages are intentionally NOT handled here.
        // Lethal input is polled authoritatively via host.input.n (G key) in tickLethalInput.
        // Having both paths caused double-throws on every G press; server-side polling wins.
        if (t === "uiReady") {
          gehennaDirector.resyncScreenForUiMount(player);
          return;
        }
        if (t === "gamePause") {
          gehennaDirector.setGamePaused(w, player, payload.paused === true);
          return;
        }
        if (t === "toggleFly" || action === "toggleFly") {
          gehennaDirector.toggleFlyMode(w, player);
          return;
        }
        /* Single-field types (like uiReady) — some runtimes strip unknown sibling keys on UI packets. */
        if (t === "gehennaRestart") {
          const mapId = gehennaDirector.getCurrentMapId();
          gehennaDirector.restartRun(w, player);
          applyGehennaSky(w, mapId);
          return;
        }
        if (t === "gehennaQuit") {
          gehennaDirector.quitToMenu(w, player);
          return;
        }
        if (action === "quitToMenu") {
          gehennaDirector.quitToMenu(w, player);
          return;
        }
        if (action === "restartRun") {
          const mapId = gehennaDirector.getCurrentMapId();
          gehennaDirector.restartRun(w, player);
          applyGehennaSky(w, mapId);
          return;
        }
      };
      uiDataHandlers.set(player, handler);
    }
    player.ui.off(PlayerUIEvent.DATA, handler);
    player.ui.on(PlayerUIEvent.DATA, handler);
  }

  world.loadMap(worldMap as WorldMap);
  applyGehennaSky(world, DEFAULT_MAP_ID); // Start with main map profile
  gehennaDirector.attach(world);

  world.on(WorldEvent.STOP, () => {
    gehennaDirector.detach();
  });

  world.on(PlayerEvent.JOINED_WORLD, ({ player }) => {
    // HYTOPIA requires a player entity to exist immediately or it drops the
    // connection.  Spawn the DefaultPlayerEntity right away; the fullscreen
    // menu overlay hides the world until the player clicks DEPLOY.
    //
    // OFFICIAL zombies-fps player setup: soldier-player.gltf @ 0.5. This is THE
    // rig every official FPS value is tuned for — gun hand-anchor transform,
    // underscore animations (idle_gun_both etc), FP hidden nodes, camera offset.
    // Zombies are scaled to match player height (see GehennaDirector ZOMBIE_MODEL_SCALE).
    const playerEntity = new DefaultPlayerEntity({
      player,
      name: "Player",
      modelUri: "models/players/soldier-player.gltf",
      modelScale: 0.5,
    });
    playerEntity.spawn(world, PLAYER_SPAWN);
    player.camera.setAttachedToEntity(playerEntity);

    // Official controller flags for FPS gunplay:
    //  - autoCancelMouseLeftClick=false → full-auto fire works while LMB is held
    //  - applyDirectionalMovementRotations=false → model faces camera, not move dir
    const ctrl = playerEntity.controller as any;
    if (ctrl) {
      ctrl.autoCancelMouseLeftClick = false;
      ctrl.applyDirectionalMovementRotations = false;
      ctrl.idleLoopedAnimations = ["idle_lower"];
      ctrl.walkLoopedAnimations = ["walk_lower"];
      ctrl.runLoopedAnimations  = ["run_lower"];
    }

    // NOTE: the gun itself is equipped by GehennaDirector on DEPLOY — it's a
    // GunEntity child of the hand anchor (official zombies-fps pattern).

    // Load the client UI, then wire the client→server data channel.
    player.ui.load("ui/index.html");
    /* Menu needs a free cursor; see GehennaDirector.pushScreenToPlayer + InputManager click→pointerLock */
    player.ui.lockPointer(false);
    bindPlayerUiDataListener(player);

    // Show the main menu overlay (or HUD if reconnecting mid-session).
    gehennaDirector.handlePlayerJoined(world, player);

    world.chatManager.sendPlayerMessage(
      player,
      "Connected to Project Gehenna. Press DEPLOY to begin.",
      "00FF00"
    );
  });

  world.on(PlayerEvent.LEFT_WORLD, ({ player }) => {
    const h = uiDataHandlers.get(player);
    if (h) {
      player.ui.off(PlayerUIEvent.DATA, h);
      uiDataHandlers.delete(player);
    }
    gehennaDirector.handlePlayerLeft(world, player);
    world.entityManager.getPlayerEntitiesByPlayer(player).forEach((entity) => {
      entity.despawn();
    });
  });

  world.on(PlayerEvent.RECONNECTED_WORLD, ({ player }) => {
    player.ui.load("ui/index.html");
    player.ui.lockPointer(false);
    bindPlayerUiDataListener(player);
    gehennaDirector.handlePlayerJoined(world, player);

    // On reconnect during an active game, explicitly re-attach the weapon entity
    // to the player's hand anchor. Critical for the attached-entity weapon system.
    gehennaDirector.reattachWeaponForPlayer(player);
  });
});
