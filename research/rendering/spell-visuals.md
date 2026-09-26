# Spell Visual Data Graph and Scheduling

Research date: **2026-09-26**. Statement classes are defined in the [directory index](README.md). Schema shapes are Format (WoWDBDefs, build-69933 layouts were readable during the research pass); the component inventory is Build evidence from the project's 2026-09-25 audit relayed via G1; scheduling is Policy. Neither reference repository implements spell-visual resolution (WWV contains no `SpellVisual`/missile logic at all).

## 1. Typed graph

```text
Spell ID
  → SpellXSpellVisual (alternatives + conditions)
      → SpellVisual
          → SpellVisualEvent rows
              → SpellVisualKit
                  → SpellVisualKitEffect (Effect is a TYPED foreign key, not always a FileDataID)
                      → typed effect target
          → missile set
              → SpellVisualMissile rows
                  → SpellVisualEffectName → M2 FileDataID
                  → SpellMissileMotion
                  → positioner / attachment data
```

A `SpellVisualKitEffect.Effect` value indexes a family by `EffectType` (§4) — treating every value as a model FileDataID is wrong. The relation back to the kit is `ParentSpellVisualKitID`.

The build-69933 `SpellVisualKit` schema contains clutter/fallback/delay/density-filter/flags fields. Historical `COLUMNS` entries for old layouts must not be mistaken for current fields: do not build a modern scheduler around old monolithic kit-animation fields just because they appear in a schema file's union of names.

## 2. SpellXSpellVisual conditions

Preserve from each alternative row: `SpellID`, `SpellVisualID`, caster player/unit conditions, viewer player/unit conditions, difficulty, priority, probability, flags.

Build evidence: the audit leaves conditional branches unresolved for Lightning Shield, Lava Burst, and Lightning Bolt. A condition ID such as `52517` is not a spell ID and cannot be interpreted from its numeric value.

Evaluate conditions three-valued (Policy):

```ts
type ConditionResult = "true" | "false" | "unknown";
```

If required context is unknown, retain the alternatives. An explicit preview choice is acceptable; silently taking the first CSV row and calling it the retail result is not.

## 3. StartEvent/EndEvent: the exact unresolved boundary

The build-69933 schema establishes these `SpellVisualEvent` fields: `StartEvent`, `EndEvent`, `StartMinOffsetMs`, `StartMaxOffsetMs`, `EndMinOffsetMs`, `EndMaxOffsetMs`, `TargetType`, `SpellVisualKitID`, two still-unnamed fields, and the `SpellVisualID` relation.

It does **not** establish the semantic integer enum. No sufficiently supported complete numeric mapping was found during the research pass. Do not ship invented declarations such as:

```ts
// NOT established:
enum RetailStartEvent { CastStart = 0, CastFinish = 1, Impact = 2 }
```

Separate raw DB values from semantic scheduling (Policy):

```ts
type VisualPhase =
  | "prepare" | "castStart" | "castFinish" | "missileStart" | "impact"
  | "auraGain" | "auraLoss" | "channelStart" | "channelStop";

interface ResolvedVisualEvent {
  sourceRowId: number;
  rawStartEvent: number;
  rawEndEvent: number;
  phaseBinding: { start: VisualPhase; end?: VisualPhase; evidence: string } | null;
}
```

A prepared, verified row-to-phase adapter is the safe boundary for supported spells; unresolved rows stay unresolved rather than being assigned timing from their appearance.

## 4. SpellVisualKitEffect type catalog

Community interpretation from WoWDBDefs comments (Format-as-documented; uncertain rows marked):

| EffectType | Referenced family |
| ---:| --- |
| 1 | `SpellProceduralEffect` |
| 2 | `SpellVisualKitModelAttach` |
| 3 | `CameraEffect` |
| 4 | Camera-related — **incompletely identified** |
| 5 | `SoundKit` |
| 6 | `SpellVisualAnim` |
| 7 | `ShadowyEffect` |
| 8 | `SpellEffectEmission` |
| 9 | `OutlineEffect` |
| 10 | Possibly unit sound — **unresolved** |
| 11 | `DissolveEffect` |
| 12 | `EdgeFlowEffect` |
| 13 | `BeamEffect` |
| 14 | `ClientSceneEffect` |
| 15 | `CloneEffect` |
| 16 | `GradientEffect` |
| 17 | `BarrageEffect` |
| 18 | `RopeEffect` |
| 19 | `SpellVisualScreenEffect` |

For model attachments (type 2), preserve: effect-name ID, attachment, offsets, orientation and variation, scale and variation, positioner IDs, animation controls, delays. Do not collapse multiple attachment rows that reference the same M2 — they can be two hands or separate passes. `SpellProceduralEffect.Type/Value` needs its own interpreter: a row's existence does not establish how its values modify anything; keep unsupported procedural effects in the graph and capability report.

## 5. Caster animation selection

Generic animation IDs (community-documented):

| Animation | ID |
| --- | ---:|
| Stand | 0 |
| ReadySpellDirected | 51 |
| ReadySpellOmni | 52 |
| SpellCastDirected | 53 |
| SpellCastOmni | 54 |
| ChannelCastDirected | 124 |
| ChannelCastOmni | 125 |

The repo's current class-specific clip choices (828, 830, 862, 1122, 1148, 1448 in `web/src/GenuineModelScene.tsx`) are a viewer choice, not a verified DB2 selection. Animation ID `213` is `CustomSpell01` in the examined mapper; selecting it because it is the first sequence with nonzero alpha does not establish the retail lifecycle of component `4290517`.

The modern `SpellVisualAnim` schema includes initial animation, loop animation, and AnimKit association; AnimKit segments add ordering, start/end conditions, delays, playback speed, variation, loops, and blend controls. Implement that structure instead of reducing every kit to one animation ID. Recommended phase behavior (Policy):

```text
cast start      → initial/precast animation, then ready/loop
cast finish     → release animation
channel start   → channel initial/loop
channel stop    → terminate/transition
instant spell   → release animation without a fabricated cast interval
background proc → no foreground caster restart unless explicitly required
```

Directed vs omni selection comes from resolved visual animation data and target semantics — spell school is not a sufficient selector.

## 6. Build-specific component inventory (build `12.1.0.69933`)

Build evidence from the project audit (relayed via G1; not re-extracted from a fresh dump for this document):

| Spell | Source-linked components / graph |
| --- | --- |
| Flametongue Weapon `318038` | Caster component `4006618` |
| Lightning Shield `192106` | Conditional visual `39810`, component `1598036` |
| Stormkeeper `191634` | Kits `65260`/`65268`; components `1355634`/`1284864` |
| Ancestral Swiftness `443454` | Visual `152381`, kit `217060`; component `4290517`, plus `5795726`/`5795727` through attachment rows |
| Ascendance `1219480` | Caster component `1109885` |
| Lava Burst `51505` | Visual alternatives `182304`/`70637`; missile set `24102`; cast `4006621`; missile `4329984` plus omitted `3980281`; impact `4006618`/`3980244` |
| Lightning Bolt `188196` | Visual alternatives `155029`/`155036`/`156513`; cast `6211618`; missile `6211617`; impact `1571475` |
| Flame Shock `188389` | Target components `4006618`, `3980244`, `4392095`, `4050773` |
| Elemental Blast `117014` | Visual `182369`, missile set `24108`; `4329984`, `794788`, `613807`, omitted `3980281` |

Authored Elemental Blast scales are `1.4`, `2`, `1`, `1.4` — component scales, not permission for unrelated per-spell viewer scale factors. Stormkeeper's two attachment rows both use attachment 22; the `1284864` row includes offset `(0, 0.15, 0)`.

Attachment IDs in the audit: `21` SpellLeftHand, `22` SpellRightHand, `34` Chest, `19` Base. These are attachment IDs, not key-bone IDs.

**Ancestors are separate actors.** Rendering `5795726`/`5795727` correctly does not prove either is the summoned ancestor's creature model — the audit did not establish that connection, and the log confirms real ancestor summons without identifying their models (see [simc-synchronization.md](simc-synchronization.md#5-ancestor-identity)). Do not substitute the `4290517` flash as an ancestor body or launch ancestor projectiles from the player merely because the pet model is unresolved.

## 7. Missiles and impact timing

Timing precedence (Policy):

```text
observed hit time
  > logged travel schedule
  > explicitly verified spell timing data
  > labeled preview timing
```

For a matched occurrence:

```text
t_release = t_perform
t_impact  = t_travelSchedule + Δt_travel
```

reconciled against the observed hit. Do not add an arbitrary release delay (the current viewer applies a fixed 0.2 s release) on top of a logged completed execution.

Missile rows identified by the audit:

- Lava Burst rendered body: missile row `28854`, attachment 34, motion 0.
- Elemental Blast bodies: rows `28867`–`28869`, attachments 21/22/34, motions 2967/2969/2968.
- Lightning Bolt alternatives: row `25628` with Base attachment and offset `(-7, 0, 5)`, or row `28845` using positioner 513.
- Elemental Blast impact positioner 712.
- Shared omitted body `3980281`: attachment `-1`, no supplied positioner resolution.

`-1` is a sentinel requiring interpretation; it is not proof that an asset has no origin, and must not be equated with Chest or Base without evidence.

Simple preview trajectory (Policy, labeled as such):

```text
u = clamp((t − t_r)/(t_i − t_r), 0, 1)
P(t) = mix(P_r, P_i, u)
```

If implementing `SpellMissileMotion` scripts, use a restricted interpreter with explicit variables, units, and coordinate conventions — never `eval` downloaded script text. A candidate reading of `transFront/transMag/transAngle` as forward/radial offsets is not enough to claim native motion; script bodies, axis conventions, scale scheduling, and positioner semantics all need separate verification (Unresolved).

Stop missile emission at the resolved arrival event, spawn impact components there, and let already-emitted particles/ribbons expire by their own lifetimes. An impact is not "the cast effect moved to the target".

## 8. Scheduler contract (Policy)

```ts
interface SpellOccurrence {
  id: string;
  actorId: string;
  actionName: string;
  spellId: number;
  castStart: number | null;
  castFinish: number;
  impacts: ImpactOccurrence[];
  parentOccurrenceId: string | null;
  foreground: boolean | null;
  provenance: EventProvenance;
}
```

Compile visual instances from semantic phases:

```text
onCastStart:          start precast/casting kit; start caster preparation animation
onCastFinish:         stop/transition casting kit; play release animation; create missile instances
onImpact:             stop arriving missile's emission; create target impact kit
onAuraGainOrStack:    create/update persistent state kit
onAuraLoss:           terminate state emission; play applicable ending state
```

Sample authored delay ranges deterministically per event occurrence; preserve negative offsets where the schema permits them — do not blindly clamp every offset to zero. The phase scheduler can be implemented now; the raw DB event-enum adapter (§3) must remain a separately verified module.

## 9. Unresolved items specific to this document

- `SpellVisualEvent` numeric event/target semantics (§3) — the central gap.
- Complete Positioner and `SpellMissileMotion` execution semantics.
- Summoned ancestor model selection (DB2 side).
- Condition-ID interpretation for the Lightning Shield / Lava Burst / Lightning Bolt alternative branches.
- EffectType 4 and 10 identification.
