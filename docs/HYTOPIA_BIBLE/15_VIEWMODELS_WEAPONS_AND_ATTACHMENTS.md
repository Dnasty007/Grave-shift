# Viewmodels, Weapons & Attachment System (Critical)

## Core Philosophy
In Hytopia NEO, first-person weapons are handled almost entirely through the **PlayerCamera viewmodel system**, not traditional world-space parenting like older engines. The goal is perfect hand placement without visual clipping or floating.

## Current Recommended Pattern (2026)

### 1. Dedicated First-Person Viewmodel Model
- Always create/use a separate **FP-only model** (e.g. `player-fp.gltf` or `ak47-fp.glb`).
- This model should contain only the visible weapon + hands/arms that the controlling player sees.
- Hide as much of the default player body as possible using `setViewModelHiddenNodes`.

### 2. Weapon Attachment via ViewModel
```ts
player.camera.setViewModel('assets/models/weapons/ak47-fp.glb');
player.camera.setViewModelPitchesWithCamera(true);
player.camera.setViewModelYawsWithCamera(true);
player.camera.setViewModelHiddenNodes([
  'head', 'neck', 'torso', 'arm-', 'hand-', 'leg-', 'foot-'
]);
```

### 3. Named Nodes Are Mandatory
- Every weapon model that needs precise hand placement **must** be exported with named nodes (use `ak47-named-nodes.glb` style).
- Document every important node name (e.g. `grip_r`, `hand_attach`, `muzzle`).
- Use `player.camera.setViewModelNodeTransform(...)` or Entity node overrides for fine positioning.

## Common Problems & Solutions

### Problem: Gun floats away from hands / wrong rotation
**Cause**: Missing or incorrect viewmodel offsets + no dedicated FP rig.
**Fix**:
- Create a proper FP version of the weapon with correct hand grip pose baked in.
- Use `player.camera.setOffset({ x, y, z })` to shift the camera.
- Use `player.camera.setForwardOffset(0.3)` for natural positioning.
- For extreme precision, use node transforms on the viewmodel.

### Problem: Weapon clips through hands or body
**Cause**: Wrong nodes being hidden or the FP model not being authored for first-person.
**Fix**: Maintain a strict `FP_VIEW_HIDDEN_NODES` list that evolves per weapon. Test in first person constantly.

## Recommended File Naming Convention
- `weaponname-fp.glb` — First person viewmodel (what the player sees in hands)
- `weaponname-world.glb` — Third person / dropped version
- `weaponname-named-nodes.glb` — Version with explicit attachment points documented

## Next Level (Advanced)
- Custom `WeaponViewmodel` class that manages:
  - ADS (Aim Down Sights) transforms
  - Recoil animation (procedural or bone-driven)
  - Bob / sway
  - Reload animations on the viewmodel
  - Muzzle flash attached to named `muzzle` node

## Current Project Status (Project Gehenna)
As of May 2026, the `WeaponManager.ts` is still using a very basic `setViewModel` implementation. The real hand-attachment math and dedicated FP weapon rigs are the #1 blocker for realistic FPS feel.

**Priority**: This section must be expanded with actual working code examples from the official zombies-fps example + our own experiments.

## References
- Official `zombies-fps` example in `hytopiagg/sdk-examples`
- `player-fp.gltf` usage patterns
- Named nodes workflow from our `ak47-named-nodes.glb`
