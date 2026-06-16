# CoD World at War Zombies Implementation - Progress Report

## ✅ Completed Components

### 1. **Core Game Systems** (Implemented)
- **RoundTimer.ts** - CoD WaW round timing system
  - Round 1: 180 seconds
  - Each round: -5 seconds (minimum 40 seconds)
  - Intermission system between rounds
  - Properly formats time display

- **PerksSystem.ts** - Perk machine system
  - Quick Revive (500 pts) - Faster revive, 1x self-revive per round
  - Jugger-Nog (2500 pts) - 150 HP instead of 100
  - Speed Cola (3000 pts) - 20% faster movement, 50% faster reload
  - Double Points (1500 pts) - 2x points for 30 seconds
  - Per-player perk tracking and effects

- **BarricadeSystem.ts** - Window/barricade mechanics
  - Barricade repair for points (10 pts per hit)
  - Zombie damage to barricades
  - Barricade regeneration when not being hit
  - Health tracking and status

- **MeleeWeapon.ts** - Knife/melee system
  - Knife weapon with 0.7s cooldown
  - 130 damage
  - 130 points per kill (early game farming)
  - Attack cooldown tracking

### 2. **UI Components** (Implemented)
- **Round Timer HUD** - Displays countdown in real-time
  - Positioned top-left (below health)
  - Color changes to red when < 30 seconds
  - MM:SS format

- **Perks Display** - Shows purchased perks
  - Positioned bottom-right (above ammo)
  - Color-coded per perk type
  - Dynamic display based on player perks

- **Loading Screen Overlay** - Full-screen loading interface
  - Progress bar with animated fill
  - Loading tips rotation (CoD WaW style)
  - Map preview image display
  - Percentage display

### 3. **Game Integration** (Implemented)
- Systems initialized in `resetRunState()`
- Round timer updates in game tick (every frame)
- Data sent to UI with throttling:
  - Round Timer: 100ms throttle
  - Perks State: 500ms throttle
- Proper cleanup on run end

### 4. **Map Loading Config** (Implemented)
- Loading tips for all 6 maps (CoD WaW style)
- Map metadata structure ready for images
- Config files point to image paths

## ⏳ In Progress / Pending Components

### 1. **Map Images** - ACTION REQUIRED
The loading screen expects images at these paths:
```
assets/ui/map-images/industrial-yard-menu.jpg
assets/ui/map-images/industrial-yard-loading.jpg
assets/ui/map-images/test-zone-menu.jpg
assets/ui/map-images/test-zone-loading.jpg
assets/ui/map-images/high-bastion-menu.jpg
assets/ui/map-images/high-bastion-loading.jpg
assets/ui/map-images/sprawl-menu.jpg
assets/ui/map-images/sprawl-loading.jpg
assets/ui/map-images/draculas-castle-menu.jpg
assets/ui/map-images/draculas-castle-loading.jpg
assets/ui/map-images/ice-map-menu.jpg
assets/ui/map-images/ice-map-loading.jpg
```

**TODO:** Place map image files in `assets/ui/map-images/` folder

### 2. **Perk Machine Entities** - NOT STARTED
Need to:
1. Create perk machine entity models or use placeholder meshes
2. Define perk machine positions per map in `mapConfig.ts`
3. Spawn perk machines in `resetRunState()` 
4. Add F-interact detection in `tickInteract()` for perk purchases
5. Deduct points and grant perks on purchase

**Files to modify:**
- `src/server/mapConfig.ts` - Add PERK_MACHINE positions per map
- `src/server/GehennaDirector.ts` - Add perk machine entity spawning and interaction

### 3. **Barricade Entities** - NOT STARTED
Need to:
1. Create barricade/window entity models
2. Define barricade positions per map
3. Spawn barricades on map start
4. Integrate with zombie melee system (zombies damage barricades)
5. Add F-interact for repairs with point rewards

**Files to modify:**
- `src/server/mapConfig.ts` - Add BARRICADE positions per map
- `src/server/GehennaDirector.ts` - Add barricade spawning and interaction

### 4. **Melee Weapon Integration** - NOT STARTED
Need to:
1. Add melee attack input handling (probably secondary fire or key)
2. Raycast for melee hit detection
3. Apply damage to nearby zombies
4. Award points (130 pts knife kill)
5. Add melee weapon indicator to HUD (optional)

**Files to modify:**
- `src/server/GehennaDirector.ts` - Add melee attack tick and hit detection

### 5. **Round-Based System Transition** - PARTIAL
Current system still uses waves/intermission timer. Need to:
1. Transition to pure round-based timing
2. End round when time expires (not just when all zombies dead)
3. Update zombie spawn logic to match round duration
4. Adjust difficulty scaling per round

## 🎮 How to Test

### UI Display
1. Deploy into a map
2. Check top-left for round timer countdown
3. Check bottom-right for perks display (will be empty until purchases)
4. Loading screen will show when transitioning maps

### Loading Screen
1. Click "ENTER ZONE" to deploy
2. You should see the loading overlay with:
   - Map preview image
   - Loading tip
   - Progress bar

### Round Timer
- Timer should count down from 3:00 for round 1
- Each round decreases by 5 seconds
- Color changes to red when < 30 seconds

## 📋 Complete Task List for Full CoD WaW Implementation

- [ ] Add map preview images (12 total - 2 per map)
- [ ] Define perk machine positions per map
- [ ] Create/import perk machine models
- [ ] Spawn perk machines on map load
- [ ] Implement perk purchase interaction
- [ ] Define barricade positions per map  
- [ ] Create/import barricade models
- [ ] Spawn barricades on map load
- [ ] Implement barricade repair interaction
- [ ] Integrate zombie->barricade damage
- [ ] Add melee weapon input binding
- [ ] Implement melee attack raycast
- [ ] Add melee kill point rewards
- [ ] Transition from wave-based to pure round-based
- [ ] Update zombie difficulty per round (not per wave)
- [ ] Test all systems together
- [ ] Balance perk costs if needed
- [ ] Add sound effects for perk pickup
- [ ] Add animations for perk machines

## 📝 Notes for Next Steps

1. **Map Images:** You mentioned you have images for all 6 maps. Place them in the `assets/ui/map-images/` folder using the naming convention shown above.

2. **Perk Machines:** These should be stationary entities on each map where players can interact (F key) to purchase perks. Consider placing them in central or semi-accessible locations.

3. **Barricades:** Place these at map entrances/exits where zombies naturally path. They provide both tactical advantage and point farming.

4. **Melee Attacks:** Currently not wired to input. You may want to use right-click or a dedicated key. Consider knife animations.

5. **Economy:** Current point values are CoD WaW style:
   - Hit: 10 pts
   - Gun Kill: 100 pts
   - Headshot: 130 pts
   - Knife Kill: 130 pts

## File Structure

```
src/server/
├── perks/
│   └── PerksSystem.ts ✅
├── barricades/
│   └── BarricadeSystem.ts ✅
├── roundTimer/
│   └── RoundTimer.ts ✅
├── melee/
│   └── MeleeWeapon.ts ✅
├── mapLoader/
│   └── MapLoaderConfig.ts ✅
└── GehennaDirector.ts (updated) ✅

assets/
└── ui/
    ├── index.html (updated) ✅
    └── map-images/ ⏳ (add your images here)
```

---

**Status:** ~40% Complete  
**Last Updated:** 2026-06-16  
**Branch:** `claude/game-codebase-explorer-4bl7xe`
