# Local Development & Debugging Master Guide

## Why This Exists
Hytopia local development has several sharp edges (HTTPS self-signed certs, local network permissions, port conflicts, client connection issues). File 06 already has excellent troubleshooting. This section expands it into a complete workflow.

## Standard Local Run Setup (Project Gehenna)

You need (at minimum) two terminals:

1. **Game Server**
   ```powershell
   cd grave-shift
   npm run dev
   # or
   npm run dev:8081
   ```

2. **Client** (when hytopia.com/play is down or for reliability)
   ```powershell
   npm run play-local
   ```

## Critical One-Time Setup (Chrome / Edge)

The server runs on HTTPS with a self-signed certificate. The client will refuse to connect until you explicitly trust it.

Steps:
1. With server running, open `https://localhost:8080/` (or your dev port) in the browser.
2. Click **Advanced** → **Proceed to localhost (unsafe)**.
3. You should see JSON status from the server.
4. Only then try the play URL.

## Common Connection Failures & Fixes

### "Can't connect to local server"
- Allow **Local network access** for `hytopia.com` in site settings.
- Try both `localhost` and `127.0.0.1` in the join parameter.
- Hard refresh (Ctrl + Shift + R).
- Try Incognito or a completely new Chrome profile.
- Temporarily disable any VPN, ad blocker, or security software that interferes with loopback.

### Port Already in Use
```powershell
# From grave-shift folder
npm run stop

# Nuclear option
Stop-Process -Id (Get-NetTCPConnection -LocalPort 8080).OwningProcess -Force
```

## Useful Scripts (Already in package.json)
- `npm run stop` — Clean up ports
- `npm run play-local` — Launches local Vite client + prints join URL
- `npm run check-server` — Quick health check of the game server
- `npm run dev:8081` / `dev:8082` — Use alternate ports when 8080 is problematic

## Debugging Best Practices

- Keep the server terminal visible at all times (watch for errors).
- Use `console.log` on the server — it shows up in the terminal running `hytopia start`.
- For client-side UI debugging, use browser DevTools on the play page.
- The project already has `debug-agent-de4214.log` being written in some places — use it.

## When Things Are Completely Broken
1. Run `npm run stop`
2. Close all related terminals in Cursor.
3. Restart Cursor (or at least the terminal panel).
4. Re-run `npm run dev`
5. Re-accept the HTTPS certificate in the browser.
6. Then launch `npm run play-local`.

## Recommended Daily Workflow
1. Always start with `npm run stop` if you had a previous session.
2. Start server in one terminal.
3. Verify with `npm run check-server`.
4. Accept/refresh cert in browser if needed.
5. Launch client with `npm run play-local`.
6. Only then start making code changes.

This ritual prevents 80% of "why isn't it working" pain.
