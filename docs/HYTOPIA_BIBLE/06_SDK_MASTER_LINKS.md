# Official SDK & Documentation Resources
* **Developer Portal**: https://dev.hytopia.com
* **API Reference**: https://dev.hytopia.com/api-reference
* **Physics Manual**: https://rapier.rs/docs/ (Essential for complex Dragon flight math).
* **CLI Help**: Always run `hytopia help` in the terminal for the latest 2026 command flags.
* **Play in browser (local dev)**: https://hytopia.com/play/?join=localhost:8080 — with `npm start` (or `hytopia start` from `hytopia-cathedral`) so port **8080** is listening. **Quick copy-paste block:** from repo root run `npm run hytopia:play-links` (or in `hytopia-cathedral`, `npm run play:links`) to print play URLs and Chrome settings in the terminal. **Leave that terminal running** until you stop the server; if you see a fresh `PS ...>` prompt and no live Hytopia logs, the server has exited—run `npm start` again. **Verify port 8080 (PowerShell)** — paste **only** this line (no extra words after it): `Test-NetConnection -ComputerName 127.0.0.1 -Port 8080` then read the **`TcpTestSucceeded`** line in the output; **`True`** means the server is accepting connections. (Typing `... and confirm ...` on the same line breaks the command.)
* **Chrome — “can’t connect to local server”** (Hytopia’s page is **HTTPS**; it must be allowed to reach **your** `localhost` / `127.0.0.1` on **8080**). If `Test-NetConnection` is **True** but the site still says it cannot connect, work through these in order:
  1. `chrome://settings/content/siteDetails?site=https://hytopia.com` → **Local network access** → **Allow** (not “Ask” if it keeps failing). Reload.
  2. While on `https://hytopia.com/play`, use the **lock / tune icon** → **Site settings** (or **Permissions**) → **Local network access** → **Allow**, then hard-reload (**Ctrl+Shift+R**).
  3. Try **`https://hytopia.com/play/?join=127.0.0.1:8080`** instead of `localhost` (same server; some setups behave differently).
  4. **Settings → Privacy and security → Third-party cookies** — temporarily allow or add an exception for `hytopia.com` if cookies/storage are strict.
  5. **Incognito** with extensions disabled, or a **new Chrome profile**, to rule out extensions.
  6. **`chrome://policy`** — if the browser is **managed**, an admin may block local network access; try **Edge** with the same play URL to confirm.
  7. Temporarily **disconnect VPN** / “ad blocker” apps that filter **loopback** traffic.
* **Brave** (same error): `brave://settings/content/siteDetails?site=https://hytopia.com` → Local network access **Allow**; Brave may also need per-site **localhost** / shields relaxed for `hytopia.com`.