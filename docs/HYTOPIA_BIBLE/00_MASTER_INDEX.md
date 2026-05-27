# HYTOPIA BIBLE — Master Index (Project Gehenna)

**This is the Master Player Book for Hytopia NEO development on Project Gehenna.**

Any AI (Grok, Cursor, Claude, or future agents) working on this project should read the relevant sections of this Bible before making architectural or implementation decisions.

## How to Use This Bible

1. Start with the high-level sections (00–06) to understand philosophy and resources.
2. Read the technical deep dives relevant to the task at hand.
3. Check the Common Errors & Gotchas section before spending hours debugging something painful.
4. When you discover new hard-won knowledge, add it here.

---

## Current Structure (as of latest update)

### Foundations
- 00_CORE_ARCHITECTURE.md
- 00_MASTER_INDEX.md (this file)
- 01_CLI_OPERATIONS.md
- 02_ASSET_PIPELINE.md
- 03_PROJECT_IDENTITY.md
- 04_PHYSICS_and_ECS.md
- 05_UI_and_NETWORKING.md
- 06_SDK_MASTER_LINKS.md

### Official Resources & Ecosystem
- 26_HYTOPIA_OFFICIAL_GITHUB_ECOSYSTEM.md ← Start here for any GitHub research

### Core Technical Deep Dives
- 15_VIEWMODELS_WEAPONS_AND_ATTACHMENTS.md
- 16_PLAYER_RIGGING_NAMED_NODES_AND_EXPORT.md
- 17_CAMERA_VIEWMODEL_TRANSFORMS_AND_MATH.md
- 19_GAME_ARCHITECTURE_AND_DIRECTOR_PATTERNS.md
- 20_FULL_WEAPON_SYSTEM_ARCHITECTURE.md
- 21_ANIMATION_SYSTEM_DEEP_DIVE.md
- 22_PERFORMANCE_AND_HORDE_SCALING.md
- 23_INTERACTION_SYSTEM.md
- 24_ENTITY_AND_COMPONENT_PATTERNS.md
- 25_INPUT_PLAYER_STATE_AND_CONTROLLERS.md
- **35_THROWABLES_PHYSICAL_GADGETS_AND_LETHALS.md** ← The correct pattern for physical throwables & gadgets (models + input + data flow)

### Practical Guides
- 18_LOCAL_DEVELOPMENT_AND_DEBUGGING.md
- 27_ASSET_CREATION_EXPORT_PIPELINE.md
- 28_COMMON_ERRORS_GOTCHAS_AND_SOLUTIONS.md
- 29_BUILD_PACKAGING_AND_DEPLOYMENT.md
- 30_MULTIPLAYER_ARCHITECTURE_CONSIDERATIONS.md
- 31_UI_SYSTEM_DEEP_DIVE.md
- 32_DEBUGGING_TELEMETRY_AND_TOOLS.md

### Game-Specific Systems
- 07_AI_and_ZOMBIE_HORDE.md
- 08_PERSISTENCE_and_SAVING.md
- 09_PARTICLE_SYSTEMS.md
- 10_ADVANCED_AUDIO_LOGIC.md
- 11_MAP_and_ENVIRONMENT.md
- 12_NINE_TAILED_FOX_LOGIC.md
- **35_THROWABLES_PHYSICAL_GADGETS_AND_LETHALS.md** ← Required reading for any new throwable, mine, deployable, or physical gadget

### AI & Tooling
- 13_AI_PROMPT_RECORDS.md
- 14_API_FACTORY_KEYS.md

---

## Priority Areas That Still Need Expansion (Living List)

This list should be reviewed and updated regularly.

High priority remaining work:
- Economy & Progression Systems (M$, perks, unlocks)
- Boss Architecture (Dragon + phases)
- Pet/Companion System Architecture (Nine-Tails)
- Wave Director & Horde AI detailed design
- Hytopia Platform limits, quotas, and costs
- Advanced Audio Spatialization & Mixing
- Full Telemetry & Monitoring strategy
- Testing strategies when working with multiple AIs

---

**Last major update**: Added 35_THROWABLES_PHYSICAL_GADGETS_AND_LETHALS.md (May 2026) — documents the correct dedicated-model + authoritative-input pattern discovered during lethal system work.

If you are an AI reading this: Treat this document as the single source of truth for how Project Gehenna should be built in Hytopia NEO.
