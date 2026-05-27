# Player Rigging, Named Nodes & Model Export Standards

## The Golden Rule
Hytopia relies heavily on **named nodes** inside your GLB/GLTF files for precise control. If a bone or attachment point doesn't have a clean, documented name, you will suffer.

## Player Model Standards

### Default Player vs Custom
- The SDK provides `player.gltf` (from `@hytopia.com/assets`).
- For serious games you will almost always need a custom rigged player or at minimum heavy node overrides.
- Always keep a `player-named-nodes.glb` version.

### Critical Named Nodes You Should Document
Common useful nodes on humanoid rigs:
- `head`, `neck`, `torso`
- `arm_right`, `arm_left`, `hand_right`, `hand_left`
- `upper_arm_r`, `lower_arm_r`, `hand_r` (more precise naming is better)
- `muzzle`, `grip`, `stock`, `magazine` (per weapon)
- Any custom attachment points for pets, backpacks, etc.

## Export Rules (Blender / Blockbench)

1. **Apply All Transforms** before export.
2. **Use -Z as forward** for characters (Hytopia convention).
3. **Name every important bone/node** you will ever want to attach something to.
4. **Create dedicated "named-nodes" exports** — these are your source of truth for attachment math.
5. Keep mesh count low for viewmodels (< 20 meshes recommended).
6. Test the model in the official Hytopia client early and often.

## First-Person vs Third-Person Rigs

- **FP Viewmodel**: Can be heavily simplified. Often just arms + weapon. Does not need full body.
- **World / Third Person**: Needs full body + animations that look good from a distance.
- Many professional Hytopia games maintain two completely separate models for the same character.

## Common Failure Modes

- Gun in wrong hand or rotated 90 degrees → Almost always a missing named node or wrong export axis.
- Hands not moving with weapon → The viewmodel model was not authored with the correct grip pose baked in.
- Tails / extra limbs on creatures breaking → Poor segment naming (see Nine Tailed Fox section).

## Recommended Workflow

1. Model in Blender/Blockbench.
2. Rig and name every important node.
3. Export 3 versions:
   - `model-name.glb` (normal)
   - `model-name-named-nodes.glb` (with explicit empty nodes or labeled bones for attachments)
   - `model-name-fp.glb` (first person optimized version)
4. Document the node names in this Bible under the relevant game system.

## Project Gehenna Specific Notes
- The `ak47-named-nodes.glb` already exists for this reason.
- The player model needs better documented hand nodes before realistic weapon attachment is possible.
- Nine Tailed Fox currently has 108 tail segments — all must remain perfectly named or the ripple animation will break.

## Action Items
- Create a living "Node Name Registry" for every important model in the project.
- Standardize hand bone names across all weapons and player models.
