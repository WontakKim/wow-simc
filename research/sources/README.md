# Source Register and Verification

Access date for the research below: **2026-09-25**.

## Evidence categories

- **Documentation:** a claim explicitly described by an official page or repository wiki.
- **Source inspection:** a behavior checked in current public code; not a runtime test.
- **Live observation:** an actual read-only response received during this research.
- **Local execution:** a built CLI run and selected checks on its generated output, not a guarantee of mechanics correctness.
- **Recommendation:** project analysis derived from the above; not an upstream promise.

All external material is version-sensitive. Recheck mutable pages, game data, and the engine before implementation. Historical examples are not evidence of current Retail mechanics.

## Raidbots and addon sources

| ID | Source | Use and limitations |
| --- | --- | --- |
| R1 | [Raidbots Developers](https://www.raidbots.com/developers) | Primary starting point: static data, report files, embeds, analysis, website pre-fill, and DBCache resources; no submission API contract found |
| R2 | [SimulationCraft addon guide](https://support.raidbots.com/article/54-installing-and-using-the-simulationcraft-addon) | Export/import workflow and preference over Armory; updated 2023-07-04, includes some older-expansion examples |
| R3 | [SimC Expert Mode](https://support.raidbots.com/article/15-simc-expert-mode) | Injection positions, restrictions, lack of validation/support; updated 2021-05-29 |
| R4 | [Unreliable fight styles](https://support.raidbots.com/article/43-unreliable-fight-styles) | Dungeon Slice/Dungeon Route cautions; updated 2025-08-31 and specifically discusses patch 11.2, not all current 12.1 support |
| R5 | [Advanced Sim](https://www.raidbots.com/simbot/advanced) | Current UI text about script options overriding UI settings, time limits, and Armory/profileset warning |
| R6 | [Privacy Policy](https://www.raidbots.com/privacy) | Report retention of 28 days and raw-data archives up to 2 days; reviewed policy text, not a report-lifetime experiment |
| R7 | [Terms of Use](https://www.raidbots.com/tou) | Broad automated-access/load restrictions; does not establish a third-party simulation API contract |
| A1 | [Official addon repository](https://github.com/simulationcraft/simc-addon) | `/simc`, `nobags`, minimap, linked-item commands, and export caveats |
| A2 | [Addon releases](https://github.com/simulationcraft/simc-addon/releases) | Installation reference linked by the official guide; no particular release was installed |

### Reading the JavaScript-rendered Raidbots pages

Text-only retrieval of the developer, terms, and privacy URLs returned the page shell rather than their body. The research therefore followed the **public script references** to recover the page text; it did not log in, submit jobs, access private reports, or infer a supported API from internal request code.

Public assets inspected:

- [Main application bootstrap](https://www.raidbots.com/frontend/simbot.18051d16c0e9b6a0c969.js)
- [Application loader](https://www.raidbots.com/frontend/875.2842bf4d43d3a9af828e.js)
- [Routes, terms, and privacy text](https://www.raidbots.com/frontend/510.e70d0a6b00814e2880eb.js)
- [Developer-page module](https://www.raidbots.com/frontend/278.5448687159da3b370260.js)
- [Advanced-page module](https://www.raidbots.com/frontend/484.d8d02c34d16e4c19f403.js)

These asset names are observation evidence, not stable endpoints for an integration. They may disappear after deployment. Only page prose and relevant displayed behavior were used as documentation; development-only diagnostics and incidental internal settings were not promoted into a public API contract. No rendered-browser interaction was tested.

## Static-data observations

| ID | Requested resource | Result |
| --- | --- | --- |
| D1 | [Live metadata](https://www.raidbots.com/static/data/live/metadata.json) | Valid JSON, environment `live`, build `12.1.0.69933`, 52 listed files |
| D2 | [Content-hash metadata](https://www.raidbots.com/static/data/031bc0017082a9628929355494566340/metadata.json) | Same JSON and exact response-body checksum as D1 |
| D3 | [Build metadata](https://www.raidbots.com/static/data/12.1.0.69933/metadata.json) | Same JSON and exact response-body checksum as D1 |

Saved evidence: [raidbots-live-metadata.2026-09-25.json](../data/snapshots/raidbots-live-metadata.2026-09-25.json).

SHA-256 of the response bytes and saved snapshot:

```text
14fff26448ffd773b5153d6d6bf74a274297e651a4caac08ee4f20dd6c2170da
```

Generated-at value reported by Raidbots: `2026-09-24T23:00:32.508Z`. This is the dataset generation timestamp, not the retrieval timestamp or the engine's hotfix timestamp.

Full item, talent, analysis, and DBCache datasets were not downloaded. The developer page's example report was not treated as a current result fixture.

## SimulationCraft documentation

| ID | Source | Use and freshness considerations |
| --- | --- | --- |
| S1 | [Engine repository](https://github.com/simulationcraft/simc) | Purpose, CLI recommendation, license, repository structure |
| S2 | [Starter guide](https://github.com/simulationcraft/simc/wiki/StartersGuide) | File/CLI execution background; contains old Armory/GUI/expansion examples |
| S3 | [Textual configuration](https://github.com/simulationcraft/simc/wiki/TextualConfigurationInterface) | File inclusion, scoping, parse order, comments, quoting |
| S4 | [Options](https://github.com/simulationcraft/simc/wiki/Options) | Duration, threading, and PTR semantics; edited in 2020, not a complete current reference |
| S5 | [Action lists](https://github.com/simulationcraft/simc/wiki/ActionLists) | Priority evaluation and default/custom APL distinction |
| S6 | [Profilesets](https://github.com/simulationcraft/simc/wiki/ProfileSet) | Overrides, metrics, reduced report detail, worker threads; later multi-actor section qualifies older single-actor wording |
| S7 | [Output](https://github.com/simulationcraft/simc/wiki/Output) | HTML/JSON and process failures; JSON advice must be reconciled with current source |
| S8 | [Build guide](https://github.com/simulationcraft/simc/wiki/HowToBuild) | General build approach; edited 2022-08-20, platform/GUI guidance can be old |

## Pinned source inspection

The [repository API](https://api.github.com/repos/simulationcraft/simc) reported `midnight` as the default branch. The [branch commit API](https://api.github.com/repos/simulationcraft/simc/commits/midnight) returned commit [`1e0751c16d04df565bea9d7c4ac228f9cc4b0e46`](https://github.com/simulationcraft/simc/commit/1e0751c16d04df565bea9d7c4ac228f9cc4b0e46), timestamp `2026-09-25T05:51:42Z`.

Use the pinned links below to reproduce the source review rather than assuming `midnight` stays unchanged.

| ID | Source at the inspected commit | Verified point |
| --- | --- | --- |
| C1 | [Root CMakeLists.txt](https://github.com/simulationcraft/simc/blob/1e0751c16d04df565bea9d7c4ac228f9cc4b0e46/CMakeLists.txt) | CMake policy/minimum declaration, C++17, CLI target, GUI toggle |
| C2 | [Engine CMakeLists.txt](https://github.com/simulationcraft/simc/blob/1e0751c16d04df565bea9d7c4ac228f9cc4b0e46/engine/CMakeLists.txt) | Thread/network dependencies, libcurl, build Git metadata |
| C3 | [Simulation options and JSON parser](https://github.com/simulationcraft/simc/blob/1e0751c16d04df565bea9d7c4ac228f9cc4b0e46/engine/sim/sim.cpp) | Encounter/precision options, percentage error comparison, `json2` forwarding to version 2 |
| C4 | [Report configuration](https://github.com/simulationcraft/simc/blob/1e0751c16d04df565bea9d7c4ac228f9cc4b0e46/engine/report/json/report_configuration.cpp) | `2.0.0` and `3.0.0-alpha1`; default unversioned `json` choice |
| C5 | [JSON writer](https://github.com/simulationcraft/simc/blob/1e0751c16d04df565bea9d7c4ac228f9cc4b0e46/engine/report/json/report_json.cpp) | Version/build metadata, player data, profileset fields and metric layout |
| C6 | [JSON changelog](https://github.com/simulationcraft/simc/blob/1e0751c16d04df565bea9d7c4ac228f9cc4b0e46/engine/report/json/Changelog.md) | Unreleased version-3 schema and profileset changes |
| C7 | [Version-3 schema file](https://github.com/simulationcraft/simc/blob/1e0751c16d04df565bea9d7c4ac228f9cc4b0e46/engine/report/json/schema/3.0.0.schema.json) | Available schema reference; not used to claim validation of an actual engine report |

## Rendering and spell-visual research sources (access date 2026-09-26)

Sources for the [rendering/](../rendering/README.md) documents. Both reference repositories were inspected at the pinned commits below via local clones; cited `file:line` references resolve at those commits on GitHub, and their `master` branches are mutable — re-pin before vendoring.

| ID | Source at the inspected commit | Use and limitations |
| --- | --- | --- |
| G1 | ChatGPT Pro deep-research report, 2026-09-26 (private session; not a public URL) | Secondary **synthesized** source that organized the deep research. Every fact drawn from it is re-labeled with its own evidence class in the rendering documents; statements resting only on G1 are marked as build evidence or unresolved. Not treated as primary evidence. |
| W1 | [wow.export](https://github.com/Kruithne/wow_export) at commit [`c2fd7bde36a712be78a5da896c995b84fbfa2545`](https://github.com/Kruithne/wow_export/commit/c2fd7bde36a712be78a5da896c995b84fbfa2545) (MIT) | M2/SKIN/ANIM/SKEL loading, shader-selection tables, pixel combiners, blend/EGx tables, render flags, character-customization joins and atlas compositing. Implements no M2 particle/ribbon path. |
| W2 | [WebWowViewerCpp](https://github.com/Deamon87/WebWowViewerCpp) at commit [`1a8cccbeffc46231c6497e6b3f5bfbf3507d8071`](https://github.com/Deamon87/WebWowViewerCpp/commit/1a8cccbeffc46231c6497e6b3f5bfbf3507d8071) | Particle and ribbon simulation (generators, RNG, integration, flags), compressed gravity, multitexture/EXP2, M2 lighting model. Contains no spell-visual/missile logic. Its attachment helper is demonstrably faulty and is cited only for the matrix relationship it encodes. |
| W3 | [wowdev wiki](https://wowdev.wiki/) (M2 and related pages) | Community format documentation for chunk layouts and record structures. The research browser could not retrieve the wiki pages during the pass, so format statements rest on the reference loaders plus the report; treat as corroboration target, not verified reading. |
| W4 | [WoWDBDefs](https://github.com/wowdev/WoWDBDefs) | DB2 schema definitions, including build-69933 layouts and `SpellVisualKitEffect` type comments. Schema shape, not runtime semantics. |
| W5 | SimulationCraft at the existing pinned commit `1e0751c16d04df565bea9d7c4ac228f9cc4b0e46` (see C1–C7) | Log-line emitters (`performs`, `schedules execute`, `schedules travel` in `engine/action/action.cpp`), `log_spell_id` option registration, GCD debug logging. |
| L1 | Local run log `.local/results/log-demo/log.txt` (ignored `.local/`, seed 20260925, 45.000 s, 2117 lines) | **Live local evidence**: every timing fact in [simc-synchronization.md](../rendering/simc-synchronization.md) was re-verified against this file by grep, with line numbers. The build-specific spell/component inventory additionally rests on the project's 2026-09-25 asset audit relayed via G1 and is labeled build evidence there. |

Not performed for the rendering research: no wowdev wiki page was successfully fetched, no Wago build CSV or CASC product download was made, no retail client was disassembled or captured, and the reference GLSL was not GPU-compiled.

## Verification boundaries

Performed:

- Read official documentation and current public page text.
- Check engine source for build settings, options, JSON versions, and selected result paths.
- Fetch metadata using three documented selectors and compare their parsed content and raw checksums.
- Preserve the small metadata snapshot as research evidence; downloaded application bundles are not versioned. Engine source is now separately pinned through the `simc/` submodule.
- Check local document links, code-fence balance, shell-example syntax, metadata shape/checksum, encounter-option registration, and whitespace/diff consistency.
- For the 2026-09-26 rendering research: re-verify every cited log fact by grep against the local run log; verify every `web/src/` defect claim by reading the file at the cited lines; record reference-repository commit SHAs; check relative markdown links, absence of machine-local absolute paths, and diff whitespace.

Follow-up local execution:

- Build the pinned engine with CMake 4.4.3 and AppleClang 21 on macOS ARM64, using Release mode with GUI/upstream tests disabled. The CLI is local, not installed globally on PATH.
- Run the official Frost Mage profile with the single-target overlay and short smoke overrides. Inspect JSON-v2/HTML output, engine revision, Live data selection, expected actor, positive finite DPS, and diagnostics.
- Preserve generated logs/reports under ignored `.local/`; the [tracked smoke input](../examples/smoke-test.simc) and [reusable helpers](../../README.md#quick-start) reproduce the procedure, not an identical numerical result.
- Observe the upstream libc++ deployment-target warning and the Rune of Unleashed Fire `implementation_not_yet_verified` diagnostic. See [execution details](../simulationcraft/local-execution.md#observed-warnings-and-verification-limits).
- Subsequently run one user-supplied character export privately with the full single-target overlay. Check original-file preservation, active talents, equipped item IDs/levels and selected modifiers, engine/data identity, output files, and reported mean uncertainty. Do not version identifying details, input, or results.

Not performed:

- General arbitrary-character validation, profileset execution, independent APL/talent/mechanics correctness validation, full report-schema validation, or tracked result fixtures.
- Full upstream tests, other operating systems, and performance/throughput benchmarking.
- Paid/authenticated Raidbots activity, API-key acquisition, or simulation submission.
- Rate-limit probing, load testing, browser automation, or hosted application deployment.
- Complete dataset-schema, item-level-calculation, licensing, or legal review.

The report-format mismatch is addressed by documenting the inspected source, choosing explicit version-2 output, and verifying selected fields in the official single-actor run. Remaining runtime and mechanics uncertainties are left visible rather than represented as tested behavior.
