# WoW Retail Simulation

A local World of Warcraft Retail simulation workspace using the official [SimulationCraft](https://github.com/simulationcraft/simc) engine as a pinned Git submodule. The current workflow builds the CLI and validates one official sample profile; it is not a general character runner or a hosted service.

## Prerequisites

- Git and access to the repositories for cloning/submodule initialization.
- CMake **3.13+** for the helpers' `-S`/`-B` command interface. Upstream declares a 3.10 minimum, but these commands require a newer CMake.
- A C++17 compiler and a single-configuration CMake build tool. On macOS, Xcode Command Line Tools provide the compiler and Make.
- Thread support and libcurl headers/libraries for the networking-enabled build. CMake checks these; the verified macOS SDK provides libcurl.
- Bash; the helpers support the macOS-provided Bash 3.2.
- Python 3 for smoke-report validation only. No Python packages are required, and the engine build itself does not require Python with upstream tests disabled.
- Node.js **22.12+** and npm for the optional browser model/replay app. They are not required for the CLI build or smoke test.

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

## Browser genuine-model proof

The React application under [`web/`](web/) renders two genuine WoW exports together in one primary WebGL scene:

- An unequipped Vulpera Type 1 character using the verified normal Compact/Both/Slit customization.
- Training Dummy creature `109595`.

The browser loads both GLBs only from ignored local files. It does not fetch runtime assets from Battle.net, upload character data, include telemetry, or provide a fallback mesh. If either genuine model is absent, the scene stops with setup guidance rather than substituting a primitive or billboard.

Replay sync is the default scene mode. One replay cursor drives event selection and deterministic `AnimationMixer` pose sampling for explicitly mapped Elemental Shaman records: Flametongue Weapon, Lightning Shield, Stormkeeper, Ancestral Swiftness, Ascendance, Lava Burst, Lightning Bolt, Elemental Blast, and Flame Shock. Waits, failed queues, item/potion/trinket records, and other unmapped actions remain visibly idle with an explicit status. A missing mapped clip is also reported and held idle instead of substituting a different cast.

The recorded timestamps select source action records; they are not hit times and do not provide exact cast or per-hit damage windows. Each mapped record starts a fixed 1.20-second **illustrative viewer motion window** that a later record can interrupt. Playback includes one bounded 1.20-second viewer tail after the final source record so its motion can run and settle to idle; the tail is not a fabricated trace event or reported combat duration. The motion window, viewer tail, and exported clip duration are not claimed as in-game cast durations. No VFX, projectile, damage number, hit reaction, backend result, or optimal-play explanation is inferred. Backward seeks resample the same clip pose from the replay cursor, so pause, speed, previous/next, event selection, reset, and arbitrary seek all use the same clock.

The exported character's full named clip selector remains available under the explicitly separate **Manual preview** mode. Only that mode advances animation from wall-clock time; it never competes with replay sync. The proof uses a general race-matching Vulpera and does not reproduce a private face, fur customization, equipment, or transmog.

### Acquire the local models

The assets are intentionally not part of this repository. The verified exporter is the official wow.export `0.2.19` macOS ARM64 portable release:

- Release: [`portable-wow-export-osx-arm64-0.2.19.tar.gz`](https://github.com/Kruithne/wow.export/releases/download/0.2.19/portable-wow-export-osx-arm64-0.2.19.tar.gz)
- Size: `291622185` bytes.
- SHA-256: `ef8bbb19fee722e5694d42e1c999f28ca10123b6d6e527dedd43350953686854`.

Download, verify, and extract it under ignored `.local/` storage:

```sh
mkdir -p .local/wow-export/0.2.19
curl -fL --proto '=https' --tlsv1.2 \
  -o .local/wow-export/portable-wow-export-osx-arm64-0.2.19.tar.gz \
  https://github.com/Kruithne/wow.export/releases/download/0.2.19/portable-wow-export-osx-arm64-0.2.19.tar.gz
printf '%s  %s\n' \
  ef8bbb19fee722e5694d42e1c999f28ca10123b6d6e527dedd43350953686854 \
  .local/wow-export/portable-wow-export-osx-arm64-0.2.19.tar.gz \
  | shasum -a 256 -c -
tar -xzf .local/wow-export/portable-wow-export-osx-arm64-0.2.19.tar.gz \
  -C .local/wow-export/0.2.19
```

Launch the extracted application with its Chromium profile kept under `.local/`:

```sh
.local/wow-export/0.2.19/wow.export.app/Contents/MacOS/wow.export \
  --disable-auto-update \
  --user-data-dir="$PWD/.local/wow-export/profile"
```

Use the normal OS approval flow if macOS requires it. Do not disable Gatekeeper, TLS validation, or global security settings.

In wow.export:

1. Choose **Battle.net CDN**, region **Korea**, and Retail Live build **`12.1.0.69933`**. A local WoW installation is not required.
2. Set the export directory to this repository's `.local/wow-export/exports` directory.
3. Select GLB for character and creature exports and enable model animation export.
4. Under Characters, select Vulpera race `35`, Type 1 / ChrModel `69`, and leave equipment empty. Set Ears (option `336`) to Compact (choice `3323`), Eyesight (option `852`) to Both (choice `9541`), and Eye Style (option `854`) to Slit (choice `9581`), then export. The verified source is model FileDataID `1890761` (`character/vulpera/male/vulperamale.m2`) with skin FileDataID `1893903`.
5. Under Creatures, select `Training Dummy [109595]`, display `3019` / `woodendummy`, and export. The verified source is model FileDataID `125259` (`creature/object/woodendummy.m2`) with skin FileDataID `478820`.
6. Copy the exports to the ignored browser asset directory:

```sh
mkdir -p web/public/model
cp .local/wow-export/exports/character/vulpera/male/vulperamale.glb \
  web/public/model/vulpera.glb
cp .local/wow-export/exports/creatures/TrainingDummy.glb \
  web/public/model/training-dummy.glb
```

The earlier export selected Wanderer for Ears and lacked recognizable ears in both wow.export's preview and the resulting GLB. That is an observation about this exporter/build result, not a claim that the in-game Wanderer option inherently lacks ears.

The verified files have these checksums:

```text
63c7670151f27fc184505e0f144a95ee05f7eb958bdf323c2b7b97e38d063fee  web/public/model/vulpera.glb
0e6979643cec7705fc77dcac570ac9a7e5d7a17be15c4e03eb141c73ca58f484  web/public/model/training-dummy.glb
```

The verified Vulpera GLB is 61,054,876 bytes and contains 14 meshes, five embedded PNG textures, one skin, and 336 clips. The unchanged dummy GLB contains one mesh, one embedded PNG texture, one skin, and four clips. Both have embedded buffers and images, so those two local GLBs are the only model files the browser requires.

The export marks `vulperamale_eyereflect` as opaque even though its texture is almost entirely transparent. The browser corrects only that reflection material to use its alpha channel without writing depth, revealing the genuine eye mesh beneath it; it does not modify other materials or fabricate eye geometry.

wow.export's license covers the exporter, not Blizzard's game assets. The exported models remain subject to Blizzard's rights and terms; do not commit or redistribute them. `.gitignore` excludes both `.local/` and `web/public/model/`.

### Run the browser app

Install the pinned project dependencies and start the development server:

```sh
cd web
npm ci
npm run dev
```

Open the local URL printed by Vite. The model scene supports pointer orbit, wheel zoom, arrow-key pan while its canvas has focus, and camera reset. Replay play/pause, speed, previous/next, reset, and seek controls stay with the primary scene. Manual clip selection and manual play/pause appear only after switching modes.

The bundled Elemental Shaman reference opens automatically from `/fixture/elemental-shaman-replay.json`; no file selection or load action is required. Automatic playback and seek choose the last combat record at or before the cursor, with source order breaking equal-timestamp ties. Previous/next controls, arrow keys, timeline marks, and the event table preserve the exact selected record, including same-time precombat entries, and pause playback. The secondary inspector shows the selected snapshot time separately from the cursor. If the same-origin reference cannot be fetched or validated, the page reports the error and offers a retry while leaving the genuine scene and manual preview usable.

The bundled fixture was generated by the pinned real engine from the official `MID2_Shaman_Elemental.simc` profile. It retains all precombat/combat action entries and their resource, buff, cooldown, and target snapshots; unrelated report sections such as gear, talents, statistics, and APL data were removed to keep the public fixture bounded. Its one-iteration DPS is an aggregate report metric, while its action sequence samples iteration 0. The fixture is a reference sample, not a highest, optimal, or representative result. Its action timestamps drive only the illustrative pose sampling described above; fixture damage and spell effects are not synchronized or reconstructed.

### Bounded full-state trace export

After building the CLI, this command creates a detailed 45-second, single-run report under the ignored `.local/` directory. It uses the official profile without copying or modifying its APL:

```sh
mkdir -p .local/results/replay-demo
.local/simc-build/simc \
  ptr=0 \
  item_db_source=local \
  iterations=1 \
  threads=1 \
  target_error=0 \
  fixed_time=1 \
  vary_combat_length=0 \
  max_time=45 \
  fight_style=Patchwerk \
  desired_targets=1 \
  seed=20260925 \
  report_details=1 \
  collect_action_sequence=1 \
  json=.local/results/replay-demo/report.json,version=2.0.0,full_states=1,pretty_print=1 \
  simc/profiles/MID2/MID2_Shaman_Elemental.simc
```

Action sequences are recorded snapshots, not continuous frames. With one simulation iteration the trace samples iteration 0; with more than one it samples iteration 1, while `collected_data.dps` remains aggregate and its `count` is the number of DPS samples. Equal-time entries retain source phase and order. Buff capture omits quiet/constant buffs; cooldown entries list cooldowns that were down; target debuffs appear only when recorded. Missing legacy full-state fields are shown as not recorded rather than ready, zero, or interpolated. `ptr_enabled` describes compiled PTR support; the selected data environment is `sim.options.dbc.version_used`.

Run the local checks from `web/`:

```sh
npm run typecheck
npm test
npm run build
PLAYWRIGHT_BROWSERS_PATH=../.local/playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=../.local/playwright npm run test:browser
```

The browser download and all generated build/test outputs remain ignored. Browser tests cover automatic reference loading and retry, genuine model loading, replay/manual mode separation, real pose changes, deterministic backward seeks, frozen pause, late model arrival, animation and camera controls, actionable model/WebGL failure states, the bundled full-state fixture, a legacy partial report, navigation, playback, diagnostics, and desktop/mobile overflow.

## Generated outputs

The CLI helpers keep their generated output under the ignored `.local/` directory:

| Path | Contents |
| --- | --- |
| `.local/simc-build/` | CMake build files and CLI executable |
| `.local/build-log.*/` | A new `configure.log` and `build.log` directory per build invocation |
| `.local/results/smoke-test.*/` | A new `run.log`, `report.json`, and `report.html` directory per smoke invocation |
| `.local/wow-export/` | Local exporter archive, application, profile, cache, and raw exports |

Failed CLI runs retain their logs and any partial reports. The script prints the directory before execution. Keep private character exports under `.local/` as well; do not commit them or generated reports.

The browser app also creates ignored paths outside `.local/`: `web/public/model/` for the two local GLBs, `web/node_modules/` for dependencies, `web/dist/` for production builds, and `web/test-results/` or `web/playwright-report/` for browser-test output. Project-local browser binaries remain under `.local/playwright/`.

## Verified environment and limitations

Verified on macOS ARM64 with CMake 4.4.3, AppleClang 21, and a Unix Makefiles generator. The pinned engine reports SimulationCraft `1210-01` and Live game data `12.1.0.69933`. Other platforms and multi-configuration generators have not been validated.

Known diagnostics remain visible:

- Upstream sets a macOS 10.15 deployment target, producing `The selected platform is no longer supported by libc++.` warnings with the tested toolchain. The build succeeds; upstream source is unchanged.
- The sample reports `implementation_not_yet_verified` for Rune of Unleashed Fire: its proc targeting and damage/healing behavior include assumptions. The smoke test succeeds without claiming that effect is mechanically verified.

One user-supplied Retail character export also completed a private manual baseline, with active talents and equipped-item details checked. This does not validate arbitrary inputs. Character identity, input, and output remain untracked. Gear/talent comparisons, full upstream tests, and Raidbots result parity are not completed. See the [research index](research/README.md), [execution details](research/simulationcraft/local-execution.md), and [future experiments](research/evaluation/implementation-options.md).
