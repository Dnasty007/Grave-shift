# Full Weapon System Architecture

## Philosophy
Weapons in Hytopia NEO are split across multiple concerns:
- Viewmodel (what the player sees in 1st person)
- World representation (what others see)
- Logic & State (damage, ammo, fire rate, upgrades)
- Effects (recoil, muzzle flash, sound, VFX)

A good weapon system separates these cleanly.

## Recommended Structure

### 1. Weapon Definition / Data
```ts
interface WeaponDefinition {
  id: string;
  name: string;
  damage: number;
  headshotMultiplier: number;
  fireIntervalMs: number;
  magSize: number;
  reserveAmmo: number;
  reloadDurationMs: number;
  viewModelPath: string;      // FP model
  worldModelPath?: string;    // 3rd person / dropped
  attachmentNodes: Record<string, string>; // e.g. { muzzle: "muzzle", grip: "hand_r" }
}
```

### 2. Per-Player Weapon State
Each player should have their own weapon instance:
- Current ammo
- Reserve
- IsReloading
- Current upgrades (for Pack-a-Punch tiers)
- Cooldown timer

### 3. WeaponManager (Enhanced)
Current version is too minimal. Needs to evolve into:

- Weapon registry
- Equip / Switch / Drop logic
- Firing authorization (server authority)
- Hit detection (raycast or projectile)
- Upgrade application (PaP tiers)
- Viewmodel + World model sync

### 4. Firing System
- Server must validate fire rate
- Use `world.simulation.raycast()` for hitscan weapons
- Support both hitscan (most weapons) and projectiles (special cases)
- Proper head/body hit detection using capsule + sphere casts (see current GehennaDirector constants for reference)

### 5. Recoil & Feel
This is mostly client-side but must be driven by server events:
- Fire event → Client applies recoil + muzzle flash
- The server should not simulate visual recoil

### 6. Pack-a-Punch & Upgrades
- Tiered damage multipliers
- Visual changes (model swap or material tint)
- Fire rate / magazine improvements
- Special effects on higher tiers

## Current Project Gaps (as of May 2026)

- No real weapon state machine
- No reload logic
- No weapon switching
- No upgrade system
- Viewmodel attachment is still basic

## Implementation Order Recommendation

1. Solidify viewmodel attachment + named nodes (current blocker)
2. Add per-player weapon state + firing
3. Add reload
4. Add weapon wheel / switching
5. Add Pack-a-Punch integration
6. Add recoil, sway, ADS on top

## File Organization Suggestion

```
src/server/weapons/
  WeaponDefinitions.ts
  WeaponInstance.ts
  WeaponManager.ts
  WeaponEffects.ts
  interactions/
    PackAPunchMachine.ts
```

This keeps weapons isolated and easy for multiple AIs to work on.
