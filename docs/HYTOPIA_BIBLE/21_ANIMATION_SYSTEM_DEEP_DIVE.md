# Animation System Deep Dive

## Hytopia Animation Fundamentals

Hytopia uses standard glTF animations. Control happens through `EntityModelAnimation`.

Key concepts:
- `EntityModelAnimationLoopMode` (LOOP, ONCE, PING_PONG, etc.)
- `EntityModelAnimationBlendMode`
- `EntityModelAnimationState` (playing, paused, stopped)
- Node overrides for partial animation or hiding

## Best Practices

### 1. Preload Animations
On entity creation, get references to the animations you will use:

```ts
const runAnim = entity.getModelAnimation('Run');
const attackAnim = entity.getModelAnimation('Attack');
```

### 2. Layered Animation (Advanced)
For complex characters (Nine-Tailed Fox, Dragon, etc.):
- Use multiple animation layers when possible
- Or drive specific bone/node groups manually using node transforms + sine/cosine for procedural elements (see current Nine Tails approach)

### 3. Viewmodel Animations
First-person weapons often need their own set of animations:
- Idle
- Fire
- Reload
- Draw / Holster
- Inspect

These should be authored in the FP model and triggered from the WeaponInstance.

### 4. Networked Animation
Never trust the client to play the "correct" animation for gameplay-relevant actions.
- Server decides when an enemy attacks, dies, or does a special move.
- Server tells clients via events or state replication.
- Client plays the corresponding animation.

## Common Patterns in Project Gehenna

### Zombies
- Walk / Run cycle
- Attack
- Death
- Special (Dog leap, etc.)

### Nine-Tailed Fox
Currently uses heavy procedural math (sine/cosine per segment). This is powerful but fragile. Consider mixing with baked animations for major actions.

### Player Viewmodel
Weapon fire, reload, and draw should be short, high-priority animations on the viewmodel that can interrupt lower priority ones.

### Boss (Dragon)
Will need:
- Flight cycles
- Attack animations
- Phase transition animations (Volcano)
- Death sequence

## Performance Considerations

- Limit simultaneous playing animations per entity when possible.
- For hordes, prefer simple looping cycles over complex state machines per zombie.
- Use `ONCE` animations for deaths and one-shots, then clean them up.

## Recommended Documentation to Maintain

For every important model, keep a section in this Bible listing:
- Animation clip names
- Loop mode recommendations
- Whether they are viewmodel-only or world
- Any special node requirements

This will save massive time when multiple AIs are working on the project.
