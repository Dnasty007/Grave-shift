# Asset Creation & Export Pipeline (Blender / Blockbench)

## Golden Rules for Hytopia Assets

1. **-Z is Forward** in Hytopia. All characters and weapons should be authored facing -Z.
2. **Apply All Transforms** before export.
3. **Name Every Important Node**. If you will ever want to attach something to it or animate it, it needs a clean name.
4. **Keep Mesh Count Low** — especially for viewmodels and frequently spawned entities (< 20 meshes is a good target).
5. **Create "Named Nodes" variants** of every important model. These are your source of truth for attachment points.

## Recommended Export Workflow

### For Weapons (Critical for Project Gehenna)

For every weapon you want to use:

1. Create the high-fidelity version.
2. Create a dedicated **First-Person (FP) version** with:
   - Only the parts visible in first person
   - Hands/arms if needed
   - Correct grip pose baked in relative to the camera
   - Named nodes for muzzle, grip, ejection port, etc.
3. Export both as `.glb`

Recommended naming:
- `ak47-fp.glb`
- `ak47-world.glb`
- `ak47-named-nodes.glb` (with extra empty nodes or labeled bones for precise attachment)

### For Characters & Creatures

- Main rigged model
- `model-named-nodes.glb` version
- Separate simplified LOD versions if performance becomes an issue

### For the Player / Viewmodel Body

Many serious Hytopia games use a completely separate `player-fp.gltf` just for first-person arms/hands. This is highly recommended over trying to hide parts of the full player model.

## Blender Export Settings

- Format: glTF Binary (.glb) or glTF Separate (.gltf + .bin)
- Include: Animations, Materials, Custom Properties
- Apply Modifiers: Yes
- Y Up → Convert to -Z forward during export if needed (test this)

## Blockbench Tips

Blockbench is often better than Blender for low-poly game assets and quick iteration.

- Use the glTF exporter
- Pay close attention to bone naming
- Test animations inside Blockbench before exporting

## Common Export Mistakes That Break Things in Hytopia

- Not applying scale/rotation
- Wrong forward axis (models facing +Z instead of -Z)
- Missing or duplicate node names
- Too many meshes (performance death)
- Non-manifold geometry causing bad colliders
- Animations not exported or using wrong names

## Project Gehenna Asset Standards

All models used in the game should eventually have:
- A documented entry in this Bible
- A `*-named-nodes` variant
- Clear separation between FP and World versions where relevant
- Known animation clip names listed

This discipline will save hundreds of hours of "why won't this attach properly" debugging.
