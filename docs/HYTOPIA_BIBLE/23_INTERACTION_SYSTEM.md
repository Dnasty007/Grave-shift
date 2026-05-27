# Interaction System (Pack-a-Punch, Mystery Box, Doors, etc.)

## Philosophy
Interactions are one of the most important "feel" elements in Zombies-style games. They must feel responsive, have clear feedback, and be 100% server authoritative.

## Core Concepts

### Interactable
Anything the player can walk up to and activate:
- Pack-a-Punch machine
- Mystery Box
- Wall buys / doors
- Perk machines
- Special events

### Interaction Radius + Line of Sight
- Use a combination of distance check + raycast or capsule check.
- Do **not** rely only on client saying "I am looking at it".

### Purchase Flow (Server Authoritative)
1. Player sends interaction request (with current money)
2. Server validates:
   - Player is in range
   - Player has enough money
   - Machine is available / not on cooldown
3. Server deducts money
4. Server triggers the effect (weapon upgrade, spawn box, open door)
5. Server tells all relevant clients the result

## Recommended Architecture

Create an `InteractionManager` or `InteractionRegistry`.

Each interactable can be:
- A class that registers itself with the manager
- Has a `canInteract(player)` method
- Has an `execute(player)` method
- Emits clear UI events

## Pack-a-Punch Specifics

- Needs to know current weapon + tier
- Should support weapon model swap or material/effect upgrades
- Has a long activation time (classic Zombies feel)
- Can only be used when player has a weapon equipped

## Mystery Box Specifics

- Location can move (or have multiple possible locations)
- Has a long spin animation
- Needs to select from a weighted loot table
- Should support "Teddy Bear" reroll mechanic

## Wall Buys & Doors

- Often have a cost displayed in world (use SceneUI or simple model with text)
- Once purchased, the door/model should change state permanently or until next round

## UI Feedback

Every interaction should give immediate feedback:
- "Not enough money"
- "Weapon already upgraded"
- "Mystery Box moving..."

Use the existing payload system to push these messages.

## Current Project Status

As of late May 2026, interactions are still mostly planned but not implemented in the HYTOPIA version. The legacy PlayCanvas version had some of this logic that will need to be re-implemented cleanly in the new architecture.

This system should be one of the next major features after viewmodels and basic weapons are working.
