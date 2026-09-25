# WoW Retail Simulation

A local World of Warcraft Retail simulation workspace using the official [SimulationCraft](https://github.com/simulationcraft/simc) engine as a pinned Git submodule. The current workflow builds the CLI and validates one official sample profile; it is not a general character runner or a hosted service.

## Prerequisites

- Git and access to the repositories for cloning/submodule initialization.
- CMake **3.13+** for the helpers' `-S`/`-B` command interface. Upstream declares a 3.10 minimum, but these commands require a newer CMake.
- A C++17 compiler and a single-configuration CMake build tool. On macOS, Xcode Command Line Tools provide the compiler and Make.
- Thread support and libcurl headers/libraries for the networking-enabled build. CMake checks these; the verified macOS SDK provides libcurl.
- Bash; the helpers support the macOS-provided Bash 3.2.
- Python 3 for smoke-report validation only. No Python packages are required, and the engine build itself does not require Python with upstream tests disabled.

The helpers do not install dependencies, initialize/update submodules, or modify the upstream engine. Qt is not required because the GUI is disabled.

## Quick start

```sh
git clone --recurse-submodules git@github.com:WontakKim/wow-simc.git
cd wow-simc
./script/build-simc.sh
./script/smoke-test.sh
```

For an existing clone with an uninitialized submodule, run this from its root first:

```sh
git submodule update --init --recursive -- simc
```

Both helpers accept no arguments and resolve paths relative to themselves. They can also be invoked by absolute path from another working directory. They require the `simc/` checkout to match the commit recorded by the parent repository's `HEAD`; they do not follow upstream's latest branch automatically.

### Build

[`script/build-simc.sh`](script/build-simc.sh) configures a Release build with GUI and upstream tests disabled, then builds the `simc` target with four parallel jobs. It prints the log directory and the executable location:

```text
.local/simc-build/simc
```

Repeated builds are incremental. The executable is local to the repository, not installed globally on PATH. A missing tool, uninitialized/mismatched submodule, failed configure, or failed build returns a nonzero status.

### Smoke test

[`script/smoke-test.sh`](script/smoke-test.sh) runs the [tracked smoke input](research/examples/smoke-test.simc) with the pinned engine's official Frost Mage profile. It uses a single-target Patchwerk encounter, 60 seconds, 100 requested iterations, two threads, and local item data.

It does **not** build automatically. Run the build helper first, and rebuild after changing the engine pin. Each smoke invocation creates a new output directory and checks:

- Successful process exit, parseable JSON version `2.0.0`, and a nonempty HTML report.
- The expected actor, Live data selection, and an engine revision matching the source pin.
- Finite positive mean DPS and no error/fatal JSON diagnostics.

Nonfatal engine diagnostics are printed, not suppressed. Exact DPS, iteration counts, and sample counts are not acceptance criteria. This is an execution check, **not a DPS benchmark or validation of all game mechanics**. Local item lookup is not a network sandbox.

## Local outputs

All generated output stays under the ignored `.local/` directory:

| Path | Contents |
| --- | --- |
| `.local/simc-build/` | CMake build files and CLI executable |
| `.local/build-log.*/` | A new `configure.log` and `build.log` directory per build invocation |
| `.local/results/smoke-test.*/` | A new `run.log`, `report.json`, and `report.html` directory per smoke invocation |

Failed runs retain their logs and any partial reports. The script prints the directory before execution. Keep private character exports under `.local/` as well; do not commit them or generated reports.

## Verified environment and limitations

Verified on macOS ARM64 with CMake 4.4.3, AppleClang 21, and a Unix Makefiles generator. The pinned engine reports SimulationCraft `1210-01` and Live game data `12.1.0.69933`. Other platforms and multi-configuration generators have not been validated.

Known diagnostics remain visible:

- Upstream sets a macOS 10.15 deployment target, producing `The selected platform is no longer supported by libc++.` warnings with the tested toolchain. The build succeeds; upstream source is unchanged.
- The sample reports `implementation_not_yet_verified` for Rune of Unleashed Fire: its proc targeting and damage/healing behavior include assumptions. The smoke test succeeds without claiming that effect is mechanically verified.

One user-supplied Retail character export also completed a private manual baseline, with active talents and equipped-item details checked. This does not validate arbitrary inputs. Character identity, input, and output remain untracked. Gear/talent comparisons, full upstream tests, and Raidbots result parity are not completed. See the [research index](research/README.md), [execution details](research/simulationcraft/local-execution.md), and [future experiments](research/evaluation/implementation-options.md).
