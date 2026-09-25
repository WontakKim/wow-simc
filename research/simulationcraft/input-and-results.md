# SimulationCraft Input and Results

Research date: 2026-09-25. Sources: [text configuration](https://github.com/simulationcraft/simc/wiki/TextualConfigurationInterface), [APLs](https://github.com/simulationcraft/simc/wiki/ActionLists), [profilesets](https://github.com/simulationcraft/simc/wiki/ProfileSet), and pinned source linked below.

## Character definition and parsing

A `.simc` file is text configuration, not JSON. Options can be given in files or on the command line. A filename or `input=<filename>` includes a file at that point in parsing.

- Save files as UTF-8.
- Use `#` for comments and keep assignments together: `max_time=300`, not `max_time = 300`.
- Quote values/names containing spaces.
- Some options are global, some affect the current actor, and some affect subsequently created actors. In particular, set `ptr=0` before defining the intended live actor.
- Repeated scalar global settings generally take the later value, but do not assume every option is a replace operation; action lists, report requests, and other accumulating options have their own semantics.
- Start from a complete addon export. Do not invent partial talent/item records and treat them as a realistic character.

## Action priority lists

An APL is a prioritized set of conditional actions, **not a fixed repeating rotation**. At each decision, the engine searches in priority order for an eligible action and starts again at the top on the next decision.

`actions=` defines an action list; `actions+=/…` appends another entry. Most specializations provide a community-maintained default when explicit custom actions or Assisted Combat alternatives are not selected. Preserve the default for a first experiment and record whether any custom APL was present.

A custom APL changes the gameplay model. It requires specialization-specific validation and combat-log inspection; it is not merely a formatting option.

## Encounter and sampling settings

The [example encounter file](../examples/single-target.simc) chooses explicit values rather than trusting mutable defaults:

| Option | Example | Interpretation |
| --- | --- | --- |
| `fight_style` | `Patchwerk` | Stationary encounter model |
| `desired_targets` | `1` | Single-target baseline |
| `max_time` | `300` | Nominal/mean encounter duration in seconds |
| `vary_combat_length` | `0.2` | Duration variation around that nominal value; 240–360 seconds in this example |
| `fixed_time` | `1` | Time-driven model with modeled health-percentage progression |
| `iterations` | `10000` | Requested sampling count for this fixed-count experiment |
| `target_error` | `0` | Disable error-driven early stopping for this experiment |
| `threads` | `4` | Explicit resource budget, not a claim of optimal throughput |

For an error-targeted run, `target_error=0.1` is **0.1 percent**, not 10 percent. Current source converts the relative error to a percentage and compares it to this threshold. It estimates uncertainty in the simulated mean; it does not measure fidelity to actual gameplay. The source's default confidence setting is `0.95`.

Record buffs, consumables, fight-length model, talents, gear, engine data, APL, and relevant execution settings for comparisons. These examples do not explicitly set every buff/consumable option, so inspect and retain the effective configuration. A random seed is useful provenance, but the same seed alone does not promise bit-for-bit equality across builds, threads, or platforms.

## Comparing variants with profilesets

Profilesets reuse a baseline actor and apply named overrides. The following is **syntax illustration with a placeholder**, not runnable input:

```text
profileset."Candidate Trinket"=trinket1=<complete SimC item options>
profileset."Candidate Trinket"+=iterations=10000
profileset."Candidate Trinket"+=target_error=0
```

Supply an actual exported item definition rather than the placeholder. For a real gear comparison, keep encounter assumptions unchanged between baseline and candidate. Validate the baseline before expanding combinations.

Important documented behavior:

- `=` starts a variant's option list; `+=` adds another override.
- Names must be distinct and cannot contain periods; quote names with spaces.
- The default metric is DPS. Do not accidentally compare median from one output with mean from another.
- Iterations and target error can be varied per profileset.
- Profileset runs use reduced detail (`report_details=0`); do not expect normal per-ability/buff detail for every candidate. Re-run finalists as ordinary single-actor simulations when detailed analysis is needed.
- New actors via `armory`, `copy`, or class declarations are not supported as ordinary per-variant changes. Stat scaling/plotting and some output-only options are also outside the supported use case.
- The wiki's older single-actor wording is qualified by a later multi-actor section. Start with one actor here; do not generalize the old wording into a current universal prohibition.
- `profileset_work_threads` controls threads per parallel worker. With `threads=8` and `profileset_work_threads=2`, the documented maximum is four simultaneous workers. Avoid multiplying this by unbounded outer job concurrency.

## JSON output: verify the version, not the filename

The [Output wiki](https://github.com/simulationcraft/simc/wiki/Output) labels `json` deprecated and recommends `json2`. However, the inspected commit has a newer versioned interface:

- [`sim.cpp`](https://github.com/simulationcraft/simc/blob/1e0751c16d04df565bea9d7c4ac228f9cc4b0e46/engine/sim/sim.cpp): `json2=<path>` redirects to `json=<path>,version=2`.
- [`report_configuration.cpp`](https://github.com/simulationcraft/simc/blob/1e0751c16d04df565bea9d7c4ac228f9cc4b0e46/engine/report/json/report_configuration.cpp): supported settings include `3.0.0-alpha1` and `2.0.0`; unspecified `json` versions select the first/current entry.
- [`Changelog.md`](https://github.com/simulationcraft/simc/blob/1e0751c16d04df565bea9d7c4ac228f9cc4b0e46/engine/report/json/Changelog.md): version 3 is marked unreleased and changes profileset metric layout.

Therefore, `json2=report.json` is a deliberate compatibility choice in the example. Another explicit choice for this source is `json=report.json,version=2.0.0`. Do not assume bare `json=report.json` has the same structure, and do not extrapolate this commit's supported versions to every historical binary.

## Relevant result paths

These paths are source-inspected in [`report_json.cpp`](https://github.com/simulationcraft/simc/blob/1e0751c16d04df565bea9d7c4ac228f9cc4b0e46/engine/report/json/report_json.cpp), not validated against a newly executed report:

| Path | Meaning / handling |
| --- | --- |
| `version` | SimulationCraft version string, not JSON schema version |
| `report_version` | JSON report version in the inspected source; older reports may omit it |
| `git_revision`, `git_branch` | Present when build Git information is available |
| `sim.options` | Effective simulation settings such as duration, iterations, threads, and confidence |
| `sim.options.dbc` | Game-data version/build/hotfix information, with environment-specific subobjects |
| `sim.players[]` | Reported actors; select the intended actor rather than blindly using the first |
| `sim.players[].collected_data.dps.mean` | Actor mean DPS when its collected DPS data is emitted |
| `sim.profilesets.results[]` | Profileset result collection; may be absent without variants |
| `logs[]` | Diagnostics emitted when the engine has messages; inspect level and message |

Version-2 profileset entries have fields such as `name`, `mean`, `stddev`, `mean_stddev`, `mean_error`, and `iterations`. The primary metric is identified by `sim.profilesets.metric`; additional metrics use `additional_metrics`.

The version-3 writer instead groups each entry's metrics in `metrics[]`, each with a `metric` identifier. This is why a version-aware parser is necessary. The 3.0 schema/changelog describes an evolving format, not a guarantee for all future reports.

For profilesets, current source computes `mean_error = mean_stddev * confidence_estimator`. Distinguish iteration-to-iteration spread (`stddev`) from uncertainty of the estimated mean (`mean_stddev` / `mean_error`). Do not relabel one as another or invent an identical path for ordinary player statistics.

Raidbots adds its own `simbot` metadata and may truncate actors. Its JSON must not be assumed byte-for-byte equivalent to a local report, or assumed to use the newest upstream report format.

## Acceptance checks for a future parser

- Require a successful process result plus a fresh, valid report.
- Identify the actor and metric explicitly.
- Preserve the original report and provenance even if extracting a small normalized result.
- Validate finite numeric DPS; distinguish a valid zero, an omitted metric, and a failed simulation.
- Handle optional fields without silently accepting missing required statistics.
- Reject unsupported schema versions with an actionable message.
- Keep achieved precision and iterations alongside DPS; avoid ranking tiny differences as conclusive.
- Add real single-actor and profileset fixtures after the first engine execution. No such fixtures exist in this research yet.
