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
import { DEFAULT_MAP_ID, MAP_SPAWN } from "./src/server/mapConfig";

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
 *
 * Toggle {@link GEHENNA_SKY_PROFILE} between `"night"` and `"day"`.
 */
const SKYBOX_DAY = "skyboxes/partly-cloudy";
const SKYBOX_NIGHT = "skyboxes/black";

/** `"night"` = industrial-yard mood; `"day"` = previous partly-cloudy look */
const GEHENNA_SKY_PROFILE = "night" as const;

function applyGehennaSky(world: World): void {
  if (GEHENNA_SKY_PROFILE === "night") {
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
    return;
  }

  world.setSkyboxUri(SKYBOX_DAY);
  world.setSkyboxIntensity(1);
  world.setFogColor(undefined);
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
          t === "gehenna" && cmd ? cmd : t === "restartRun" || t === "quitToMenu" ? t : "";

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
          gehennaDirector.handleStartGame(w, player, payload.map);
          return;
        }
        if (t === "uiReady") {
          gehennaDirector.resyncScreenForUiMount(player);
          return;
        }
        /* Single-field types (like uiReady) — some runtimes strip unknown sibling keys on UI packets. */
        if (t === "gehennaRestart") {
          gehennaDirector.restartRun(w, player);
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
          gehennaDirector.restartRun(w, player);
          return;
        }
      };
      uiDataHandlers.set(player, handler);
    }
    player.ui.off(PlayerUIEvent.DATA, handler);
    player.ui.on(PlayerUIEvent.DATA, handler);
  }

  world.loadMap(worldMap as WorldMap);
  applyGehennaSky(world);
  gehennaDirector.attach(world);

  world.on(WorldEvent.STOP, () => {
    gehennaDirector.detach();
  });

  world.on(PlayerEvent.JOINED_WORLD, ({ player }) => {
    // HYTOPIA requires a player entity to exist immediately or it drops the
    // connection.  Spawn the DefaultPlayerEntity right away; the fullscreen
    // menu overlay hides the world until the player clicks DEPLOY.
    const playerEntity = new DefaultPlayerEntity({
      player,
      name: "Player"
    });
    playerEntity.spawn(world, PLAYER_SPAWN);

    // Wire full animations for the default player.gltf model.
    // Animation names use hyphens (idle-lower, walk-lower, etc.) — SDK soldier model uses underscores.
    // Lower-body only for idle/walk/run keeps the upper body free for future gun animations.
    const ctrl = playerEntity.controller as DefaultPlayerEntityController;
    ctrl.idleLoopedAnimations          = ["idle-lower"];
    ctrl.walkLoopedAnimations          = ["walk-lower"];
    ctrl.runLoopedAnimations           = ["run-lower"];
    ctrl.jumpOneshotAnimations         = ["jump-pre"];
    ctrl.jumpLandLightOneshotAnimations = ["jump-post-light"];
    ctrl.jumpLandHeavyOneshotAnimations = ["jump-post-heavy"];
    ctrl.interactOneshotAnimations     = [];

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
  });
});
