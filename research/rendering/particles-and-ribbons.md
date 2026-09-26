# Particle Emitters, Multitexture, and Ribbons

Research date: **2026-09-26**. Statement classes are defined in the [directory index](README.md). The primary runtime reference for particle/ribbon behavior is Deamon87/WebWowViewerCpp at commit `1a8cccbeffc46231c6497e6b3f5bfbf3507d8071` (cited as WWV with repo-relative `file:line`); wow.export implements no M2 particle/ribbon path at all, so it contributes nothing here.

## 1. Emitter record layout (modern profile, `0x1EC` = 492 bytes)

The older prefix is 476 bytes; the modern multitexture parameters add 16 bytes. Do not infer layout from the M2 version alone. Offsets relative to the record start (Format, cross-checked against WWV `M2FileHeader.h`):

| Offset | Field |
| ---:| --- |
| `00`, `04` | ID, flags |
| `08` | Position, vec3 |
| `14`, `16` | Bone uint16, texture index / packed indices uint16 |
| `18`, `20` | Geometry-model and recursion-model arrays |
| `28`, `29` | Blend uint8, emitter type uint8 |
| `2A` | Particle-color index |
| `2C` | Two packed multitexture scale bytes |
| `2E` | Signed priority plane |
| `30`, `32` | Rows, columns |
| `34`, `48` | Speed track, speed-variation track |
| `5C`, `70` | Vertical and horizontal range tracks |
| `84` | Gravity track |
| `98`, `AC` | Lifespan track, lifespan variation |
| `B0`, `C4` | Rate track, rate variation |
| `C8`, `DC` | **Length/X** and **width/Y** tracks |
| `F0` | zSource track |
| `104`, `114`, `124` | Lifetime color, alpha, scale tracks |
| `134` | Scale variation vec2 |
| `13C`, `14C` | Head and tail cell tracks |
| `15C` | Tail length |
| `160`, `164`, `168` | Twinkle speed, percent, scale range |
| `170`, `174` | Burst/inheritance multiplier, drag |
| `178`–`184` | Base spin, base variation, spin rate, rate variation |
| `188`, `194` | Tumble bounds |
| `1A0`, `1AC` | Wind vector, WindTime |
| `1B0`–`1BC` | Follow speed/scale pairs |
| `1C0` | Spline points |
| `1C8` | Enabled track |
| `1DC` | Two `multiTextureParam0` vectors |
| `1E4` | Two `multiTextureParam1` vectors |

The length/width naming is a correction against the native structure: reference layout has length/X at `0xC8` and width/Y at `0xDC` (the current repo parser names `0xC8` width and `0xDC` length).

## 2. Flags: behavior, not inherited labels

| Flag | Behavior in the reference (WWV) |
| ---:| --- |
| `0x1` | Particle shading-related |
| `0x2` | Particle sorting-related |
| `0x4` | Velocity-oriented billboard (view-space when moving; with `0x1000`, rotates basis by velocity) |
| `0x10` | **Local-space particles** (see §6; not "world space") |
| `0x20` | Size inherits bone scale |
| `0x40` | Burst velocity from emitter displacement under empty-buffer condition (see §7; not "emit N now") |
| `0x100` | Sphere launch velocity forced +Z (`particlesGoUp`) |
| `0x200` | Alternating spin direction by seed (negate spin for odd seeds) |
| `0x400` | Tail time clamped to particle age |
| `0x1000` | Additional billboard/orientation path |
| `0x4000` | Follow behavior (§7) |
| `0x8000` | Random flipbook cell offset at construction — **not** the older "Squirt"/count-burst label |
| `0x10000` | Random head cell when no head-cell track present |
| `0x20000` | Head geometry |
| `0x40000` | Tail geometry (both head+tail → two quads) |
| `0x80000` | Independent X/Y scale variation |
| `0x100000` | Refraction-related path (shader branch currently `discard`s) |
| `0x800000` | Compressed gravity (§8) |
| `0x8000000` | Additional spin/billboard-center behavior (fallback path offsets center by spin axis) |
| `0x10000000` | Multitexture (§9) |
| `0x20000000` | Commonly labeled "Modx4"; **no general ×4 rule established** — no code derives `colorMult = 4` from it |
| `0x40000000` | Three-color-texture selection in the multitexture path |

LOD/view-scaling flags require a client/view policy; they are not intrinsic multipliers reconstructible from an isolated emitter. Emitter types: 1 plane, 2 sphere, 3 spline are implemented; type 4 (Bone) and the geometry/recursion model emitters are named in the header but **not implemented** in the reference runtime (`M2FileHeader.h:222-228` documents them; `particleEmitter.cpp:127-147` constructs only 1/2/3).

## 3. Spawn generators

Let `U` be signed uniform in `[-1,1]` and `U+` positive uniform from the selected RNG.

### Plane (type 1) — WWV `CPlaneGenerator.cpp:36-63`

```text
p = (U1·L/2, U2·W/2, 0)
```

For negligible zSource (`|z| < 0.001`): polar and azimuth independently scaled by their ranges,

```text
d = speed·(cosφ·sinθ, sinφ·sinθ, cosθ)
```

For active zSource:

```text
d = normalize(p − (0,0,zSource))
```

This points **away from** the source point. The current repo implementation computes the direction from the spawn point toward `(0,0,zSource)` — reversed (see gaps doc).

### Sphere (type 2) — WWV `CSphereGenerator.cpp:34-65`

```text
r = L + (W−L)·U+
d = (cosθ·cosφ, cosθ·sinφ, sinθ)     // θ, φ from signed-uniform × ranges
p = r·d
```

Without zSource, velocity follows `d` (flag `0x100` selects +Z); with zSource, the source-point direction above. Note this is uniform-angle, linear-radius sampling — **not** uniform volume sampling. Do not "improve" it to `r ∝ U^(1/3)`; it is the reference distribution.

### Spline (type 3) — WWV `CSplineGenerator.cpp:41-100`

The selected parameter is the emission-area Y bound clamped to `[0,1]`; position comes from spline arc length; when the controlling value is unchanged it randomizes between the clamped X/Y bounds. Default velocity is +Z·speed; positive zSource redirects velocity from the source point; nonzero vertical range rotates +Z around the normalized spline tangent by `U·verticalRange`. The horizontal-displacement code is unusual — treat it as compatibility behavior, not established native geometry.

All generators seed particle age with `fmod(delta·U+, max(lifespan, 0.001))` and store a signed 16-bit lifetime state used for lifespan variation (§4).

## 4. Rate, lifespan, speed, and the accumulator

Reference formulas (WWV `CParticleGenerator.cpp:7-27`):

```text
rate  = rate0 + U·rateVariation        // resampled per GetEmissionRate() call
life  = life0 + (state/32767)·lifeVariation   // state = signed 16-bit stored at spawn
speed = speed0·(1 + U·speedVariation)  // multiplicative, full signed range
```

The current repo viewer uses additive half-range speed `speed0 + (U−0.5)·variation` — not this formula.

Emission accumulator (WWV `particleEmitter.cpp:679-690`):

```ts
accumulator += dt * sampledRate;
while (accumulator > 1) { spawn(); accumulator -= 1; }   // strictly >, not >=
```

Newborn age is distributed within the update interval; for large deltas the reference splits simulation into 0.1 s steps bounded by lifespan. Consequence for the repo: the constant-rate fast path emitting an unconditional particle at time zero while the variable-rate path waits for a full accumulated unit is inconsistent semantics (both paths exist in `web/src/nativeParticles.ts` `createSpawnTimes`).

### Reference RNG

`CRndSeed` (WWV `CRndSeed.cpp:42-80,144-175`) is a custom noise-table PRNG: a fixed 256-byte table, integer state advancing through four byte-derived table offsets and rotated 32-bit words, floats constructed through bit patterns. For literal compatibility, port the generator and table together with explicit uint32 overflow and little-endian unaligned reads. **Policy alternative:** a counter-based generator keyed by `(runId, actorId, effectOccurrenceId, emitterId, spawnOrdinal, randomChannel)` is easier to seek deterministically — that is an implementation choice, not the client RNG. The current repo hash omits effect-occurrence identity, so two instances of the same emitter reuse one random pattern.

### Lifespan caveat

The reference uses different state fields in initial-lifetime versus later death-related calculations, and normalizes lifetime tracks against a maximum-lifetime quantity in places. A coherent browser policy: sample one positive lifetime at birth, use it consistently for death and normalized age, document the policy. A strict reference mode must reproduce the full update path including its quirks.

## 5. Integration step and forces

Reference CPU update (WWV `particleEmitter.cpp:721-758`):

```ts
v += wind * dt;
const displacement = v * dt;
p += displacement + 0.5 * gravity * dt * dt;
v  = (v + gravity * dt) * (1 - min(drag * dt, 1));
```

`WindTime` is present in the record but **not consumed** by this path — any delayed-wind interpretation is invented relative to the reference. The current repo viewer instead uses an analytic drag (`exp(−drag·age)` velocity damping with undamped acceleration displacement); that is not the step integrator.

**Policy:** simulate at a fixed tick independent of render FPS (e.g. 120 Hz — an engineering choice, not a recovered client rate), with checkpoints for backward seek. At arbitrary render time, interpolate or evaluate a non-mutating residual state; never consume additional random numbers because the UI requested an intermediate frame.

## 6. World/local space and the emitter transform

Full emitter transform:

```text
E(t) = M_placement(t) · D_bone(t) · T(emitterPosition) · C_particleFix
```

`C_particleFix` is a particle-coordinate correction distinct from the global Z-up→Y-up conversion; keep it an explicit matrix, not an unexplained axis swap (WWV `m2Object.cpp:1241-1283`).

For flag `0x10` **clear** (world/reference frame):

```text
Transform spawn position and velocity by E(birthTime); w=0 for velocity.
Store particle state in that frame; do not move it with the current emitter.
```

For flag `0x10` **set** (local space):

```text
Keep particle state emitter-local; transform it for drawing by E(currentTime).
```

Both paths include the emitter's bone transform — "world space" does not mean "skip the bone." The current repo viewer treats `0x10` set as world space and skips the bone entirely (both wrong).

## 7. Follow, burst velocity, compressed gravity

Follow (flag `0x4000`): declared speed→scale mapping is linear between `(followSpeed1,followScale1)` and `(followSpeed2,followScale2)`, upper-clamped at 1, no lower clamp; scaled emitter displacement is added to particles older than `2·dt`. Caveat: the examined CPU update path subsequently overwrites the computed follow vector with an unscaled displacement, and the GPU path preserves that. "Formula from field names" and "actual reference execution" are different facts.

Burst (flag `0x40`, WWV `particleEmitter.cpp:609-627,704-708`): every 30 ms timer interval, if the previous particle buffer is empty, burst velocity = emitter displacement scaled by `frameTime/burstTime·BurstMultiplier`; at creation it is multiplied by `(1 + speedVariation·U)`. It is a motion-derived velocity injection — **not** a particle-count burst and not a replacement for the rate accumulator.

Compressed gravity (flag `0x800000` — not `0x800`), four-byte key:

```c
int8_t x; int8_t y; int16_t magnitudeAndZSign;
```

```text
d.x = x/128;  d.y = y/128;  d.z = sqrt(max(0, 1 − d.x² − d.y²))
m = z16 · 0.04238648
if m < 0: d.z = −d.z; m = −m
g = m · d
```

Ordinary scalar gravity becomes `(0,0,−g)` in native coordinates; do not apply that negation to the already-decoded compressed vector. (WWV `M2FileHeader.h:163-166`, `animate.h:146-158`, gate at `animationManager.cpp:1400-1421`.)

## 8. Lifetime tracks, twinkle, spin, size, flipbooks, tails

Lifetime color/alpha/scale/cell/cutoff tracks are `M2PartTrack`s evaluated against `age/maxLifespan` clamped to `[0,1]`: default when no timestamps, hold the endpoint past the last key, linear between neighbors (WWV `animate.h:469-498`). There is no active legacy three-key `midPoint` layout. Particle color defaults are white with `/255` normalization; `fixed16` alpha converts by `/32768` (the mesh path in the repo uses `/32767` — pick one convention and test it; see gaps doc).

Size variation (WWV `particleEmitter.cpp:1255-1266`):

```text
s'x = sx · max(ε, 1 + U·variationX),  ε ≈ 1e-7
```

shared between X and Y unless `0x80000` is set (independent factors). The reference's billboard corners are `±1` times its basis vectors; a viewer whose quad is `±0.5` must apply an explicit compensating size convention or particles render at half extent (this affects the current repo viewer).

Spin:

```text
θ(t) = θ0 + U0·θvary + t·(ω + U1·ωvary)
```

with the seed-based sign rule when `0x200` is active.

Twinkle (WWV `particleEmitter.cpp:86-90,1120-1148`): index the shared 128-entry random table with `(int)(age·twinkleSpeed) + seed` masked to 7 bits; particle suppressed when `TwinklePercent < RandTable[index]`; a second table-derived weight from `twinkleScale` multiplies scale. A periodic duty-cycle blink with random phase is a different algorithm.

Flipbook cells are decomposed with masks and shifts:

```text
column = cell & (columns − 1)
row    = cell >> log2(columns)
```

which assumes a power-of-two column layout — validate grids instead of treating arbitrary dimensions as row-major modulo. Head (`0x20000`) and tail (`0x40000`) are independent geometry flags; both set → two quads. Tail length `τ = tailLength`, or `τ = min(tailLength, age)` with `0x400`; tail geometry follows projected velocity with a small near-zero-velocity fallback. A tail particle is not a rotated square billboard. Authored head/tail cell tracks take precedence over invented `age·cellCount` playback.

## 9. Multitexture, TXAC, EXP2

### Index packing

```ts
if (flags & 0x10000000) {
  indices = [raw & 31, (raw >>> 5) & 31, (raw >>> 10) & 31];   // three 5-bit fields + pad
} else {
  indices = [raw];   // full uint16
}
```

The current repo parser applies the 5-bit mask unconditionally, rejecting valid non-multitexture indices above 31.

### TXAC ownership

For the examined layout, material pairs precede particle pairs:

```ts
materialTXAC[i] = pairAt(i);
particleTXAC[j] = pairAt(materialCount + j);
```

Any "extra TXAC entry" interpretation must be replaced with this split before investigating shader selection — some previously reported particle controls may actually belong to materials. (Reference (WWV) `m2Geom.cpp` split; relayed via G1.)

### Particle pixel equations

| Pixel ID (WWV shader) | Combination |
| ---:| --- |
| 0 `particle_mod` | `T1·Cp` |
| 1 `particle_2colortex_3alphatex` | RGB `T1.rgb·T2.rgb·Cp.rgb`; alpha `T1.a·T2.a·T3.a·Cp.a` |
| 2 `particle_3colortex_3alphatex` | `T1·T2·T3·Cp` |
| 3 `particle_3colortex_3alphatex_UV` | multiplication as 2 but **UV behavior explicitly incomplete** (upstream TODO) |
| 4 `Refraction` | branch currently begins with unconditional `discard` |

Then:

```glsl
rgb   *= EXP2.colorMult;
alpha *= EXP2.alphaMult;
```

Selection depends on MultiTexture, the three-color flag (`0x40000000` → `_0x20`), and TXAC — never on a runtime texture count (WWV `particleEmitter.cpp:108-124,198-248`): with MultiTexture and zero TXAC, the three-color flag picks the three-RGB path, otherwise the two-RGB/three-alpha path; nonzero TXAC can select the incomplete UV variant (with material `_0x20`, else fallback + "Uncompatible particle emitter" log). `0x20000000` populates `_0x10` but is not tested by the selector.

There is **no blend-mode-derived `colorMult = 4`** anywhere: the only literal `*4.0` sits in the dead refraction branch. Read the actual EXP2 multipliers; the chunk name does not imply an `exp2()` call.

### Scrolling parameters

`multiTextureParam0/1` are signed fixed-point 6.9 vectors. A sign-magnitude interpretation:

```ts
fp69 = (raw & 0x8000 ? -1 : 1) * (raw & 0x7fff) / 512;
fp25 = (raw & 0x80   ? -1 : 1) * (raw & 0x7f)   / 32;
```

The examined WWV C++ conversion (`((x&0x1ff)/512)+(x>>9)`, negate on `0x8000`) includes the sign bit in its magnitude before negating, so negative inputs disagree with sign-magnitude (e.g. `0x8200`: sign-magnitude says −1, the WWV converter produces a different value). Build dedicated negative-input differential fixtures before choosing a convention. Per UV channel:

```text
initial offset = random [0,1) vec2
velocity       = param0 + param1·U
offset         = fract(offset + velocity·dt)
uv             = localQuadUV·multiTextureScale + offset
```

### EXP2 record (28 bytes)

```text
00 float zSource
04 float colorMult
08 float alphaMult
0C M2PartTrack<fixed16> alphaCutoff
```

In the examined animation paths, EXP2's static zSource can replace the old animated field — preserve that ownership rule instead of rejecting nonzero EXP2 values.

### Alpha thresholds (particles — distinct from mesh rules)

```text
blend 0: threshold −1
blend 1: 128/255 (0.501960814)
others:  1/255  (0.0039215689)
```

Strict below-threshold comparisons; the shader tests sampled primary-texture alpha, then final alpha, then the per-particle lifetime cutoff (WWV `m2ParticleShader.frag.slang:48-50,96-100`).

### Refraction

A real refraction path needs a previously rendered scene-color texture, usually scene depth, an authored distortion interpretation, and an ordered compositing pass. The reference's dead code after `discard` is not a complete implementation. Keep the capability **Unresolved** or label any approximation a preview.

## 10. Ribbon emitters

### Record layout (`0xB0`, verified against the audited ribbons)

```text
00 ID                       74 edges/second
04 bone                     78 lifetime
08 position                 7C gravity
14 texture-index array      80 rows
1C material-index array     82 columns
24 color track              84 texture-slot track
38 alpha track              98 visibility track
4C height-above track       AC priority plane
60 height-below track       AE color index
                            AF texture-transform lookup index
```

Build evidence: three `4329984` records were independently checked at the expected 176-byte spacing in the audited asset.

**Multiple ribbon textures do not imply one three-texture combiner.** The reference constructs material passes with one texture per material (WWV `CRibbonEmitter.cpp:90-145`); implement the actual material/texture association instead of multiplying all textures or rendering only the first pass.

### Ring-buffer algorithm (WWV `CRibbonEmitter.cpp:783-843,564-638`)

Initialization:

```ts
rate     = ceil(edgesPerSecond);
lifetime = max(authoredLifetime, 0.25);
capacity = ceil(rate * lifetime) + 2;   // edge slots, two vertices per edge
```

Update: expire edges beyond lifetime → integrate live edges → accumulate `dt·rate` (if enabled) → emit whole edges at interpolated subframe positions → keep the fractional remainder → refresh a zero-advance current endpoint edge → rebuild the live strip/ring index range. Stopping emission does not immediately erase existing edges.

Cross-sections use transformed local axes, including a vertical vector derived from a matrix column:

```text
P_below = P − h_b·V;   P_above = P + h_a·V
```

Interpolation includes a direction-dependent correction between previous and current cross-sections — not straight interpolation of two centers. A universal "add height on native Z" is not equivalent for arbitrary ribbon orientations.

### Gravity and UV aging

Reference ribbon gravity (WWV `CRibbonEmitter.cpp:671-689`):

```text
Δz = 2·g·age·dt + g·dt²     // accumulated displacement g·age², not ½g·age²
```

Do not "correct" the coefficient without reinterpreting the authored field. Per tile:

```text
u = column/columns + (age/lifetime)·(1/columns)
```

V stays on the tile's two opposing boundaries; UV aging continues after emission stops. The current repo viewer computes the along-coordinate from a capped head time — a plausible contributor to late-life differences, not proof of any specific artifact.

Known upstream inconsistency: CPU `Initialize` declares `(rows, cols)` while `m2Object.cpp:2293-2300` passes `(textureCols, textureRows)`; the GPU packer uses the record names directly (`M2GpuAnimData.cpp:418-432`). Nonsquare atlases will reveal which behavior you inherited — test with a nonsquare fixture before choosing.

## 11. Unresolved items specific to this document

- TXAC's complex particle-UV variant (shader ID 3 TODO upstream).
- Refraction (dead branch only).
- Geometry/recursion emitters and type 4 (Bone) — named but unimplemented in the reference.
- Client RNG seeding and exact update cadence (the 0.1 s step split and 30 ms burst timer are reference behaviors, not established client constants).
- `multiTextureParam` fixed-point sign convention (two candidate interpretations).
- Whether the burst timer interval and follow-vector overwrite quirks are client behavior or WWV bugs.
