# How to Use This Bible as an AI (Critical Meta Guide)

## Purpose of This Document
This Bible exists so that any AI (Grok, Cursor, Claude, future agents) can be brought up to speed quickly and make high-quality decisions when working on Project Gehenna in Hytopia NEO — without the human having to re-explain context every time.

## Recommended Reading Order for New AIs

### Phase 1: Orientation (Read These First)
1. 00_MASTER_INDEX.md
2. 03_PROJECT_IDENTITY.md (the vision and tone)
3. 26_HYTOPIA_OFFICIAL_GITHUB_ECOSYSTEM.md
4. 06_SDK_MASTER_LINKS.md + 18_LOCAL_DEVELOPMENT_AND_DEBUGGING.md

### Phase 2: Technical Foundations
- 19_GAME_ARCHITECTURE_AND_DIRECTOR_PATTERNS.md
- 04_PHYSICS_and_ECS.md
- 24_ENTITY_AND_COMPONENT_PATTERNS.md

### Phase 3: Current Active Problem Areas
(These change over time — check with the human)
- As of late May 2026: Files 15, 16, 17 (Viewmodels, Rigging, Camera Math)

### Phase 4: Game-Specific Systems
Read the sections relevant to the feature you are working on (Nine Tails, Dragon, Interactions, Weapons, etc.).

**Important new reference (May 2026)**:  
**35_THROWABLES_PHYSICAL_GADGETS_AND_LETHALS.md** — This is now the required pattern for any physical throwable, mine, deployable, or gadget. Read it before designing new items of this type.

## Rules for AIs Using This Bible

1. **Never contradict the documented architecture** without very strong justification and explicit human approval.
2. When something is painful, check file 28 (Common Errors & Gotchas) first.
3. When working on assets, follow the standards in file 27 and 16.
4. Update this Bible when you discover new hard-won knowledge.
5. If a section is outdated, flag it clearly instead of silently working against it.

## How to Contribute Back

When you solve a difficult problem or make an important architectural decision:
- Add or update the relevant section.
- Add an entry to the "AI Prompt Records" if it was a particularly effective way of working.
- Update the Master Index if new major sections are created.

## Goal

The ideal end state is that a new AI can be dropped into this project, read the Bible, and be immediately productive and aligned with Ray's vision — without needing hours of re-explaining.

This document (34) exists to make that possible.
