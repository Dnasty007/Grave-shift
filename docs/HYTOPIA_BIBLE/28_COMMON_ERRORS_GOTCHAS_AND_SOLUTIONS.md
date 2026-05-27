# Common Errors, Gotchas & Solutions

This is a living document. Add new problems and solutions as they are discovered.

## Connection & Local Development

### "Can't connect to local server" despite server running
**Solutions** (in order):
1. Accept the self-signed HTTPS certificate at `https://localhost:8080/`
2. Allow "Local network access" for hytopia.com in Chrome site settings
3. Try both `localhost` and `127.0.0.1` in the join URL
4. Hard refresh (Ctrl+Shift+R)
5. New Chrome profile or Incognito
6. Disable VPN / aggressive ad blockers / security software

See file 18 and 06 for the most detailed troubleshooting.

## Model & Animation Issues

### Gun floats in the air / not in hands
- Most common cause: No dedicated FP model with correct grip pose
- Second most common: Missing or incorrect named nodes + transforms
- Solution path: See files 15, 16, and 17

### Animations not playing or wrong speed
- Check that the animation names in code exactly match the clip names in the glTF
- Confirm the model was exported with animations enabled
- For viewmodels, the animations must be in the FP model, not the world model

### Models facing the wrong direction
- Hytopia uses -Z as forward. Fix in Blender/Blockbench before export.

## Performance

### Game slows down massively with more zombies
- You are likely doing too much per-entity logic or creating too many entities
- See file 22 for scaling strategies

### Too many draw calls / low FPS
- Reduce mesh count per model
- Use occlusion culling
- Consider LODs for distant enemies

## SDK / API Gotchas

### `player.camera.setViewModel` does nothing
- The player must be attached to an entity first (`setAttachedToEntity`)
- You must be in FIRST_PERSON camera mode

### Raycast not hitting enemies
- Check your collider setup on the enemy entities
- Remember that `world.simulation.raycast` is the correct modern method

### Entity not spawning or invisible
- Did you call `entity.spawn()`?
- Is the model path correct relative to the running server?
- Check the server terminal for loading errors

## Pack-a-Punch & Upgrades

### Weapon doesn't change after PaP
- You need both the logic *and* a visual representation (new model or material swap)
- The viewmodel and world model must both be updated

## General Development

### Ports getting stuck constantly
- Use `npm run stop` religiously
- On Windows, the nuclear port kill command in file 01

### Changes not reflecting in game
- Did you restart the server? (`hytopia start` / `npm run dev` does not always hot-reload everything)
- Clear any client cache if using the local Vite client

---

**Rule**: When you solve a painful problem that took more than 30 minutes, document it here with the solution. Future AIs (and future you) will thank you.
