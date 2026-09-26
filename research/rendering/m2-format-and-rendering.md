# M2 Format and Native Rendering

Research date: **2026-09-26**. Statement classes are defined in the [directory index](README.md). This document covers the container/chunk model, geometry and animation structures, the material/shader contract, and rendering policy for a browser viewer.

## 1. Architecture decision: native M2 vs GLB

**Policy — render native M2/SKIN/SKEL/ANIM in production; keep GLB only as a migration bridge.**

Reasons (Format/Reference, not preference):

- A glTF `MeshStandardMaterial` cannot express the M2 rendering contract: fixed-function-style pixel combiners (§7), the raw 0–7 blend table (§8), texture weight/transform indirection per batch, and per-batch combiner alpha. Searching for "correct WoW roughness/metalness" cannot reconstruct those combiners.
- The exporter's M2 path does not implement M2 particles or ribbons at all (Reference (wow.export): `M2Loader` comments out ribbon/particle emitter pointers, `src/js/3D/loaders/M2Loader.js:363-368`; no particle/ribbon draw path exists in `M2RendererGL`).
- The GLB export lacks exact attachment records; the browser substitutes attachment-like bone origins and bounds-derived positions, which cannot reproduce authored attachment offsets (Build evidence + Repo).

Migration bridge: before native character loading is complete, the GLB character may swap its PBR response for a restrained non-PBR diffuse shader while keeping geometry, textures, skinning, and clips. That path must stay labeled "GLB compatibility", not native parity. (Policy.)

Keep three.js for resource ownership, cameras, matrices, controls, geometry, render targets. Use custom M2 materials rather than translating into `MeshStandardMaterial`. (Policy.)

## 2. Coordinate convention

**Policy — keep parsed spatial data in native M2 coordinates and convert once, at the scene boundary:**

```text
(x, y, z)_M2 -> (x, z, -y)_three
```

This is a proper rotation (equivalent to Rx(-pi/2), det = +1); native +Z (up) maps to three.js +Y. Requirements:

```text
native +X -> three +X
native +Y -> three -Z
native +Z -> three +Y
inverse(A(A(p)) = p
```

Two rules that prevent classic mistakes:

- Apply the conversion consistently to meshes, normals, bones, velocities, gravity, attachment matrices, and source trajectories. The current viewer's effect conversion `[x, -z, y]` (Repo: `web/src/GenuineModelScene.tsx` effect placement) is the opposite rotation and maps native +Z downward; do not "fix" it in isolation while compensating transforms remain elsewhere.
- **UV data is not spatial.** Do not apply the axis conversion to texture translation/scale/quaternion values.
- Do not re-apply the conversion to a GLB that the exporter already converted.

## 3. Container model: chunks and offset ownership

Chunk header (Format):

```c
struct ChunkHeader {
    char     fourcc[4];
    uint32_t payloadSize;  // little-endian
};
```

`MD21` contains an inner `MD20` model payload. **Offsets inside that payload are relative to the inner MD20 payload, not the outer file.** (Format; Reference (wow.export) `src/js/3D/loaders/M2Loader.js:332-374` parses relative to the MD21 body.)

| Chunk | Meaning | Reference |
| --- | --- | --- |
| `MD21` | Main model payload (inner MD20) | wow.export `M2Loader.js:42-60` |
| `SFID` | Primary + additional LOD SKIN FileDataIDs (one per view + LODs) | wow.export `M2Loader.js:271-284` |
| `TXID` | Texture FileDataIDs, one uint32 per texture | wow.export `M2Loader.js:287-295` |
| `AFID` | Animation ID/variation → ANIM FileDataID (§5) | wow.export `M2Loader.js:312-327` |
| `SKID` | External skeleton FileDataID | wow.export `M2Loader.js:297-302` |
| `BFID` | Bone-file IDs; parsed as metadata. The inspected preview renderer does **not** load bones through it — treat as stored metadata, not active runtime use | wow.export `M2Loader.js:304-310` |
| `TXAC` | Texture-alpha controls: material pairs followed by particle pairs (see [particles-and-ribbons.md](particles-and-ribbons.md#txac-ownership)) | Reference (WWV) `m2Geom.cpp` split |
| `EXP2` | Extended particle records (zSource/colorMult/alphaMult/alphaCutoff) | particles doc |
| `PGD1` | Particle geoset data | — |
| `EDGF` | Edge-fade-related extension; field semantics **Unresolved** | Build evidence (probe found active `flags2 = 0x8`) |
| Others (`LDV1`, `DETL`, `DBOC`, …) | Retain with capability/provenance; do not reject the model over inert chunks | Policy |

A nested descriptor living inside MD21 does **not** imply its final key payload is inside MD21: external ANIM/SKEL payloads own their own bytes, and animation track offsets must be validated against the owning payload (§5). The current repo parser validates all animation payloads against the main model, which cannot support external character animations (Repo: `web/src/nativeM2.ts` animation handling).

### Fundamental array/track structures (Format)

```c
struct M2Array { uint32_t count; uint32_t offset; };              // 8 bytes
struct M2Track {
    uint16_t interpolation;      // 0 step, 1 linear, 2 Hermite, 3 Bezier
    int16_t  globalSequence;     // -1 = sequence-local
    M2Array  timestampArrays;    // array of M2Array<uint32_t>
    M2Array  valueArrays;        // array of M2Array<T>
};                                                                // 20 bytes
struct M2PartTrack { M2Array timestamps; M2Array values; };       // 16 bytes (uint16 lifetime positions)
```

## 4. MD20 header offsets (retail profile)

All offsets hexadecimal, relative to the inner MD20 payload (Format; cross-checked against wow.export `M2Loader.js:332-374` and the repo parser):

| Offset | Field |
| ---:| --- |
| `00` | Magic |
| `04` | Version |
| `08` | Name array |
| `10` | Global flags |
| `14` | Global sequence durations |
| `1C` | Sequences |
| `24` | Sequence lookup |
| `2C` | Bones |
| `34` | Key-bone lookup |
| `3C` | Vertices |
| `44` | Skin-profile count (uint32) |
| `48` | Colors |
| `50` | Textures |
| `58` | Texture-weight tracks |
| `60` | Texture transforms |
| `68` | Replaceable-texture lookup |
| `70` | Materials |
| `78` | Bone lookup/combinations |
| `80` | Texture lookup/combinations |
| `88` | Texture-unit lookup |
| `90` | Texture-weight lookup |
| `98` | Texture-transform lookup |
| `A0` | Bounding box (6 floats) |
| `B8` | Bounding radius |
| `BC` | Collision box |
| `D4` | Collision radius |
| `D8`,`E0`,`E8` | Collision triangles, vertices, normals |
| `F0`,`F8` | Attachments and attachment lookup |
| `100` | Events |
| `108` | Lights |
| `110`,`118` | Cameras and camera lookup |
| `120` | Ribbons |
| `128` | Particles |
| `130` | Optional blend-map array when global flag `0x8` is set |

Header size is `0x130`, or `0x138` with the optional blend-map array. The optional blend-map data must not be assumed inert on every model: preserve it and gate active combinations until the associated resolver is implemented. (Format + Policy.)

## 5. Bones, sequences, vertices, external animation

### Bone record: `0x58` bytes (Format)

```text
00 i32       keyBoneId
04 u32       flags
08 i16       parentBone
0A u16       submesh/distance-related field
0C u32       name CRC / compression-related union
10 Track     translation, vec3
24 Track     rotation, compressed quaternion
38 Track     scale, vec3
4C vec3      pivot
```

Bone flags (Format; billboard flags are **bone** flags — identical numeric values in particle flags are unrelated):

| Bit | Meaning |
| ---:| --- |
| `0x8` | Spherical billboard |
| `0x10` | Cylindrical billboard, X locked |
| `0x20` | Cylindrical billboard, Y locked |
| `0x40` | Cylindrical billboard, Z locked |
| `0x200` | Transformed |
| `0x400` | Kinematic/physics-related |
| `0x1000` | Helmet-animation scaling-related |

Any valid acyclic parent hierarchy must be accepted. Requiring every parent index to be smaller than its child is stronger than the format needs; a DFS with visiting/visited states detects cycles without imposing serialization order. (Policy, correcting the current repo parser.)

### Sequence record: `0x40` bytes (Format)

```text
00 u16       animationId
02 u16       variationIndex
04 u32       durationMs
08 float     moveSpeed
0C u32       flags        // 0x20 = in-file data, 0x40 = alias (follow variationNext)
10 i16       frequency
12 u16       padding
14 u32       replayMinimum
18 u32       replayMaximum
1C u32       blendTime
20 float[6]  bounds
38 float     radius
3C i16       variationNext
3E u16       aliasNext
```

The sequence lookup maps an animation ID to a sequence index; **an animation ID is not itself a sequence index.** Retain all fields even when the first implementation uses only ID, variation, duration, aliasing, and data location.

### Vertex record: `0x30` bytes (Format)

```text
00 vec3      position
0C u8[4]     boneWeights   // normalize by 255, not 256
10 u8[4]     boneIndices
14 vec3      normal
20 vec2      UV0
28 vec2      UV1
```

### External ANIM and SKEL resolution (Reference (wow.export))

`AFID` entries are 8 bytes: `uint16 animationId; uint16 variationIndex; uint32 fileDataID`.

Resolution rules (wow.export `M2Loader.js:87-139,146-207`):

1. `sequence.flags & 0x20` set → data lives in the owning MD21/SKEL payload.
2. Otherwise find the AFID entry matching (animationId, variationIndex); a zero fileDataID is skipped.
3. `sequence.flags & 0x40` set → follow `aliasNext` (with cycle/bounds checks) instead of loading external data.
4. ANIM files may be raw or chunked; chunked ANIM can contain `AFM2` (model animation), `AFSB` (skeleton bone animation), `AFSA` (skeleton attachment animation). AFSB bytes take precedence when present, else AFM2; **do not apply AFSB offsets to the outer ANIM header** — patch timestamps/values using the owning payload's offset base.

External skeletons contain (wow.export `SKELLoader.js`):

```text
SKS1  sequences
SKB1  bones
SKA1  attachments
SKPD  parent skeleton (resolve recursively, cycle-checked)
AFID  animation files
BFID  bone-file metadata
```

Do not blindly concatenate parent and child bone arrays. Preload only animations required by the chosen character/spell graph — loading all exported clips for a nine-spell replay is unnecessary. (Policy.)

## 6. Compressed quaternions and interpolation

All four components are stored; there is no omitted-component reconstruction. Two real decoder conventions exist (both references, differing in quantization):

```ts
// wow.export convention (M2Generics.js:69-72), unsigned stored u:
q = (u - 32767) / 32768;

// WoW-Model-Viewer-style piecewise convention (current repo parser, nativeM2.ts:268-276), signed s:
q = (s < 0 ? s + 32768 : s - 32767) / 32767;
```

Identity fixture: `[32767, 32767, 32767, 65535] -> [0, 0, 0, 1]`. Do not mix conventions inside one pipeline; normalize the decoded quaternion. The convention difference is not itself the bug — the real defects in the current viewer are (a) reading **UV-transform rotation values** as 8-byte compressed quaternions when they are four float32 values (16 bytes), and (b) interpolating rotation components without shortest-path handling. See [current-implementation-gaps.md](current-implementation-gaps.md).

Interpolation requires antipodal handling regardless of scheme:

```ts
if (dot(q0, q1) < 0) q1 = negate(q1);
q = normalize(slerp(q0, q1, u));   // nlerp acceptable for close keys, still antipodal-safe
```

Spline interpolation (codes 2 Hermite, 3 Bezier) uses value/tangent triples, not ordinary value strides:

```text
H(u) = (2u^3 - 3u^2 + 1) p0 + (u^3 - 2u^2 + u) m0 + (-2u^3 + 3u^2) p1 + (u^3 - u^2) m1
B(u) = (1-u)^3 p0 + 3u(1-u)^2 c0 + 3u^2(1-u) c1 + u^3 p1
```

Do not automatically multiply stored tangents by the key interval, and do not apply scalar Hermite rules to quaternions. Note the reference itself does not implement every interpolation kind distinctly (wow.export raw bone samplers always lerp vec3 / slerp quat regardless of track mode, `M2RendererGL.js:1212-1269`); treat per-mode evaluation as a project improvement, not established reference behavior.

## 7. Shader selection and pixel combiners

### Vertex shader IDs (both references agree)

| ID | Name | ID | Name |
| ---:| --- | ---:| --- |
| 0 | `Diffuse_T1` | 10 | `Diffuse_T2` |
| 1 | `Diffuse_Env` | 11 | `Diffuse_T1_Env_T2` |
| 2 | `Diffuse_T1_T2` | 12 | `Diffuse_EdgeFade_T1_T2` |
| 3 | `Diffuse_T1_Env` | 13 | `Diffuse_EdgeFade_Env` |
| 4 | `Diffuse_Env_T1` | 14 | `Diffuse_T1_T2_T1` |
| 5 | `Diffuse_Env_Env` | 15 | `Diffuse_T1_T2_T3` |
| 6 | `Diffuse_T1_Env_T1` | 16 | `Color_T1_T2_T3` |
| 7 | `Diffuse_T1_T1` | 17 | `BW_Diffuse_T1` |
| 8 | `Diffuse_T1_T1_T1` | 18 | `BW_Diffuse_T1_T2` |
| 9 | `Diffuse_EdgeFade_T1` | | |

`T1`/`T2` = transformed UV0/UV1; `Env` = environment coordinate. WWV's helpers have incomplete/placeholder behavior for variants 15, 16, 18 — gate those rather than treating them as ordinary diffuse variants. (Reference (WWV) `commonM2Material.slang:303-402`; wow.export `M2RendererGL.js:24-56`.)

### Indexed shader table (36 rows)

If `shaderId & 0x8000`, the low 15 bits index this table (both references; wow.export `ShaderMapper.js:9-46` is the verbatim source):

```text
row : (vertexId, pixelId)
 0:( 3,12)   1:( 3,13)   2:( 3,14)   3:( 6,15)   4:( 3,16)   5:( 7,13)
 6:( 7,16)   7:( 3,17)   8:( 3,18)   9:( 6,19)  10:( 7,20)  11:( 3,21)
12:( 3,22)  13:( 3,23)  14:( 7,23)  15:( 2,20)  16:( 3,24)  17:( 6,25)
18:( 0,26)  19:( 9,33)  20:(11,27)  21:(12, 6)  22:( 2,28)  23:( 7,29)
24:(11,25)  25:(13,33)  26:(14,30)  27:( 2,31)  28:(14,32)  29:( 7,34)
30:(15,35)  31:(16,35)  32:( 0, 0)  33:(12, 7)  34:( 9, 1)  35:(12,36)
```

Build-evidence example: the project's EDGF-probed assets use shader `0x8021` → row 33 → VS 12 (`Diffuse_EdgeFade_T1_T2`) + PS 7 (`Combiners_Mod_Mod2x`). That is a known row, not an unknown shader; the remaining difficulty is edge-fade parameters, not selection.

### Legacy (non-indexed) selection (Reference (wow.export) `ShaderMapper.js:52-141`)

Single texture:

```ts
vs = shaderId & 0x80 ? 1 : shaderId & 0x4000 ? 10 : 0;
ps = shaderId & 0x70 ? 1 : 0;
```

Multiple textures:

```ts
vs = shaderId & 0x80 ? (shaderId & 0x8 ? 5 : 4)
                    : (shaderId & 0x8 ? 3 : shaderId & 0x4000 ? 2 : 7);
ps = shaderId & 0x70
  ? ({ 3: 8, 4: 7, 6: 9, 7: 10 }[shaderId & 7] ?? 6)
  : ({ 0: 5, 3: 13, 4: 3, 6: 4, 7: 13 }[shaderId & 7] ?? 2);
```

The repo's two current mesh cases: `0x0014` (two textures) → VS 7 / PS 7; `0x4014` → VS 2 / PS 7. Do **not** substitute opaque shader 0 for an unknown indexed value — fail visibly instead. (Policy.)

### Pixel combiners (37 IDs; Reference (wow.export) `m2.fragment.shader:83-316`, identical catalog in WWV `commonM2Material.slang:60-265`)

Notation: `M` mesh RGB multiplier; `a,b,c` RGB of textures 1–3; `x,y,z` their alphas; `w1,w2,w3` texture/sample weights; `D` material diffuse; `S` unlit additive term (called `specular` by the references — **not** a physically based specular BRDF); `A` combiner opacity; `mix(p,q,t) = p(1-t)+qt`.

| PS | Name | Equations |
| ---:| --- | --- |
| 0 | Opaque | `D = Ma` |
| 1 | Mod | `D = Ma, A = x` |
| 2 | Opaque_Mod | `D = Mab, A = y` |
| 3 | Opaque_Mod2x | `D = 2Mab, A = 2y` |
| 4 | Opaque_Mod2xNA | `D = 2Mab` |
| 5 | Opaque_Opaque | `D = Mab` |
| 6 | Mod_Mod | `D = Mab, A = xy` |
| 7 | Mod_Mod2x | `D = 2Mab, A = 2xy` |
| 8 | Mod_Add | `D = Ma, S = b, A = x+y` |
| 9 | Mod_Mod2xNA | `D = 2Mab, A = x` |
| 10 | Mod_AddNA | `D = Ma, S = b, A = x` |
| 11 | Mod_Opaque | `D = Mab, A = x` |
| 12 | Opaque_Mod2xNA_Alpha | `D = M·mix(2ab, a, x)` |
| 13 | Opaque_AddAlpha | `D = Ma, S = by` |
| 14 | Opaque_AddAlpha_Alpha | `D = Ma, S = by(1-x)` |
| 15 | Opaque_Mod2xNA_Alpha_Add | `D` as 12; `S = czw3` |
| 16 | Mod_AddAlpha | `D = Ma, S = by, A = x` |
| 17 | Mod_AddAlpha_Alpha | `D = Ma, S = by(1-x), A = x+y·dot(b,(.30,.59,.11))` |
| 18 | Opaque_Alpha_Alpha | `D = M·mix(mix(a,b,y), a, x)` |
| 19 | Opaque_Mod2xNA_Alpha_3s | `D = M·mix(2ab, c, z)` |
| 20 | Opaque_AddAlpha_Wgt | `D = Ma, S = byw2` |
| 21 | Mod_Add_Alpha | `D = Ma, S = b(1-x), A = x+y` |
| 22 | Opaque_ModNA_Alpha | `D = M·mix(ab, a, x)` |
| 23 | Mod_AddAlpha_Wgt | `D = Ma, S = byw2, A = x` |
| 24 | Opaque_Mod_Add_Wgt | `D = M·mix(a,b,y), S = axw1` |
| 25 | Opaque_Mod2xNA_Alpha_UnshAlpha | `h = clamp(zw3)`; `D = M·mix(2ab,a,x)(1-h), S = ch` |
| 26 | Mod_Dual_Crossfade | nested RGBA mix (below); `D = Mq.rgb, A = q.a` |
| 27 | Opaque_Mod2xNA_Alpha_Alpha | `D = M·mix(mix(2ab,c,z), a, x)` |
| 28 | Mod_Masked_Dual_Crossfade | as 26 with `A = q.a·t4.a` |
| 29 | Opaque_Alpha | `D = M·mix(a,b,y)` |
| 30 | Guild | `D = M·mix(a·mix(g0,bg1,y), cg2,z), A = x` |
| 31 | Guild_NoBorder | `D = Ma·mix(g0,bg1,y), A = x` |
| 32 | Guild_Opaque | RGB as 30; opaque combiner alpha |
| 33 | Mod_Depth | color equation as Mod; depth semantics separate |
| 34 | Illum | incomplete in the references; not a recovered shader |
| 35 | Mod_Mod_Mod_Const | `q = t1t2t3g0`; `D = Mq.rgb, A = q.a` |
| 36 | Mod_Mod_Depth | `D = Mab, A = xy`; depth semantics separate |

The crossfade value (26/28):

```glsl
vec4 q = mix(mix(t1, t2, clamp(weights.g, 0.0, 1.0)), t3, clamp(weights.b, 0.0, 1.0));
```

Reference quirks to preserve deliberately: the shader special-cases pixel IDs 26–28 by forcing UV2/UV3 to UV1, and the standalone exporter fragment path comments out its generated additive term (`m2.fragment.shader:64-68,350-353`). A parity-oriented renderer must **not** reproduce the commented-out additive term.

## 8. Blend modes and alpha testing

Raw M2 blend 0–7 maps to GL factors as follows (Reference (wow.export) `M2RendererGL.js:91-100` + `GLContext.js:248-338`; Reference (WWV) `GDeviceGL33.cpp:29-45` agrees on every overlapping row):

| Raw M2 | Name | GL RGB (src, dst) | GL alpha (src, dst) | Depth write |
| ---:| --- | --- | --- | --- |
| 0 | Opaque | blending disabled | — | on |
| 1 | AlphaKey | blending disabled; shader discard | — | on |
| 2 | Alpha | `SRC_ALPHA`, `ONE_MINUS_SRC_ALPHA` | `ONE`, `ONE_MINUS_SRC_ALPHA` | off |
| 3 | NoAlphaAdd | `ONE`, `ONE` | `ZERO`, `ONE` | off |
| 4 | Add | `SRC_ALPHA`, `ONE` | `ZERO`, `ONE` | off |
| 5 | Mod | `DST_COLOR`, `ZERO` | `DST_ALPHA`, `ZERO` | off |
| 6 | Mod2x | `DST_COLOR`, `SRC_COLOR` | `DST_ALPHA`, `SRC_ALPHA` | off |
| 7 | BlendAdd | `ONE`, `ONE_MINUS_SRC_ALPHA` | `ONE`, `ONE_MINUS_SRC_ALPHA` | off |

The wow.export EGx indices for raw 0–7 are `[0,1,2,10,3,4,5,13]` — raw M2 7 is **not** EGx 7 (EGx 7 is `InvSrcAlphaAdd` = `ONE_MINUS_SRC_ALPHA, ONE`, which is what the current repo viewer implements by mistake). Extended EGx table (both references):

| EGx | Name | RGB (src, dst) | Alpha (src, dst) |
| ---:| --- | --- | --- |
| 6 | ModAdd | `DST_COLOR`, `ONE` | `DST_ALPHA`, `ONE` |
| 7 | InvSrcAlphaAdd | `ONE_MINUS_SRC_ALPHA`, `ONE` | same |
| 8 | InvSrcAlphaOpaque | `ONE_MINUS_SRC_ALPHA`, `ZERO` | same |
| 9 | SrcAlphaOpaque | `SRC_ALPHA`, `ZERO` | same |
| 11 | ConstantAlpha | `CONSTANT_ALPHA`, `ONE_MINUS_CONSTANT_ALPHA` | same |
| 12 | Screen | `ONE_MINUS_DST_COLOR`, `ONE` (WWV) / `ONE`, `ONE_MINUS_SRC_COLOR` (wow.export) | `ONE`, `ZERO` (WWV) |
| 13 | BlendAdd | `ONE`, `ONE_MINUS_SRC_ALPHA` | same |

The single EGx 12 discrepancy between the two references is unresolved here; neither is client proof. Do not rely on three.js `AdditiveBlending` without checking its separate alpha factors and premultiplication configuration.

Alpha testing (references):

- Mesh AlphaKey tests combiner alpha against approximately `128/255` (wow.export sets `u_alpha_test = 0.501960814`).
- Opaque and AlphaKey use mesh opacity as the final output opacity; other mapped modes generally use combiner alpha × mesh opacity; blend 13 uses `discard_alpha × mesh_opacity`.
- wow.export additionally discards low-alpha pixels for MOD/MOD2X when the combiner marked `can_discard` — a compatibility difference beyond WWV; preserve it as such, do not impose a universal discard rule.
- Particle thresholds differ (see [particles-and-ribbons.md](particles-and-ribbons.md#alpha-thresholds-particles--distinct-from-mesh-rules)).

BlendAdd has the factors often used for premultiplied alpha, but the shader must still follow the actual source-color equation — do not multiply RGB by alpha a second time.

## 9. UV transforms and environment coordinates

**UV rotation values are four float32 values (16 bytes), not compressed quaternions.** UV coordinates are not spatial coordinates; the M2→three axis conversion must not be applied to them. (Format; the current repo parser gets both wrong — see gaps doc.)

Texture-center rotation is part of the documented transform, and the exporter composes operations in this order (Reference (wow.export) — convention, not independently verified retail behavior):

```text
M_uv = [T(c) R T(-c)] · [T(c) S T(-c)] · T(t),   c = (0.5, 0.5, 0)
```

Replacing this with `uv * scale + translation` is not equivalent. Store the chosen convention in the renderer profile and test nonzero rotation+scale+translation together.

Environment coordinate function (Reference (WWV) `commonM2Material.slang` family):

```glsl
vec3 r = reflect(normalize(viewPosition), normalize(viewNormal));
vec3 q = vec3(r.xy, r.z + 1.0);
vec2 envUV = vec2(0.5) - 0.5 * normalize(q).xy;
```

Generic edge-fade response:

```glsl
float c = clamp(dot(-normalize(viewPosition), normalize(viewNormal)), 0.0, 1.0);
float edgeFade = clamp(2.7 * c * c - 0.4, 0.0, 1.0);
```

Guard degenerate normalization as an engineering safety measure. The existence of `edgeScan` does **not** establish the field/control semantics of the 32-byte EDGF chunk (Unresolved).

## 10. Render flags, combiner inputs, sorting

Core material flags (Format; both references consume identically):

```ts
lit        = !(flags & 0x01);   // 0x01 set disables lighting
fogged     = !(flags & 0x02);   // 0x02 set disables fog
twoSided   =  (flags & 0x04) !== 0;
depthTest  = !(flags & 0x08);   // 0x08 set disables depth test
depthWrite = !(flags & 0x10);   // 0x10 set disables depth write
```

The signs matter: the flags are "disable" bits. The current viewer implements both signs in different paths (see gaps doc).

Resolve per batch: `materialIndex`, `colorIndex`, `textureComboIndex + unit`, `textureWeightComboIndex + unit`, `textureTransformComboIndex + unit`. A negative lookup sentinel must never become an unsigned array index. Texture weights are not all interchangeable opacity multipliers — several combiners (15, 20, 23, 24, 25, 26, 28) use secondary weights for emissive mixing or crossfading.

Sorting policy (Policy): explicit opaque / alpha-test / transparent queues, then deterministic per-pass ordering by signed priority plane, view-space depth where applicable, material layer, and original batch ordinal. A chosen comparator is not proven to be the client comparator until tested against a reference capture. Avoid mutating one shared texture object's wrapping mode for incompatible users — cache bindings by texture identity **and** sampler state.

## 11. Lighting model

The examined C++ lighting function (Reference (WWV) `commonLightFunctions.slang:186-196`) mixes a gamma-domain diffuse term with squared diffuse under accumulated local light:

```text
G = D · (C_ambient + C_sun)
L = D² · C_local
C_out = ( sqrt(G² + L) + E + S ) · AO
```

Componentwise on RGB. This "sqrt gamma/linear diffuse mix" is the important part — it is not a metalness/roughness BRDF. Reusable core:

```glsl
vec3 shadeM2(vec3 diffuse, vec3 ambientAndSun, vec3 accumulatedLocalLight,
             vec3 emissive, vec3 unlitAdd, float ao) {
    vec3 g = diffuse * ambientAndSun;
    vec3 l = diffuse * diffuse * accumulatedLocalLight;
    return (sqrt(max(vec3(0.0), g * g + l)) + emissive + unlitAdd) * ao;
}
```

Exterior ambient decomposition (both references; wow.export `mpv_light.inc.glsl:8-19` is the simple two-argument form):

```text
w_s = max(n·up, 0);  w_g = max(-n·up, 0);  w_h = 1 - w_s - w_g
A = w_s·A_sky + w_h·A_horizon + w_g·A_ground
```

The full WWV function adds interior/exterior blending and precomputed-light adjustments; the wow.export standalone preview uses a fixed hardcoded light instead (direction `(3,-0.7,-2)`, ambient 0.5, diffuse 0.7, `M2RendererGL.js:1506-1514`), and its map viewer resolves real `Light`/`LightParams`/`LightData`/`ZoneLight`/`ZoneLightPoint`/`LightSkybox` rows with time interpolation (`FogDataProvider.js`). These are selectable references; do not conflate them.

## 12. Color-space and post-processing policy

The current scene mixes ACES exposure (`1.08`) with strong PBR lights while particles and meshes do not share one tone-mapping path, making cross-component color comparison unreliable (Repo). Recommended initial policy:

- disable ACES and automatic exposure; disable bloom initially;
- one explicit color-domain convention for textures, combiners, light constants, intermediate targets, and final presentation;
- keep unlit additive contributions out of PBR lighting.

A practical legacy baseline: treat decoded color bytes as display/gamma-domain values during legacy combiner evaluation, use a non-sRGB intermediate target, and present that already-encoded result without a second encode. That is deliberate compatibility policy, **not** proof of the retail HDR pipeline. Retail bloom/glow defaults were not established — do not insert an arbitrary bloom strength and call it a Midnight default. Add post-processing only after the unprocessed material result is correct.

## 13. Texture and GPU pitfalls

- **BC1/BC3 decoding.** Validate block sizes and mip dimensions. BC3 alpha indices occupy 48 bits; JavaScript bitwise operators are 32-bit — use byte extraction or BigInt. BC3 color decoding uses the four-color block rule (no BC1 transparent-color optional rule). Compressed-texture upload is a capability question; keep a tested RGBA fallback.
- **Mipmaps.** The current texture setup disables them (Repo). Reintroduce authored or correctly generated mipmaps only after atlas and alpha-edge behavior is tested, or distant effects shimmer.
- **Bone uploads.** Query uniform-buffer limits; a matrix texture with nearest-integer texel fetch is the practical fallback for large skeletons. Do not assume a fixed maximum bone count.
- **Transparent sorting.** Signed priority planes, material layers, and per-particle depth are separate concerns; `renderOrder = 100 + priorityPlane` alone is not a sorting implementation.
- **Resource bounds.** Do not silently truncate spawn history (the current sampler hard-caps at 4096, `web/src/nativeParticles.ts:246-284`) or clamp capacity while continuing as though everything rendered. Allocate from a validated budget, checkpoint history, report overflow.
- **Attachment history.** Sampling the caster's current hand once and closing over that position for every historical birth time does not reconstruct the hand's past trajectory; the API must sample a complete actor/attachment transform at the requested historical time, including rotation — a translation-only callback is insufficient (Repo: `nativeParticles.ts` `sourceTranslationAtTime` option).

## 14. Unresolved items specific to this document

- Complete EDGF parameter interpretation (32-byte chunk; active `flags2 = 0x8` observed in build evidence, semantics unknown).
- EGx 12 (Screen) factor discrepancy between the two references.
- PS 34 (Illum) complete behavior; BW vertex variants 15/16/18 semantics.
- Whether the wow.export UV-matrix multiplication order matches the client.
- Retail post-processing defaults.
