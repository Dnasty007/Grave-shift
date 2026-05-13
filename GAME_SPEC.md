# Project Gehenna — design spec

## Fantasy

Hold out inside a floodlit industrial yard while waves of reanimated workers
push in from the perimeter. The tone should feel tense, grounded, and arcadey,
but it must stay original in naming, layout, art direction, and progression.

## Current MVP scope

- One open yard map
- One zombie enemy type
- One default weapon
- Endless waves
- Score via points
- Desktop mouse/keyboard support
- Mobile touch support

## Rules

- Player starts with `100` health.
- Zombies chase the player and deal contact damage on cooldown.
- Player fires hitscan shots with a short delay between shots.
- Waves grow in size and zombie toughness over time.
- Killing zombies awards points.
- When health reaches `0`, the run ends and can be restarted instantly.

## Non-goals for this first foundation

- Multiplayer
- Inventory
- Complex map streaming
- Real character art
- Real weapon models
- Monetization
- Backend accounts

## Next systems to build

1. Ammo and reload
2. Multiple weapons
3. Buyable doors or zones
4. Perks and temporary power-ups
5. Better enemy variety
6. Audio and VFX pass
7. Capacitor iOS wrapper
