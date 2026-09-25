# Local SimulationCraft Execution

Research and local verification date: 2026-09-25. The pinned CLI has been built, an official sample simulation has succeeded, and one private character baseline has completed on macOS ARM64. Arbitrary-character support and profileset workflows remain unverified.

## Why use the CLI

SimulationCraft is the underlying combat engine. Its [repository README](https://github.com/simulationcraft/simc) recommends the command-line `simc` executable over the largely unmaintained GUI. It accepts character/configuration files and emits reports suitable for local automation.

The repository's `simc/` submodule pins commit `1e0751c16d04df565bea9d7c4ac228f9cc4b0e46`, observed on upstream's `midnight` branch at `2026-09-25T05:51:42Z`. The main engine is GPL-3.0; bundled dependencies have additional licenses. The parent gitlink records the engine revision; a moving branch name does not provide the same reproducibility.

## Initialize and build

Follow the [root quick start](../../README.md#quick-start) for a fresh clone. From an existing repository root:

```sh
git submodule update --init --recursive -- simc
./script/build-simc.sh
```

The helper checks required tools and the source pin, preserves logs, and runs this configuration:

```sh
cmake -S simc -B .local/simc-build \
  -DBUILD_GUI=OFF \
  -DBUILD_TESTING=OFF \
  -DCMAKE_BUILD_TYPE=Release
cmake --build .local/simc-build --target simc --parallel 4
```

Current [upstream CMake configuration](https://github.com/simulationcraft/simc/blob/1e0751c16d04df565bea9d7c4ac228f9cc4b0e46/CMakeLists.txt) declares CMake `3.10...3.22` and C++17. That declaration is a minimum/policy range, not a hard CMake maximum. The helper's `-S`/`-B` syntax requires **CMake 3.13+**; 4.4.3 is the locally tested version.

A single-configuration generator is required by the helper's executable path. On macOS, Xcode Command Line Tools supply the compiler and Make. CMake checks thread support and libcurl for the networking-enabled build. `BUILD_GUI=OFF` removes the Qt requirement; `BUILD_TESTING=OFF` excludes upstream test registration. Python 3 is required only by the separate smoke validator.

- Source: `simc/`.
- Executable: `.local/simc-build/simc`.
- Build logs: a fresh `.local/build-log.*/` directory per helper invocation.
- Generated files and private character inputs: ignored by the existing `/.local/` rule.

The helpers do not install tools, reset/update the engine, or change the submodule pin. A revision mismatch requires inspection before running the submodule update command. Rebuild after intentionally changing the pin. Keeping this commit forever is not appropriate for future Retail patches.

## Run the official smoke profile

```sh
./script/smoke-test.sh
```

The [tracked input](../examples/smoke-test.simc) reuses the official `simc/profiles/MID2/MID2_Mage_Frost.simc` profile and [single-target overlay](../examples/single-target.simc), then applies a short execution check: 60 seconds, 100 requested iterations, zero duration variation, two threads, and seed `20260925`.

`ptr=0` appears before actor creation. `item_db_source=local` limits item lookup to bundled data for this sample; it is not a network sandbox. The script selects `json2` for explicit JSON-v2 output and supplies per-run output paths on the command line.

Each run retains `run.log`, `report.json`, and `report.html` under a fresh `.local/results/smoke-test.*/` directory. The helper checks process success, the report version, expected actor, Live data selection, engine revision, finite positive DPS, nonempty HTML, and error/fatal diagnostics. It prints other diagnostics and never treats a previous run's report as current success.

The original successful run requested 100 iterations but recorded 101 in `sim.options.iterations` and 99 DPS samples. Exact counts or exact DPS are not smoke acceptance criteria. The report's `sim.options.dbc.version_used` identifies the selected environment; the top-level `ptr_enabled` flag describes compiled support, not whether this run selected PTR.

## Observed warnings and verification limits

- Build: macOS ARM64, AppleClang 21, CMake 4.4.3, Unix Makefiles, and SDK libcurl 8.7.1. The CLI reports engine `1210-01`, source revision `1e0751c`, and Live data `12.1.0.69933`.
- Upstream's macOS 10.15 deployment target triggers `The selected platform is no longer supported by libc++.` warnings. Compilation succeeds; the source and warning have not been patched or suppressed.
- The engine reports `implementation_not_yet_verified` for Rune of Unleashed Fire. Its proc targeting and damage/healing behavior include assumptions. This is visible in both `run.log` and JSON diagnostics.
- The smoke test verifies one official sample and selected JSON-v2 fields, not full schema conformance, arbitrary characters, every mechanic, profilesets, other operating systems, or the full upstream test suite.

## Manual real-character baseline

One user-supplied export completed a private manual baseline using the same pinned engine and the full single-target overlay. Its actor identity, active talent string, equipped item IDs/levels and selected modifiers, Live data, and JSON/HTML outputs were checked. The original file was preserved; private input, output, and identifying details are not versioned. This verifies that input, not arbitrary exports or mechanical accuracy.

The following recipe is separate from the fixed smoke helper. Supply a complete, compatible `/simc` export as `.local/character.simc` in UTF-8 first. From the repository root, use a new directory for each experiment:

```sh
mkdir -p .local/results
result_directory=$(mktemp -d .local/results/baseline.XXXXXX)
.local/simc-build/simc \
  ptr=0 item_db_source=local \
  .local/character.simc \
  research/examples/single-target.simc \
  seed=20260925 \
  "html=$result_directory/report.html" \
  "json2=$result_directory/report.json"
```

Inspect the export for conflicting settings. See [input and results](input-and-results.md) for parse order and output-version selection. A separate sustained-AoE experiment can override `desired_targets=5` after the overlay, but that is not a Mythic+ route model. Error-targeted runs must inspect achieved uncertainty rather than assuming a requested threshold was reached.

## Deferred general-runner requirements

A later arbitrary-character runner needs more than the fixed smoke helper:

1. Validate input/version compatibility and retain the original and effective input.
2. Use process argument arrays rather than shell interpolation of user text.
3. Isolate unrestricted SimC scripts, which can exercise file/network features.
4. Bound wall-clock time, CPU, memory, and outer concurrency; terminate work on cancellation.
5. Capture diagnostics and preserve process failures without accepting stale reports.
6. Parse required actor/metric fields by supported schema version and retain provenance.

The [Output wiki](https://github.com/simulationcraft/simc/wiki/Output) documents zero as success and nonzero statuses for parsing, initialization, execution, and I/O failures. Preserve actual statuses/messages rather than depending exclusively on a possibly changing numeric taxonomy. No general runner is implemented by these two fixed-purpose scripts.
