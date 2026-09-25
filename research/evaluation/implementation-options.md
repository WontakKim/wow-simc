# Implementation Options and Next Experiment

Research date: 2026-09-25. Recommendations below are project analysis, not statements made by Raidbots.

## Options

| Approach | Strength | Constraint | Initial suitability |
| --- | --- | --- | --- |
| Manual Raidbots use + report import | Fast baseline, existing UI, little infrastructure | User-driven execution, retention, partial/optional report files | Good validation/reference workflow |
| Local or self-hosted SimulationCraft CLI | Documented execution, version control, local automation | Build/distribution, CPU scheduling, process isolation, report parsing | Recommended candidate for a programmable simulator |
| Approved Raidbots submission integration | Could delegate engine operations to Raidbots | Availability, permission, contract, limits, and pricing unverified | Blocked pending confirmation; not assumed available |
| New damage engine from static JSON | Full control in principle | Requires class mechanics, procs, APLs, encounter simulation, and continuous patch validation | Not justified for an initial implementation |

**Recommendation:** first validate one real Retail character with SimulationCraft CLI, using a manual Raidbots Quick Sim as a comparison when available. Use Raidbots static data only where a concrete lookup/UI requirement needs it. This is a proposed direction, not authorization to implement or deploy it now.

## Smallest useful next experiment

1. **Select one character/specialization and encounter.**
   - Input: a current addon export and agreed single-target or sustained-AoE scenario.
   - Verify: intended equipment/talents are present; no accidental PTR or custom-APL mismatch.
2. **Obtain one pinned engine build.**
   - Record commit, engine version, build/toolchain, game-data version, and platform.
   - Verify: binary starts and accepts the profile; prerequisites fail early with clear messages.
3. **Run the baseline with explicit settings.**
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

## Questions to resolve before implementation

These do not block the completed research, but change the next development task:

1. Which specialization and real character export should the first experiment support?
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
- No engine run or real-character fixture has been validated yet. No performance, throughput, or correctness benchmark is claimed.
