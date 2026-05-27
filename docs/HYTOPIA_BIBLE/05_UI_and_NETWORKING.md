# UI and Multiplayer Sync
* **SceneUIs**: Built using standard HTML, CSS, and JavaScript located in `assets/ui/`.
* **HUD Integration**: Use `player.ui.load('ui/index.html')` to initialize.
* **M$ Syncing**: Update currency displays using `ui.setState({ points: player.points })`.
* **Networking**: Powered by WebTransport (QUIC). Ensure server-side logic handles the Dragon's "Volcano" projectile spawns to keep all players in sync.
