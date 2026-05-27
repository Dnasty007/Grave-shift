# 35 — Throwables, Physical Gadgets & Lethals (The Correct Pattern)

**Status**: Core Reference Document  
**Applies to**: Any physical, thrown, planted, or deployable item (grenades, sticky bombs, C4, mines, breaching charges, throwable perks, etc.).

---

## Core Philosophy

**Dedicated models beat composed hacks.**

When adding any throwable or physical gadget:

- Create (or commission) a real `.glb` model for it.
- Treat it like a first-class asset, the same way we treat weapons and player rigs.
- Never default to using `fireball.gltf`, scaled blocks, or multiple child orbs as the primary visual.

The goal is **swappability**. An artist should be able to improve the model and drop the new file in without touching code (or with minimal constant changes).

---

## Recommended Folder Structure

```
assets/models/
├── particles/                    ← Preferred location for small gadgets & throwables
│   ├── green-sphere.glb
│   ├── sticky-bomb.glb
│   ├── c4-block.glb
│   ├── smine.glb
│   └── [your-new-gadget].glb
│
├── gadgets/                      ← Optional: Use this if you want clearer separation
│   └── breaching-charge.glb
│
└── weapons/
```

**Rule**: Put small physical items in `particles/` unless you have a strong reason to create a new folder. Keep the naming obvious.

---

## Code Integration Pattern (The One You Should Copy)

### 1. Constants at the top of the owning system file

```ts
// Visual model paths — dedicated assets only
const FIREBALL      = "models/projectiles/fireball.gltf";           // VFX only
const GOLD_BLOCK    = "models/particles/.optimized/gold-block/gold-block.glb";

const GREEN_SPHERE  = "models/particles/green-sphere.glb";          // Frag grenade
const STICKY_BOMB   = "models/particles/sticky-bomb.glb";           // N 74 ST
const C4_BLOCK      = "models/particles/c4-block.glb";              // Satchel charge
const SMINE_MODEL   = "models/particles/smine.glb";                 // S-Mine 44
```

Every constant must have a comment describing what the model looks like and which lethal/item it belongs to.

### 2. Use the constant when spawning Entities

```ts
const entity = new Entity({
  name: `lethal-${kind}-${Date.now()}`,
  modelUri: isSticky ? STICKY_BOMB : GREEN_SPHERE,   // ← Dedicated model
  modelScale: mainScale,
  rigidBodyOptions: { ... }
});
```

### 3. One model per logical object type

- Frag → one clean model
- Sticky → one clean model (with handle if possible)
- C4 → one flat rectangular model
- S-Mine → one model with body + prongs

Avoid the old pattern of one model + many child Entities just to fake shape.

---

## Input Authority Rules (Critical)

For any gadget that can be activated by the player:

**Server-side input polling is the single source of truth.**

```ts
// In the Director / main game loop
const nPress = !!(host.input as { n?: boolean }).n;
const nRise  = nPress && !this._prevN;
```

- UI messages (`gehennaUseLethal`, `useLethal`, etc.) should be **intentionally ignored** for the actual throw/activation logic.
- This prevents double-firing when both the client UI and server input poll fire on the same key press.
- Add a small debounce timer (`_lethalUsedAtMs`) as a safety net.

Document the decision clearly in code comments.

---

## Data Injection Into Feature Systems

Do **not** make the gadget system reach out and query the world.

Instead, gather what it needs in the main tick and pass it in:

```ts
// In GehennaDirector
const zombiePositions = this._zombies
  .filter(z => z.entity.isSpawned)
  .map(z => z.entity.position);

this._lethalSystem.tick(dtS, world, host, pe?.position, zombiePositions);
```

Then in the system:

```ts
tick(dt: number, world: World, host: any, playerPos?: Vector3Like, zombiePositions?: readonly Vector3Like[]): void
```

This pattern scales extremely well to future systems (perks, deployables, traps, etc.).

---

## Physics & Feel Guidelines

- Use `linearDamping` and `angularDamping` on rigidbodies. This is the easiest way to make an object feel "heavy" or "light".
- Use the `hasStuck` / one-shot guard pattern inside `onCollision` callbacks to prevent jitter.
- Tune bounciness, friction, and throw arc per item weight (document the intended feel in comments).
- For planted items (C4, mines), consider switching to `FIXED` or `KINEMATIC_POSITION` once they settle.

Example comment style:

```ts
// Shallow arc — C4 is heavy clay, not a light grenade
dir.y = (dir.y || 0) + phys.arcUpBias * 0.55;
```

---

## Anti-Patterns (What We Did Wrong Before)

- Using `fireball.gltf` + multiple child orbs as the main visual for gameplay objects.
- Manually simulating position/velocity every frame on DYNAMIC rigidbodies (fights the engine).
- Letting both UI messages and server input trigger the same action.
- Hardcoding model paths deep inside Entity creation instead of constants.
- Making S-Mines (or similar) only check the player instead of passing real enemy positions.

---

## Step-by-Step Recipe for Adding a New Throwable/Gadget

1. **Design & Model**
   - Create a dedicated low-poly `.glb`.
   - Put it in `assets/models/particles/`.
   - Name it clearly.

2. **Add Constant**
   - Add it at the top of the owning system file with a descriptive comment.

3. **Wire the Visual**
   - Use the constant in the Entity constructor.

4. **Handle Input Authoritatively**
   - Decide on the input key.
   - Make server polling the only path that creates/spawns the object.
   - Add debounce if needed.

5. **Inject Required Data**
   - Update the system's `tick()` signature if it needs world state (enemy positions, surfaces, etc.).
   - Gather that data in the Director/main loop and pass it down.

6. **Tune Physics & Feel**
   - Add damping, bounciness, friction, throw arc.
   - Write comments explaining the intended physical behavior.

7. **Test Swappability**
   - Take the `.glb` out, replace it with a placeholder or improved version.
   - Verify nothing breaks in code.

---

## Future-Proofing

When we build the next game (or a big new feature in this one), treat this document as required reading for any AI or developer working on:

- Throwables
- Deployables
- Traps
- Gadgets
- Any physical item the player can interact with in the world

The combination of:
- Dedicated swappable models
- Authoritative server input
- Clean data injection
- Good physics tuning

...is the Gehenna standard for this class of feature.

---

**Last Updated**: By Grok after Claude's excellent work on the lethal system (May 2026)

Any future AI working on similar systems should follow this pattern instead of reinventing hacky solutions.