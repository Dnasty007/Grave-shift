# Camera, Viewmodel Transforms & Attachment Math

## Why This Section Exists
This is currently one of the hardest and most poorly documented areas when trying to make a real FPS feel in Hytopia NEO. Most of the "gun doesn't sit in the hand" problems live here.

## Key PlayerCamera Methods (2026 SDK)

### Essential Methods
- `player.camera.setMode(PlayerCameraMode.FIRST_PERSON)`
- `player.camera.setAttachedToEntity(playerEntity)`
- `player.camera.setViewModel('path/to/fp-model.glb')`
- `player.camera.setOffset({ x, y, z })`
- `player.camera.setForwardOffset(distance)`
- `player.camera.setViewModelPitchesWithCamera(bool)`
- `player.camera.setViewModelYawsWithCamera(bool)`
- `player.camera.setViewModelHiddenNodes(['head', 'neck', ...])`
- `player.camera.setViewModelShownNodes([])`

### Node-Level Transforms (Most Powerful)
When simple offsets aren't enough, you must use node transforms on the viewmodel:

```ts
// Example pattern (verify exact API in current SDK version)
const viewModel = player.camera.getViewModel();
if (viewModel) {
  const node = viewModel.getNode('hand_r_attach');
  if (node) {
    node.setPosition({ x: 0.02, y: -0.05, z: 0.1 });
    node.setRotation({ x: 0, y: 1.57, z: 0 }); // radians
    node.setScale(1.0);
  }
}
```

## Recommended Mental Model

1. The viewmodel is a separate "camera child" that moves with the camera.
2. You control its position/rotation relative to the camera using offsets + node transforms.
3. For perfect results, the **model itself** should be authored so the grip point is at the origin or a well-named node.

## Current Project Reality (May 2026)
The existing `WeaponManager.ts` only uses the most basic `setViewModel` + node hiding. There is almost no actual transform math yet. This is why guns feel wrong.

## Debugging Tips
- Use `player.camera.setOffset` in small increments while the game is running.
- Keep a "test weapon" that is just a simple box or cylinder so you can see exact positioning without model complexity.
- Always test with both mouse look and movement (sway/bob will expose bad offsets).
- The `ak47-named-nodes.glb` was created specifically so we can attach to precise points instead of guessing.

## Future Advanced Features We Will Need
- Procedural recoil (viewmodel kick + recovery)
- ADS (Aim Down Sights) position lerping
- Weapon sway based on player velocity
- Reload animation that moves the viewmodel and magazine node
- Muzzle flash spawned at a named `muzzle` node with correct world orientation

## References
- Official SDK examples (especially `zombies-fps` and `hygrounds`)
- Current `WeaponManager.ts` and `GehennaDirector.ts`
- The `player-fp.gltf` usage in the ark-game example
