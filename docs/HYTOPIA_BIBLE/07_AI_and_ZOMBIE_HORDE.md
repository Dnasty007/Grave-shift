# AI & Horde Pathfinding
* **PathfindingEntityController**: Use this for zombies. It handles obstacle avoidance and A* navigation automatically.
* **Movement Orientation**: Hytopia uses -Z as FORWARD. Ensure zombie models are authored facing -Z.
* **Optimized Ticking**: For 1,000+ zombies, use `entity.on(EntityEvent.TICK)` sparingly. Batch logic where possible to maintain 60fps.
