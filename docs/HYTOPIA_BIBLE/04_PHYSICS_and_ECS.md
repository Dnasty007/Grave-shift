# Physics & ECS Logic
* **Physics Engine**: Uses Rapier3D (Deterministic). All movement must be validated on the server side to prevent cheating.
* **Colliders**: Every entity (Dragon, Zombie, Player) requires a collider component (Capsule for humanoids, Cuboid/Ball for projectiles).
* **Raycasting**: Used for the M4 weapon logic and Dragon projectile hits. Syntax: `world.simulation.raycast()`.
* **ECS Pattern**: Priority is given to the Entity Component System. Use components for state (e.g., `HealthComponent`, `EnemyComponent`) rather than heavy Class-based OOP for 1,000+ entities.
