# SimulationCraft Replay Synchronization

Research date: **2026-09-26**. Statement classes are defined in the [directory index](README.md). Engine facts are Reference (SimC) at the pinned commit `1e0751c16d04df565bea9d7c4ac228f9cc4b0e46` (the `simc/` checkout). All timing facts below were **re-verified by grep against the local log** `.local/results/log-demo/log.txt` (2117 lines, full 45.000 s run; Log evidence) — line numbers in this document refer to that file. The current browser replay (`web/src/replay.ts`) parses JSON-v2 action sequences, which carry no travel/impact times; this document specifies what the text log adds.

## 1. The local verification log

Produced by the pinned engine with:

```text
.local/simc-build/simc ptr=0 item_db_source=local iterations=1 threads=1
  target_error=0 fixed_time=1 vary_combat_length=0 max_time=45
  fight_style=Patchwerk desired_targets=1 seed=20260925 log=1
  output=.local/results/log-demo/log.txt simc/profiles/MID2/MID2_Shaman_Elemental.simc
```

Event counts in the full log: 264 `performs`, 213 `schedules execute`, 212 `schedules travel`, 261 `hits`. Combat ends at 45.000 s.

## 2. Log line formats

Emitters verified in the pinned engine source:

| Line | Engine source |
| --- | --- |
| `performs` | `simc/engine/action/action.cpp:1830-1835` |
| `schedules execute` | `simc/engine/action/action.cpp:2246-2251` |
| `schedules travel` | `simc/engine/action/action.cpp:4446-4451` |

The `log_spell_id` option (registered `simc/engine/sim/sim.cpp:3922`) appends spell IDs to action and buff lines; the local log was produced with it enabled.

Representative lines (verbatim from the local log, with file line numbers):

```text
 92: 0.000 Player 'MID2_Shaman_Elemental_Farseer' performs Action 'lava_burst_asc' (51505) (275000)
 93: 0.000 Player 'MID2_Shaman_Elemental_Farseer' schedules travel (0.600) for Action 'lava_burst_asc' (51505)
116: 0.600 Player 'MID2_Shaman_Elemental_Farseer' Action 'lava_burst_asc' (51505) hits Enemy 'Fluffy_Pillow' for 127492.416185 fire damage (crit)
121: 0.935 Player 'MID2_Shaman_Elemental_Farseer' schedules execute for Action 'lava_burst' (51505)
122: 0.935 Player 'MID2_Shaman_Elemental_Farseer' performs Action 'lava_burst' (51505) (275000)
123: 0.935 Player 'MID2_Shaman_Elemental_Farseer' schedules travel (0.600) for Action 'lava_burst' (51505)
150: 1.535 Player 'MID2_Shaman_Elemental_Farseer' Action 'lava_burst' (51505) hits Enemy 'Fluffy_Pillow' for 127492.416185 fire damage (crit)
169: 1.777 Player 'MID2_Shaman_Elemental_Farseer' consumes 500 mana for Action 'lightning_bolt' (188196) (274500)
340: 5.402 Player 'MID2_Shaman_Elemental_Farseer' gains Buff 'casting' (0) (stacks=1) ...
```

Parsing notes:

- **The parenthesized number after `performs` is the actor's current primary resource, not a cast duration.** In line 122, `(275000)` is the shaman's mana pool. Do not parse it as time.
- A cast interval is the gap `schedules execute → performs` for one occurrence: e.g. `lightning_bolt` 5.402 (log:339) → 6.302 (log:363) = 0.900 s; `lava_burst` 2.574 (log:207) → 3.650 (log:226) = 1.076 s. When schedule and perform share a timestamp (lines 121-122), the cast was instant that time — identical actions genuinely differ between casts (haste/proc state), so timing must come from matched records, never from a guessed formula.
- Recognize at least: arise/demise/summon, `schedules execute`, `performs`, `schedules travel`, `hits`, `ticks`, `gains/loses/decrements/refreshes Buff`, casting-state changes, resource lines.
- Preserve timestamp and original line ordinal; multiple events with identical timestamps are not duplicates.

## 3. Occurrence identity and matching

Identity hierarchy (Policy):

```text
run → actor instance → action occurrence → travel occurrence → impact occurrence(s)
```

Never key an occurrence by `(spellId, timestamp)` alone. For the bounded single-target sample, a workable text matcher (Policy):

1. Queue `schedules execute` records by actor display name + action name + spell ID.
2. Match a `performs` with the appropriate queued schedule (same actor, action, spell; FIFO within the queue).
3. Associate `schedules travel` with the just-performed occurrence of the same action.
4. Match `hits` against scheduled arrival time and target, with millisecond tolerances appropriate to rounded text output.
5. Retain unmatched or ambiguous records visibly.

### Hits without performs

Not every hit has a matching generic `performs` line (Log evidence, lines 198-200):

```text
198: 2.429 Player 'MID2_Shaman_Elemental_Farseer_primal_storm_elemental' schedules execute for Action 'stormfury_aoe' (269005)
200: 2.429 Player 'MID2_Shaman_Elemental_Farseer_primal_storm_elemental' Action 'stormfury_aoe' (269005) hits Enemy 'Fluffy_Pillow' for 24614.883055 nature damage (hit)
```

No `performs` appears between them (the elemental's internal actions do not all log performs). The parser must keep schedule→hit pairs without inventing an execution record. In this log `stormfury_aoe` does this repeatedly (lines 198-200, 222-224, 251-253, 312-314).

## 4. Overloads and triggered variants

At 0.400 the log holds three `lava_burst_overload_asc` executions (Log evidence, lines 101-111): three `schedules execute` lines, then interleaved `performs`/`schedules travel` (0.600 s) pairs, all hitting at 1.000. Preserve all three — they are three missiles, not one.

Travel times differ per variant even within one family: the overloads travel 0.600 s while the main `lightning_bolt` travels 0.500 s (lines 168, 241). Copying the parent spell's travel time to its overload is incorrect.

Keep action-family metadata without erasing variants (Policy):

```ts
{ family: "lava_burst", actionName: "lava_burst_overload_asc",
  spellId: 285466, foreground: false, visualVariant: ... }
```

Do not restart the player's foreground cast animation for every overload: a background proc can emit a missile while the player continues another cast. At time zero, Ascendance triggers `flame_shock` and `lava_burst_asc` (lines 76-116) — that is not three independent foreground casts by the player.

## 5. Ancestor identity

Two ancestor pets arise under the **same display name** with different spawn indices (Log evidence):

```text
45: 0.000 Player 'MID2_Shaman_Elemental_Farseer_ancestor' arises. Spawn Index=3
72: 0.000 Player 'MID2_Shaman_Elemental_Farseer_ancestor' arises. Spawn Index=4
471: 8.000 MID2_Shaman_Elemental_Farseer_ancestor demises.. Spawn Index=3
478: 8.000 MID2_Shaman_Elemental_Farseer_ancestor demises.. Spawn Index=4
```

Summon duration is logged (`summons ancestor for 8.000s`). Subsequent action lines omit the spawn index, so display names alone cannot assign an action to a particular ancestor object. The log supports "two ancestor casts occurred" — stable FIFO assignment is a presentation policy, not recovered identity (Unresolved at text-log fidelity; a structured trace, §8, would resolve it).

Ancestor casts are triggered at the player's **impact**, not release (Log evidence, lines 150-154):

```text
150: 1.535 ... Farseer' Action 'lava_burst' (51505) hits Enemy 'Fluffy_Pillow' ...
151: 1.535 ... Farseer_ancestor' performs Action 'lava_burst' (447419) (0)
152: 1.535 ... Farseer_ancestor' schedules travel (0.600) for Action 'lava_burst' (447419)
```

Scheduling every ancestor cast at the parent's cast start would visibly desynchronize them. Note also the ancestor's spell ID (447419) differs from the player's (51505).

## 6. Buff and state timelines

Verified transitions for aura state kits (Log evidence):

```text
Ancestral Swiftness gain: 0.000 (line 69)   loss: 0.935 (line 125)
Stormkeeper gain: 0.000, stacks=2 (line 47) decrement: 1.777 → 1 stack (line 172) loss: 3.655 (line 245)
Ascendance gain: 0.000 (line 76)
```

Do not terminate the eight-second ancestor summons when Ancestral Swiftness's consumed buff disappears at 0.935 — they are different lifetimes (the ancestors demise at 8.000).

A zero-damage "hit" from a buff/setup action is not automatically a target impact VFX: line 20 (`flask` hits for 0.000000) and line 68 (`ancestral_swiftness` hits for 0.000000) illustrate why classification cannot rest on the word `hits` alone. Effect classification needs spell metadata, not line shape.

## 7. GCD: do not infer it from adjacent spacing

The normal log gives no complete explicit GCD timeline; the next action's timestamp can include cast completion, queueing, waiting, off-GCD actions, or other scheduling effects. At the pinned revision the action code has debug logging for GCD start/duration/ready time — use that (or add a structured event) rather than computing `GCD = next perform − current perform`. (Reference (SimC); Policy.)

## 8. Recommended capture and the structured-trace endgame

Generate log and JSON from the **same invocation** (Policy; option support verified in the pinned source):

```ini
iterations=1
threads=1
max_time=45
vary_combat_length=0
fixed_time=1
seed=20260925
fight_style=Patchwerk

log=1
log_spell_id=1

report_details=1
collect_action_sequence=1
json=replay.json,version=2.0.0,full_states=1
```

Full states add snapshots; they do not turn the JSON action sequence into a complete cast/travel/impact event stream — the text log remains the timing source.

For implementation-grade replay, the durable fix is a small structured trace in the pinned engine (Policy):

```ts
interface TraceEvent {
  runId: string;
  timeNs: string;
  ordinal: number;
  actorId: number;
  spawnIndex: number;
  ownerActorId: number | null;
  actionInstanceId: number | null;
  parentActionInstanceId: number | null;
  actionName: string | null;
  spellId: number | null;
  targetActorId: number | null;
  kind: "castStart" | "execute" | "travel" | "impact"
      | "gcdStart" | "auraChange" | "summon" | "despawn";
  foreground: boolean | null;
  scheduledImpactNs?: string;
}
```

This eliminates ambiguities a text parser cannot honestly solve (ancestor identity, overload grouping, GCD).

## 9. Seeking and run identity

- Keep a single replay clock; let the cursor carry an optional source ordinal (`{ timeMs, ordinalCutoff }`) so multiple zero-time events stay inspectable without invented timestamp offsets.
- Store simulation checkpoints for particle/ribbon history; replaying from a checkpoint must reproduce identical state regardless of pause, speed, backward seek, or render FPS.
- Never merge this log with an action-sequence JSON from another run because names and approximate times match: verify engine revision, profile hash, options, seed, and run identity first.

## 10. Unresolved items specific to this document

- Ancestor action attribution beyond display-name ambiguity (needs structured trace or spawn-index-aware parsing).
- Classification of zero-damage hits as impact VFX vs pure state actions (needs spell metadata side-channel).
- Whether `ticks` lines require distinct visual treatment (not analyzed in this pass).
