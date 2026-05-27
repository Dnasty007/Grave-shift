# Entity & Component Patterns

## Why This Matters
Hytopia NEO is built on an Entity-Component model. Fighting against it (by putting everything in giant classes) leads to messy, hard-to-maintain code — especially with hordes and multiple systems.

## Recommended Mindset

### Prefer Composition Over Inheritance
Instead of `class SuperZombie extends Zombie`, think:
- `Zombie` entity + `HealthComponent` + `PathfindingComponent` + `AttackComponent` + `SpecialAbilityComponent`

### Keep Components Small and Focused
Good components do one thing well:
- HealthComponent
- DamageableComponent
- PathfindingComponent
- OwnershipComponent (who owns this weapon/pickup?)
- EconomyComponent (for the player)

### Use Entity Tags or Metadata
Hytopia entities support tags and custom data. Use them for fast filtering:
- `enemy`
- `zombie`
- `boss`
- `interactable`

## Common Patterns in Project Gehenna

### Enemies
Most zombies should be relatively dumb entities controlled by the HordeDirector rather than having full intelligence on every entity.

### Weapons & Pickups
These are usually short-lived entities that need:
- Lifetime / despawn logic
- Collision with players
- Ownership

### Player Entity
The player entity itself is relatively thin. Most "player state" (health, money, weapons, downs) should live in a `GehennaPlayerState` object owned by the Director, not directly on the Entity.

## Performance Tips

- Creating and destroying entities is relatively expensive. Pool when possible.
- Attaching too many components or complex colliders to hundreds of entities will hurt.
- Prefer querying with tags or spatial systems over iterating every entity every tick.

## When to Use Raw Entities vs Custom Classes

- Simple props / effects → Raw Entity is fine
- Anything with significant gameplay logic or state → Wrap it in a small manager class that owns the entity

This hybrid approach keeps the best of both worlds.
