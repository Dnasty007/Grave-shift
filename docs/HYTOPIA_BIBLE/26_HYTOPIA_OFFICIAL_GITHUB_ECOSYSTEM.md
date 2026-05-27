# Hytopia Official GitHub Ecosystem & Repositories

## Primary Organization
**https://github.com/hytopiagg**

This is the official source of truth for the entire Hytopia platform. Any AI working on Hytopia projects should be familiar with these repositories.

## Core Repositories (Must Read)

### 1. hytopiagg/sdk
- **URL**: https://github.com/hytopiagg/sdk
- **NPM Package**: `hytopia`
- **What it is**: The main SDK. Contains the compiled server, TypeScript definitions, default assets, CLI, and documentation.
- **Key Files to Read**:
  - `README.md`
  - `docs/server.md` (massive API reference)
  - `client-docs/client.hytopiaui.md`
- **Why it matters**: This is what your `package.json` depends on.

### 2. hytopiagg/hytopia-source
- **URL**: https://github.com/hytopiagg/hytopia-source
- **What it is**: The actual open-source engine source (MIT license).
- **Why read it**: When the public SDK docs are insufficient, this is where the real implementation lives. Useful for deep understanding of networking, physics, rendering, etc.
- **Warning**: It is complex. Only dive here when you hit limitations or bugs in the public SDK.

### 3. hytopiagg/sdk-examples
- **URL**: https://github.com/hytopiagg/sdk-examples
- **What it is**: Official example games maintained by the Hytopia team.
- **Most Important Examples**:
  - `zombies-fps` → Closest to Project Gehenna. Study this heavily.
  - `hygrounds`
  - `ark-game`
  - `payload-game`
- **Action**: Every AI working on Gehenna should have read the zombies-fps example in detail.

### 4. hytopiagg/world-editor
- **URL**: https://github.com/hytopiagg/world-editor
- **What it is**: Source for the official Hytopia World Editor (https://build.hytopia.com)
- **Use case**: Understanding how maps are structured and exported.

### 5. hytopiagg/desktop-releases
- Less critical for development, but shows the desktop client side.

## Recommended Research Workflow for AIs

When an AI needs to understand a Hytopia feature:

1. Start with `dev.hytopia.com`
2. Check the `sdk` repo README + `docs/server.md`
3. Look for relevant code in `sdk-examples` (especially zombies-fps)
4. Only then go into `hytopia-source` if the public API is unclear

## Important Notes on Versioning

- The SDK is still in active development (alpha/beta feel as of 2026).
- Always pin your `hytopia` version in `package.json`.
- Breaking changes happen. Document which SDK version each part of Project Gehenna was built against.

## Community Resources

- Developer Discord: https://discord.gg/hytopia-developers
- The Discord has an "SDK Help Bot" trained on the docs.

## Action for Project Gehenna Team

Maintain a living list in this Bible of:
- Which SDK version we are currently targeting
- Which example repos we have deeply studied
- Any custom forks or patches we are using

This file should be one of the first things any new AI (Grok, Cursor, Claude) reads when joining the project.
