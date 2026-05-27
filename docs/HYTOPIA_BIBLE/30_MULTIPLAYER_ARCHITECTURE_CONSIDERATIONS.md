# Multiplayer Architecture Considerations

Even if Project Gehenna starts as a primarily single-player or small-coop experience, Hytopia NEO is fundamentally a multiplayer engine. Designing with this in mind from the start will save massive pain later.

## Core Truths

- Everything important must be validated on the server.
- The client is untrusted by default.
- State must be synchronized carefully to avoid cheating and desyncs.

## When to Replicate vs When to Simulate Locally

- Player positions and inputs → Server authoritative (with client prediction where possible)
- Cosmetic effects (muzzle flashes, minor particles) → Can often be client-side only
- Economy, health, wave progress → Must be server authoritative

## World vs Session Management

Hytopia allows multiple worlds (instances/rooms). Decide early:
- Will all players be in one shared world?
- Will you have private lobbies?
- How will matchmaking or party systems work (if at all)?

## Interest Management & Bandwidth

With large hordes, you cannot afford to send every zombie's position to every player every tick.

Techniques:
- Distance-based interest management
- Only replicate detailed state for enemies near players
- Use entity culling / occlusion

## Persistence Across Players

If you want persistent progress (money, unlocks, high scores), you must use the `PersistenceManager` properly and design around its limitations (it is not a full database).

## Current Project Gehenna Stance (2026)

The game is being built with strong server-authoritative principles from the beginning (see GehennaDirector). However, large-scale multiplayer features are not the immediate priority.

Document here any decisions about:
- Whether the game will support 4-player coop from the start
- How the Director will behave with multiple players
- Any planned anti-cheat or validation layers

This file should be updated whenever multiplayer scope decisions are made.
