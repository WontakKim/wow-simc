# Current Implementation Gaps and Milestone Plan

Research date: **2026-09-26**. Statement classes are defined in the [directory index](README.md). Every defect below was **verified by reading `web/src/` at commit `ab42fc8`** during this research pass; `file:line` references are to that commit. "Reference" means the behavior documented in [m2-format-and-rendering.md](m2-format-and-rendering.md) or [particles-and-ribbons.md](particles-and-ribbons.md) from the pinned reference implementations. Engine-side items reference the pinned `simc/` checkout.

## 1. Verified defect list

### D1. Particle blend 7 uses the inverse factor pair — `web/src/NativeParticleEffect.ts:181-186`

```ts
blendSrc: emitter.blendingType === 7 ? OneMinusSrcAlphaFactor : undefined,
blendDst: emitter.blendingType === 7 ? OneFactor : undefined,
```

Raw M2 blend 7 (BlendAdd) requires GL `ONE, ONE_MINUS_SRC_ALPHA` (source one, destination one-minus-source-alpha). The implementation swaps them, implementing EGx 7 (InvSrcAlphaAdd, `ONE_MINUS_SRC_ALPHA, ONE`) instead. Numeric check — source RGB `(0.6, 0.2, 0.0)`, alpha `0.25`, destination `(0.1, 0.2, 0.3)`:

```text
correct BlendAdd:  (0.6,0.2,0.0) + 0.75·(0.1,0.2,0.3) = (0.675, 0.35, 0.225)
implemented pair:  0.25·(0.6,0.2,0.0) + (0.1,0.2,0.3) = (0.25, 0.25, 0.30)
```

### D2. Depth-flag signs inverted and inconsistent — `web/src/NativeParticleEffect.ts:305-306` vs `:410`

Ribbon path (`:305-306`):

```ts
depthWrite: (materialSource.flags & 0x10) !== 0,   // SET enables write — reference: SET disables
depthTest:  (materialSource.flags & 0x8) !== 0,     // SET enables test  — reference: SET disables
```

Mesh path (`:410`):

```ts
depthTest:  (material.flags & 0x8) === 0,           // correct sign
depthWrite: (material.flags & 0x10) !== 0,          // wrong sign, same as ribbon
```

Reference (both wow.export and WWV): `0x08` set **disables** depth test, `0x10` set **disables** depth write. The two code paths also disagree with each other on the test flag, so depth occlusion behavior differs between ribbons and meshes carrying the same flags.

### D3. TXAC material/particle split not applied — `web/src/nativeM2.ts:550-559, 716`

The whole TXAC chunk is read into one flat `textureControlEntries` list sized against particle count (`:552` validates `>= particleRecords.count * 2`). Reference layout: material pairs precede particle pairs (`materialTXAC[i] = pairAt(i); particleTXAC[j] = pairAt(materialCount + j)`). Without the split, some particle controls are actually material controls and the multitexture shader-selection inputs are wrong.

### D4. Unconditional 5-bit texture-index mask — `web/src/nativeM2.ts:603`

```ts
const textureIndices = [textureId & 0x1f, (textureId >> 5) & 0x1f, (textureId >> 10) & 0x1f];
```

The 5-bit packing applies only when the multitexture flag (`0x10000000`) is set; otherwise the field is a full uint16 texture index. Unconditional masking rejects valid indices above 31 on single-texture emitters.

### D5. SKIN `level` extension applied to vertex start — `web/src/nativeM2.ts:766-769`

```ts
const vertexStart = view.getUint16(offset + 4, true) + level * 65536;   // :767 — wrong
...
const indexStart = view.getUint16(offset + 8, true) + level * 65536;    // :769 — correct
```

Reference (wow.export `Skin.js`): the high bits extend the **triangle index start only**. Adding them to `vertexStart` corrupts geometry on any section with a nonzero level.

### D6. UV-transform rotation read as compressed quaternion — `web/src/nativeM2.ts:291, 481`

`trackValueSize("quaternion") === 8` (`:291`) and texture-transform rotation is parsed with kind `"quaternion"` (`:481`), i.e. four int16 components at 8 bytes. The reference layout reads rotation as **four float32 values (16 bytes)**. Stride and decode are both wrong, so every subsequent texture transform record misparses.

### D7. zSource direction reversed — `web/src/nativeParticles.ts:383-385`

```ts
const localDirection = authoredZSource > 0
  ? normalize([-localOrigin[0], -localOrigin[1], authoredZSource - localOrigin[2]])
  : emission.direction;
```

This is the direction from the spawn point toward `(0,0,zSource)`. Reference (WWV `CPlaneGenerator.cpp:41-63`): `normalize(p − (0,0,zSource))` — **away from** the source point. Emissions converge on the source instead of radiating from it.

### D8. Speed variation additive and half-range — `web/src/nativeParticles.ts:396`

```ts
const speed = Math.max(0, speedBase + (randomUnit(...) - 0.5) * speedVariation);
```

Reference: `speed = speed0·(1 + U·speedVariation)` — multiplicative, full signed range. The comment at `:395` acknowledges the approximation; this entry records that the reference formula is now known and the approximation is unnecessary.

### D9. Fixed viewer release windows instead of logged timing — `web/src/GenuineModelScene.tsx:53, 214`

```ts
export const REPLAY_EFFECT_RELEASE_SECONDS = 0.2;          // :53
const release = isProjectile ? REPLAY_EFFECT_RELEASE_SECONDS : 0;  // :214
```

Missile release/impact should come from the log's perform/travel/hit records (see [simc-synchronization.md](simc-synchronization.md)). The UI text at `:1264` and `:1455` already labels these as viewer-chosen; the fix is to replace them with the matched occurrence times.

### D10. Particle flag `0x10` space semantics inverted, bone skipped — `web/src/nativeParticles.ts:386-392`

```ts
const usesWorldCoordinates = (emitter.flags & 0x10) !== 0;
```

Flag set is treated as world space and the bone transform is skipped entirely. Reference (WWV): flag set = **local space** (state stays emitter-local, drawn through the current emitter matrix); flag clear = world frame seeded from the birth-time emitter matrix. Both paths include the bone transform.

### D11. Quaternion interpolation without shortest-path handling — `web/src/nativeParticles.ts` `interpolateValue`

`interpolateValue` performs componentwise linear interpolation for all array values, including rotation quaternions; there is no dot-product antipodal check, no slerp, no post-normalization. Antipodal key pairs (`q`, `−q`) interpolate through zero. (Decode-convention difference vs wow.export — `(s<0 ? s+32768 : s−32767)/32767` at `nativeM2.ts:268-276` vs `(u−32767)/32768` — is a separate, non-defect divergence; pick one convention and test it.)

### D12. Emission accumulator semantics inconsistent — `web/src/nativeParticles.ts:246-284`

The constant-rate fast path emits an unconditional particle at time zero (`finalIndex = floor(t·rate)` includes index 0 at t=0) while the variable-rate path waits for a full accumulated unit (`threshold` starts at 1). Reference semantics: `accumulator += dt·rate; while (accumulator > 1) { spawn; accumulator -= 1; }` with newborn age distributed inside the interval — uniform across both cases.

### D13. Spawn history silently truncated at 4096 — `web/src/nativeParticles.ts` `createSpawnTimes`

Both paths cap `result.length` at 4096 / `Math.min(4095, ...)` and continue as though all particles rendered. Allocate from a validated budget, checkpoint history, and report overflow explicitly.

### D14. Invented delayed-wind interpretation — `web/src/nativeParticles.ts:399-400`

`windAge = max(0, age − windTime)` applies wind only after a delay. Reference: wind is added to velocity every step; `WindTime` is present in the record but **not consumed** by the CPU path. Any delay semantics are invented.

### D15. Analytic drag instead of the step integrator — `web/src/nativeParticles.ts:401-403`

`exp(−drag·age)` velocity damping with undamped acceleration displacement is not the reference step: `v = (v + gravity·dt)·(1 − min(drag·dt, 1))` applied after displacement, per step.

### D16. Billboard quads at half extent — `web/src/NativeParticleEffect.ts:100-103`

Quad corners are `±0.5`; the reference expands corners to `±1` times its basis vectors. Either switch to `±1` or document the compensating size convention — otherwise particles are half the intended extent once D8's speed fix lands and sizes follow authored data.

### D17. Translation-only attachment history callback — `web/src/nativeParticles.ts:365`

`options.sourceTranslationAtTime` supplies only a position; reconstructing historical emitter frames for world-space particles needs a full transform (rotation included) at the requested historical time. A moving **and rotating** caster cannot be reproduced with translations alone.

### D18. Bone-parent ordering stronger than the format — `web/src/nativeM2.ts` bone validation

The parser requires every parent bone index to be smaller than its child. The format allows any acyclic hierarchy; a DFS cycle check is sufficient and accepts valid models.

### D19. Animation payloads validated against the wrong owner — `web/src/nativeM2.ts`

All animation track payloads are validated against the main model bytes. External ANIM (AFM2/AFSB/AFSA) and SKEL payloads own their own bytes; offsets must be resolved against the owning payload or external character animations cannot load (see [m2-format-and-rendering.md §5](m2-format-and-rendering.md#5-bones-sequences-vertices-external-animation)).

### Engine-side (pinned `simc/`)

- The JSON-v2 action sequence used by `web/src/replay.ts` carries no travel/impact times; the text log does, and no log parser exists in `web/src/` yet. (Gap, not defect: the timing source documented in [simc-synchronization.md](simc-synchronization.md) is unimplemented.)

## 2. Prioritized milestone plan

Each milestone is independently shippable behind the native-rendering path, with tests before renderer changes. Acceptance criteria are automatically verifiable (Policy; synthesized from the reference evidence above).

| Milestone | Deliverable | Acceptance |
| --- | --- | --- |
| **M0 — Correctness baseline** | Fix D1–D6, D10, D11, D16 area-field/blend/depth/TXAC/index/quaternion errors | Synthetic blend readback matches the D1 numeric fixture; TXAC prefix fixture; texture index > 31 fixture; depth-occlusion tests for both flag signs; quaternion antipode test |
| **M1 — Real replay timeline** | Log parser producing occurrences, travel, impacts, auras, actor ambiguity (D9, engine-side gap) | Exact sample times from the local log; three same-time overloads retained; unmatched `stormfury_aoe` hits retained as schedule→hit; no inferred GCD |
| **M2 — Prepared dependency graph** | Build-pinned manifests and recursive assets (prepare script) | Hash/size verification; no browser remote requests during playback; replaceable FDID 0 never fetched; unresolved conditions retained |
| **M3 — Native skeleton and attachments** | MD21/SKIN/SKEL/ANIM, sequence ownership, skinning (D18, D19) | Inline/external animation equivalence fixtures; alias-cycle rejection; known bind pose; attachment markers agree with CPU transforms |
| **M4 — Native appearance** | Explicit Vulpera choices, geosets, collection models, atlas composition | Chosen IDs fixed in a manifest; no conflicting alternatives; atlas dimensions from DB rows; per-layer golden images; target-order vs Layer-order diagnostic |
| **M5 — General M2 materials** | Shader selection, supported combiners, UV transforms, non-PBR lighting | All 36 indexed table rows tested; `0x14`, `0x4014`, `0x8021` resolve correctly; every used PS has numerical color/alpha fixtures; unknown shader cannot silently become opaque |
| **M6 — Particle reconstruction** | Reference spawn/forces/space rules, multitexture, lifetime curves (D7, D8, D12–D17) | Fixed-seed snapshots independent of render FPS; moving+rotating emitter tests; correct local/world separation; two-/three-color equations; EXP2 cutoff tests |
| **M7 — Ribbons** | Ring history, all passes, UV aging, gravity, transforms | Nonsquare atlas fixture; gravity `g·t²` accumulated displacement; UV aging continues after stop; no index connections between separate occurrences |
| **M8 — Spell graph scheduling** | Cast/release/missile/impact/aura phases and animation resolver | No arbitrary release delay over logged perform; impact at logged hit; background overloads do not restart foreground casts; duplicated attachment rows remain distinct |
| **M9 — Scene calibration** | Lighting preset, camera, fog, contact shadows, optional bloom | Fixed-camera screenshots; material-only comparison before bloom; controlled color-space chart; recorded preset provenance |

### High-value unit fixtures (from §1 evidence)

```text
BlendAdd numeric fixture (D1): source (0.6,0.2,0.0)/0.25 over dest (0.1,0.2,0.3) = (0.675,0.35,0.225)
zSource direction (D7): spawn away from (0,0,z), not toward
SKIN level (D5): nonzero level extends indexStart only
UV rotation (D6): nonzero rotation round-trips through float32x4
coordinate/history: rotating emitter — world particles stay, local particles follow
animation ownership: same numeric offset pointing at different bytes in MD21/AFM2/AFSB/AFSA
fixed point: fp6.9 0x0200 and 0x8200 (sign-magnitude vs two's-complement converters disagree)
alpha: values immediately below/at the 128/255 alpha-key threshold
```

### Screenshot coherence checks (Playwright, fixed viewport/DPR/camera/lighting/time/seed)

- attachment effects lie near projected native attachment points;
- impact regions empty before the scheduled impact time, nonempty after;
- no large opaque rectangle behind an additive effect (D1 regression signal);
- separate missiles never acquire connecting ribbon triangles;
- backward seek to a saved time reproduces the identical frame;
- no network request occurs while replay advances.

These are coherence tests, not proof of retail parity; pixel similarity must ultimately be measured against a controlled reference capture.

## 3. Recommended first slice

**M0 + M1.** The M0 items are demonstrated, isolated errors with numeric fixtures; M1 replaces illustrative timing windows with the local log's actual phases. Together they attack immediately visible defects while the native character loader (M3–M4) is developed against the explicit data contract above.
