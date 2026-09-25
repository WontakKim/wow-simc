# Local SimulationCraft Execution

Research date: 2026-09-25. This is an unexecuted runbook, not an installed runtime.

## Why use the CLI

SimulationCraft is the underlying combat engine. Its [repository README](https://github.com/simulationcraft/simc) recommends the command-line `simc` executable over the largely unmaintained GUI. It accepts character/configuration files and emits reports suitable for local automation.

Observed upstream state:

- Default branch: `midnight`.
- Inspected commit: `1e0751c16d04df565bea9d7c4ac228f9cc4b0e46`.
- Commit timestamp: `2026-09-25T05:51:42Z`.
- Main engine license: GPL-3.0; bundled dependencies have additional licenses.

Use the [official download page](https://www.simulationcraft.org/download.html) for a suitable available binary, or build from source. This research did not verify a specific downloadable release or its platform support.

## Source build recipe

Current [root CMake configuration](https://github.com/simulationcraft/simc/blob/1e0751c16d04df565bea9d7c4ac228f9cc4b0e46/CMakeLists.txt) establishes:

- CMake declaration `3.10...3.22` (minimum 3.10 with the stated policy compatibility range, not a hard maximum of 3.22).
- C++17.
- `BUILD_GUI=OFF` for CLI-only use; Qt is not needed for that target.
- Threads, and libcurl for networking on non-Windows builds, as configured in `engine/CMakeLists.txt`.
- `SC_NO_NETWORKING=ON` can remove network/Armory support and its libcurl dependency. It is optional, not part of the baseline recipe below.

On macOS, install Xcode Command Line Tools and CMake before building. The older build wiki's GUI instructions and compiler examples are not authoritative minimum-version requirements for this commit.

Example commands for a **future** isolated engine checkout, run from this repository's root:

```sh
mkdir -p .local
git clone --branch midnight --single-branch \
  https://github.com/simulationcraft/simc.git .local/simulationcraft
git -C .local/simulationcraft checkout 1e0751c16d04df565bea9d7c4ac228f9cc4b0e46
cmake -S .local/simulationcraft -B .local/simulationcraft/build \
  -DBUILD_GUI=OFF -DCMAKE_BUILD_TYPE=Release
cmake --build .local/simulationcraft/build --target simc --parallel 4
```

Do not commit `.local/`, character exports, or generated reports. Add appropriate ignore rules when actually introducing this workflow. These directories and an ignore file were not created as part of the research.

For a standard single-configuration CMake generator, the expected executable is `.local/simulationcraft/build/simc`. Multi-configuration generators can place it beneath a configuration directory. Verify the resulting path instead of assuming all platforms have the same layout.

Pinning this commit makes a research experiment reproducible; it is **not** advice to use this commit indefinitely for future Retail patches.

## Run a baseline

Prerequisites:

- A built/installed compatible `simc` executable.
- A complete, current `/simc` export saved as `.local/character.simc` in UTF-8.
- An output directory the process can write to.

From the repository root:

```sh
mkdir -p .local/results/baseline
.local/simulationcraft/build/simc \
  ptr=0 \
  .local/character.simc \
  research/examples/single-target.simc \
  html=.local/results/baseline/report.html \
  json2=.local/results/baseline/report.json
```

`ptr=0` is placed before actor creation because it applies to subsequently defined actors. Inspect the export for conflicting settings. `json2` explicitly selects the supported version-2 report path in the inspected source; see [input and results](input-and-results.md) before choosing a different format.

To run a separate sustained five-target experiment, use a different result directory and pass `desired_targets=5` after the encounter file. This is an AoE scenario, not a Mythic+ route model.

For a higher-precision comparison, explicitly choose a different stopping policy, for example `iterations=100000 target_error=0.1`, then inspect achieved error and iteration counts. A requested threshold is not a guarantee of reaching it before a cap or external time limit.

## Execution contract for a future wrapper

This is a proposed minimum, not implemented code:

1. Validate executable availability, input readability, output writability, and requested version/environment before execution.
2. Invoke the process with an argument array, not a shell command assembled from user text.
3. Treat arbitrary SimC scripts as executable configuration with file/network capabilities. Prefer a constrained character-export workflow; isolate unrestricted scripts and limit their resources.
4. Set a wall-clock deadline and CPU/memory/concurrency limits. Do not default every job to all host threads.
5. Capture stdout, stderr, exit status, engine identity, and effective input.
6. On failure, expose useful diagnostics. Do not return a successful result from a stale report left by an earlier run.
7. On success, require a parseable report with the expected actor and finite DPS, and inspect reported warnings/errors.
8. Keep each run's inputs/results separate. Cancellation or timeout must terminate its work rather than merely stop waiting for it.

The [Output wiki](https://github.com/simulationcraft/simc/wiki/Output) documents zero as success and nonzero statuses for parsing, initialization, execution, and I/O failures. A future wrapper should preserve actual statuses and messages rather than depending exclusively on a possibly changing numeric taxonomy.

## Verification status

The environment has `clang++`, but neither `cmake` nor `simc` was found on PATH. No dependencies were installed and no build or simulation was attempted. Build flags and report options were inspected in source; the commands remain execution-unverified.
