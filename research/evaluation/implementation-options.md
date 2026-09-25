# Implementation Options and Next Experiment

Research date: 2026-09-25. Recommendations below are project analysis, not statements made by Raidbots.

## Options

| Approach | Strength | Constraint | Initial suitability |
| --- | --- | --- | --- |
| Manual Raidbots use + report import | Fast baseline, existing UI, little infrastructure | User-driven execution, retention, partial/optional report files | Good validation/reference workflow |
| Local or self-hosted SimulationCraft CLI | Documented execution, version control, local automation | Build/distribution, CPU scheduling, process isolation, report parsing | Recommended candidate for a programmable simulator |
| Approved Raidbots submission integration | Could delegate engine operations to Raidbots | Availability, permission, contract, limits, and pricing unverified | Blocked pending confirmation; not assumed available |
| New damage engine from static JSON | Full control in principle | Requires class mechanics, procs, APLs, encounter simulation, and continuous patch validation | Not justified for an initial implementation |

## Current execution foundation

The engine is pinned as `simc/`, and a macOS ARM64 CLI build plus one official Frost Mage smoke simulation have succeeded. The [build and smoke helpers](../../README.md#quick-start) make that fixed workflow repeatable without installing dependencies or changing upstream source. One user-supplied character export also completed a private manual baseline, with active talents and equipped-item details checked. This validates those executions and selected report fields, not arbitrary character inputs or all game mechanics. Private inputs and results are not versioned.

**Next recommendation:** use the validated private baseline for one controlled gear or talent comparison, and compare against a manual Raidbots Quick Sim when a matching report is available. Use static data only where a concrete lookup/UI requirement needs it. Further comparisons are not implemented by the fixed build/smoke helpers.

## Future controlled comparison

1. **Confirm the character and encounter for the comparison.**
   - Reuse the privately validated baseline if it is still current, or obtain a fresh addon export.
   - Verify: intended equipment/talents and the agreed encounter are unchanged; no accidental PTR or custom-APL mismatch.
2. **Retain the matching engine and data version.**
   - Record the commit, engine version, toolchain, game-data version, and platform for both baseline and candidate.
   - Verify: neither engine nor environment changes between variants; the earlier baseline does not prove compatibility after a patch.
3. **Retain or regenerate the baseline with explicit settings.**
   - Save original export, effective input, stdout/stderr, HTML, JSON, and command arguments.
   - Verify: successful exit, correct actor, valid finite DPS, no unhandled errors.
4. **Add exactly one legitimate gear or talent alternative.**
   - Use a profileset and retain the same encounter assumptions.
   - Verify: named baseline/candidate results and sufficient achieved precision for the comparison.
5. **Compare with Raidbots, if a matching report is available.**
   - Align engine revision and generated input as far as possible.
   - Verify: differences are evaluated against reported uncertainty and documented model/version differences; do not invent a universal percentage tolerance.
6. **Only then choose an application boundary.**
   - Decide CLI-only tool, local service, or hosted application from actual needs.
   - A single process runner plus version-aware result parser is enough to validate the core. A distributed queue or custom damage engine is not a research prerequisite.

## Provenance to retain per experiment

- Original character export and any effective-input transformation.
- Specialization, talent string, gear options, APL source/customization.
- Engine version/commit and game environment/build/hotfix identity.
- Encounter parameters, buffs/consumables, iterations/error target, seed/thread settings when relevant.
- JSON report version, process outcome, achieved precision, and actual iteration information.
- If Raidbots is involved: report URL and retrieval time.
- If external static data is used: metadata/content hash and retrieval time.

## Questions before comparison or application work

These do not block the completed research, but change the next development task:

1. Should the next comparison reuse the privately validated export, or use a newer character state?
2. Is the initial question single-target raid DPS, sustained AoE, or a specific dungeon route?
3. Is the primary feature baseline DPS, gear ranking, talent comparison, or rotation experimentation?
4. Should simulations run locally or on hosted infrastructure? What job size and concurrency are expected?
5. How should private character exports/results be stored, retained, and removed?
6. Will any approved Raidbots integration be needed, or is user-driven report import sufficient?

## Known limitations and risks

- Static game-data freshness does not prove engine/APL correctness after a hotfix.
- A simulated result is conditional on the chosen encounter and behavior assumptions, not an observed combat measurement.
- The inspected default `json` format is an alpha format; explicit format selection and fixtures are essential.
- Large combinations grow quickly. Validate one alternative before building optimizers.
- Arbitrary SimC input can exercise file/network features; do not expose unrestricted execution without isolation.
- Engine distribution/modification requires reviewing GPL and bundled dependency obligations. A subprocess boundary alone is not a complete licensing analysis.
- The official single-actor smoke workflow and one private character baseline have been validated. General input support, profileset execution, tracked result fixtures, cross-platform behavior, and performance/throughput/mechanics benchmarks remain unverified.
