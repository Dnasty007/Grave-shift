# Game Architecture & Director Patterns

## Core Principle
In Hytopia NEO, the **World** is the simulation authority. The "Director" pattern is the recommended way to orchestrate high-level game systems (waves, economy, interactions, boss phases) without turning your server entrypoint into a god object.

## Recommended Architecture for Project Gehenna

### 1. Entry Point (index.ts)
- Only responsible for:
  - Starting the server
  - Loading the map
  - Spawning the GehennaDirector
  - Setting up per-player UI and basic lifecycle
  - Sky, lighting, global world settings

### 2. GehennaDirector (The Brain)
This should be the single source of truth for the entire game session.

Responsibilities:
- Wave Director
- Economy (M$)
- Interaction Manager (PaP, Mystery Box, Doors)
- Boss Phase Controller (Dragon)
- Player State Manager (health, downs, revives, score)
- Game Flow (menu → deploy → active → run end)
- Spawning & Cleanup coordination

### 3. Supporting Managers (Recommended)
- `WaveDirector` or `HordeDirector`
- `WeaponManager` (per-player or global registry)
- `InteractionManager`
- `EconomyManager`
- `VFXManager`
- `AudioManager` (wraps world.audioManager with game context)

## Tick Strategy

Hytopia gives you `WorldLoopEvent.TICK`.

Best practices:
- Director should tick at a controlled rate (e.g. every 100ms for high-level logic).
- Heavy per-entity logic (zombies) should live on the entities themselves or in batched systems.
- Use `entity.on(EntityEvent.TICK)` very sparingly for hordes.

## State Management

Avoid scattering state. Recommended pattern:

```ts
class GehennaDirector {
  private players = new Map<Player, GehennaPlayerState>();
  private waveState: WaveState;
  private economy: EconomyState;
  private interactions: InteractionRegistry;

  tick() { ... }
  handlePlayerAction(player, data) { ... }
}
```

## Communication with UI

All UI updates should flow through a clean payload system:

```ts
type GehennaUiPayload =
  | { type: 'screen'; value: 'menu' | 'hud' | 'runEnd' }
  | { type: 'round'; value: number }
  | { type: 'gehennaHud'; ... }
  | { type: 'runEnd'; ... }
```

Never mutate UI state from random places.

## When to Split Systems

Create a new manager when:
- The logic is complex and self-contained
- It needs its own tick rate
- Multiple other systems need to talk to it cleanly

Examples of good splits:
- WeaponManager (already exists)
- InteractionManager (needed)
- BossPhaseController (when Dragon is implemented)

## Anti-Patterns to Avoid

- Putting all wave + economy + interaction logic directly in `index.ts`
- Giving every zombie direct references to the Director
- Using global singletons without a clear ownership model
- Mixing client prediction assumptions into server logic

## Project Gehenna Target State

Long-term ideal:
- `GehennaDirector` owns high-level flow
- `HordeDirector` owns spawning, AI coordination, and wave difficulty
- `InteractionRegistry` owns all buyable/interactable objects
- `EconomyManager` owns M$ and scoring
- Clean event bus or direct method calls between them

This structure will make it much easier for AIs (and humans) to work on individual systems without breaking everything.
