# Economy & Progression Systems (M$, Perks, Unlocks)

## Current Vision (from Project Identity)

- "M$" currency earned primarily through kills and performance
- Progression through Pack-a-Punch tiers, perks, and possibly permanent unlocks
- Classic Zombies loop: Survive → Earn → Upgrade → Survive longer

## Core Components Needed

### 1. Currency (M$)
- Earned on kills (base + multipliers for headshots, streaks, etc.)
- Spent on:
  - Wall buys
  - Pack-a-Punch
  - Mystery Box
  - Perks / upgrades
- Must be 100% server authoritative

### 2. Perk / Upgrade System
- Temporary (per run) vs Permanent (account progression)
- How are they applied? (stat modifiers, new abilities, visual changes)
- UI for purchasing and tracking active perks

### 3. Weapon Progression
- Pack-a-Punch tiers (damage, fire rate, special effects)
- Potential weapon-specific upgrades

### 4. Player Progression (if desired)
- Account-level unlocks, cosmetics, or starting advantages
- Requires persistence layer

## Recommended Architecture

Create a dedicated `EconomyManager` that:
- Tracks per-player money
- Handles all transactions
- Applies modifiers from perks/upgrades
- Can query "can player afford X?"

Keep the Director informed but not responsible for every transaction.

## Current Project Status

The vision exists (M$ system mentioned in multiple sections), but the actual implementation is still early in the HYTOPIA port.

This system will become critical once interactions (file 23) and weapon upgrades are being built.

## Design Questions That Need Answers

- What is the exact economy loop for Wave 1–30+?
- How strong should Pack-a-Punch feel at tier 5?
- Will there be a perk-a-cola style system?
- How much permanent progression vs pure run-based challenge?

Document decisions here as they are made.
