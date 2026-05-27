# Performance & Horde Scaling

## The Reality Check
Project Gehenna aims for large waves (hundreds to 1000+ zombies). Most Hytopia games die here if they are not designed for scale from the beginning.

## Core Scaling Principles

### 1. Server Authority, Client Simplicity
- The server must remain the source of truth for positions, health, and state.
- Clients should do as little simulation as possible for enemies.

### 2. Avoid Per-Entity Ticks When Possible
`entity.on(EntityEvent.TICK)` is expensive at scale. Prefer:
- Batched updates in the Director or HordeDirector
- Spatial partitioning / interest management
- Only enable individual ticking on entities that truly need it (bosses, special enemies)

### 3. Object Pooling
- Never create and destroy hundreds of zombies per wave.
- Pre-spawn a large pool at the start of the game or per wave.
- Reuse entities instead of spawning new ones.

### 4. Spatial Awareness
- Use distance culling and occlusion.
- Only send detailed updates for enemies near players.
- For very distant enemies, you can simplify their simulation or even "fake" their existence until they get close.

## Horde Director Patterns

Recommended structure:
- `HordeDirector` owns the current wave state
- Maintains a list of active enemies (or uses a spatial structure)
- Decides spawn timing and locations
- Applies global modifiers (speed/health per wave)
- Coordinates special events (Dog waves, Boss waves)

## Known Expensive Operations

- Raycasting against hundreds of entities
- Complex pathfinding every frame for every zombie
- Playing many simultaneous animations
- Creating many ParticleEmitters

Mitigations:
- Limit simultaneous raycasts
- Use `PathfindingEntityController` wisely (it has cost)
- Batch VFX
- Use simple colliders

## Wave 30+ Planning

By late waves you will have:
- Very high entity count
- Players with high movement speed (from perks?)
- Heavy visual effects

You must design the Director to gracefully degrade or change behavior rather than try to simulate everything perfectly.

## Tools & Debugging

- Use the built-in telemetry when available
- Add custom performance counters in the Director (entities alive, avg tick time, etc.)
- Log warnings when entity count crosses thresholds

## Project Gehenna Specific Risks

- The current GehennaDirector already has quite a bit of per-zombie logic. This will need to be reviewed and optimized before large waves are fun.
- The Nine-Tailed Fox (108 segments) is expensive — it should be treated as a rare/hero unit, not something that appears often in hordes.

This section will need constant updates as we actually test large waves.
