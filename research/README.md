# WoW Retail Damage Simulation Research

Research date: **2026-09-25**. Scope: World of Warcraft **Retail**, not Classic.
Starting point: [Raidbots developer documentation](https://www.raidbots.com/developers).

## Key findings

1. **Raidbots runs SimulationCraft.** Its website is a practical way to establish a character baseline and compare gear without operating the engine yourself.
2. **The developer page is not a documented simulation-submission API.** It documents static game data, existing report files, embeds, and other integration helpers. No supported submission/authentication/polling contract was found in the reviewed public documentation. This does not prove that private integrations do not exist.
3. **Direct SimulationCraft CLI execution is the clearest documented route for a programmable simulator.** A character export plus explicit encounter settings produces local HTML and JSON reports without relying on undocumented Raidbots endpoints.
4. **Version pinning matters.** The observed Raidbots live dataset is `12.1.0.69933`; the observed SimulationCraft default branch is `midnight`. Neither a branch nor the `live` alias is an immutable simulation version.
5. **Old guides can disagree with current code.** In particular, the Output wiki recommends `json2`, but current source also supports versioned `json` reports and defaults to a 3.0 alpha format. Explicitly choose the output format before implementing a parser.

These are research findings, not a final architecture decision. See the [source register](sources/README.md) for evidence and freshness caveats.

## Reading guide

| Directory / document | Purpose |
| --- | --- |
| [raidbots/developer-interface.md](raidbots/developer-interface.md) | Public interfaces, report downloads, permissions, and API unknowns |
| [raidbots/simulation-workflow.md](raidbots/simulation-workflow.md) | Character import and manual Quick Sim / Top Gear / Advanced workflow |
| [simulationcraft/local-execution.md](simulationcraft/local-execution.md) | CLI prerequisites, build recipe, execution, and failure handling |
| [simulationcraft/input-and-results.md](simulationcraft/input-and-results.md) | Input/APL semantics, profilesets, JSON versions, and interpretation |
| [data/static-game-data.md](data/static-game-data.md) | Dataset purposes, observed metadata, and caching/version rules |
| [data/snapshots/raidbots-live-metadata.2026-09-25.json](data/snapshots/raidbots-live-metadata.2026-09-25.json) | Small, complete metadata snapshot; no character data |
| [evaluation/implementation-options.md](evaluation/implementation-options.md) | Implementation choices, recommended first experiment, and open questions |
| [examples/README.md](examples/README.md) | How to use the research-only encounter configuration |
| [sources/README.md](sources/README.md) | Primary sources, inspected commits, verification, and limitations |

## Status and boundaries

- Completed: public documentation research, relevant current-source checks, three public metadata GET requests, and local document consistency checks.
- Not performed: engine installation/build, actual damage simulations, authenticated requests, paid requests, or application implementation.
- No character export, specialization, talent build, or target encounter was supplied. Consequently, there are **no measured DPS results** in this research.
- Example commands are a runbook for a later experiment, not a claim that they were executed here.
- All documents are in English to follow the repository's coding/documentation instructions.
