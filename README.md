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

The ranged presentation keeps the character and dummy centers at a fixed 8 scene-unit separation (`x = -4` and `x = 4`) while they face each other. These coordinates are presentation units, not in-game yards; the viewer does not provide a distance control or a game-range conversion.

Replay sync is the default scene mode. One replay cursor drives event selection and deterministic `AnimationMixer` pose sampling for explicitly mapped Elemental Shaman records: Flametongue Weapon, Lightning Shield, Stormkeeper, Ancestral Swiftness, Ascendance, Lava Burst, Lightning Bolt, Elemental Blast, and Flame Shock. Waits, failed queues, item/potion/trinket records, and other unmapped actions remain visibly idle with an explicit status. A missing mapped clip is also reported and held idle instead of substituting a different cast.

The recorded timestamps select source action records; they are not hit times and do not provide exact cast or per-hit damage windows. Each mapped record starts a fixed 1.20-second **illustrative viewer motion window** that a later record can interrupt. Playback keeps the existing 1.20-second viewer tail after the final source record and extends it only when a supported final Elemental Blast still has original particles decaying. These viewer windows are not fabricated trace events or reported combat duration. Backward seeks resample the same clip pose and native particles from the replay cursor, so pause, speed, previous/next, exact source-prefix selection, reset, and arbitrary seek all use the same clock.

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

### Acquire the original native particle components

The scene automatically loads two verified original components for successful combat records with both Spell ID `117014` and action name `elemental_blast`. The build-selected source chain is Spell `117014` → unconditioned SpellVisual `182369` → MissileSet `24108` → EffectName `16147`/`12991` → the M2 files below, with EffectName scales `2`/`1`. This is partial original Elemental Blast component integration, not all four source components, a native cast/impact kit, or general VFX support for the other mapped spells. The same files remain individually inspectable in the separate **Native M2 component preview** mode.

- FileDataID `794788`, `spells/leishen_lightning_burst_missile.m2`.
- FileDataID `613807`, `spells/shaman_frost_missile.m2`.

Prepare their original M2 and BLP files with the repository helper:

```sh
node script/prepare-native-effects.mjs
```

The helper performs bounded public HTTPS requests, downloads to temporary files, and promotes a file only after its exact byte size, SHA-256, magic, container bounds, version, emitter/bone counts, and texture IDs pass. It installs the ignored files under `web/public/model/native-effects/`. Existing valid files are verified without another request. A missing, partial, malformed, or hash-mismatched response exits nonzero with its FileDataID; there is no procedural substitute.

The pinned original-byte hashes are:

```text
d74e632a23699e81ca90907baf6f6a74a005e22642567094134bf41ac4393ea4  794788.m2
882871dc36baf215cb4166385e16be327c10f84b0f66f6937d84f7a7ea63c202  397894.blp
8d9f1fadfe4422ffd3bb040ec550fdcb81de0f9a003b2c2c71b2d15abf9e56bf  796153.blp
f2ecaa3d47fc455148e57154dadd1d6324c5d31136b70172c94a7c1418dde08e  243229.blp
ec0af25f0cbfe223e273a7d7cfd8c6d5df1e9e7054eeac23858d8fb463b82a9e  669041.blp
0ac91aa529011cd808b5d2880d685f5bf6714813dba898824797c345333376b9  613807.m2
3890881a5441048e10de3a474a110cb64ed22bcf11e8dd215f60f36de360adce  613804.blp
4b5a9d337499d317f5c465d655278be49db9e30f86df4b9b7b80e29c14cffb06  613805.blp
68a30b5caa5557f7a9569b4f925eefcdfba05aa2a95899e7f3c0cd8da9224b86  613806.blp
d4c485e69747d98297f931cacdb2b7311828a577b975b709e2f8dd6d1daa9c35  167020.blp
ce09ebf4b23d22a7b53db389526e352020820c2da4352a51b79ccee87966e7f8  167034.blp
```

The public acquisition endpoint includes `version=12.1.0.69933`, matching the build selected for the earlier DB2 research. That query parameter does **not** independently prove that the returned raw bytes came from that exact build root; the hashes above pin the bytes this proof actually consumes. These game assets remain subject to Blizzard's rights and terms and are not committed or redistributed.

Each source M2 is version 272 and contains six particle emitters, six unparented bones, zero mesh vertices, and no ribbons. The renderer consumes the authored emitter tracks, original BLP texture atlases, UV grids, blend functions, bone-relative transforms, and supported flags through deterministic billboard sampling. Authored lifespan variation uses the documented full symmetric amplitude, and sphere positions stay within the documented elevation/azimuth bounds. Nonzero `zSource` is rejected because these originals use zero and its interaction with other launch settings is outside this proof.

The M2 documentation does not specify the native random formula for `speedVariation`, the exact distribution within sphere angular/radius bounds, or the default sphere launch direction. This renderer therefore uses a stable additive `base + (random - 0.5) * speedVariation` approximation, deterministic uniform-angle/linear-radius sphere sampling, and a radial launch direction matching the sampled sphere position unless `0x100` overrides it to +Z; it does not claim native RNG or distribution parity. Both originals have zero emission-rate variation, so native per-update rate-randomization timing does not affect this proof.

Replay uses neutral anchors at 60% of each arranged model's bounds height. It releases the two components after `0.20s`, moves their source linearly across the fixed 8-unit viewer layout for `0.80s`, then stops emission at visual arrival and lets the original particles decay for their authored lifespans (at most `1.50s` in these sources). These are explicit viewer settings and an approximate path, not measured cast, missile, attachment, impact, damage, or hit data. `0x10` world-space particles retain the source position from their birth time while local particles follow the current viewer source. No moving-model velocity is added: the documented `inheritVelocityScale` refers to a parent particle, not proof of model-motion inheritance, and the parsed follow-speed/follow-scale fields have no documented formula. Native follow behavior, native RNG/distributions, ribbons/extensions, the unsupported other two components, sound, impacts, and pixel-identical game scheduling are not claimed. A missing, corrupt, partially loaded, or over-capacity source fails visibly with no substitute while trace inspection and the separate Manual/Native preview modes remain usable.

### Run the browser app

Install the pinned project dependencies and start the development server:

```sh
cd web
npm ci
npm run dev
```

Open the local URL printed by Vite. The model scene supports pointer orbit, wheel zoom, arrow-key pan while its canvas has focus, and camera reset. Replay play/pause, speed, previous/next, reset, and seek controls stay with the primary scene. Manual clip selection and manual play/pause appear only after switching modes. Native component selection and deterministic play, pause, seek, and reset appear only in Native M2 component preview mode.

The bundled Elemental Shaman reference opens automatically from `/fixture/elemental-shaman-replay.json`; no file selection or load action is required. Automatic playback and seek choose the last combat record at or before the cursor, with source order breaking equal-timestamp ties. Previous/next controls, arrow keys, timeline marks, and the event table preserve the exact selected record, including same-time precombat entries, and pause playback. The secondary inspector shows the selected snapshot time separately from the cursor. If the same-origin reference cannot be fetched or validated, the page reports the error and offers a retry while leaving the genuine scene and manual preview usable.

The bundled fixture was generated by the pinned real engine from the official `MID2_Shaman_Elemental.simc` profile. It retains all precombat/combat action entries and their resource, buff, cooldown, and target snapshots; unrelated report sections such as gear, talents, statistics, and APL data were removed to keep the public fixture bounded. Its one-iteration DPS is an aggregate report metric, while its action sequence samples iteration 0. The fixture is a reference sample, not a highest, optimal, or representative result. Its action timestamps drive the illustrative pose sampling and the specifically bounded two-component Elemental Blast viewer described above; fixture damage, hits, and other spell effects are not synchronized or reconstructed.

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
node ../script/prepare-native-effects.test.mjs
npm run build
PLAYWRIGHT_BROWSERS_PATH=../.local/playwright npx playwright install chromium
PLAYWRIGHT_BROWSERS_PATH=../.local/playwright npm run test:browser
```

The browser download and all generated build/test outputs remain ignored. Browser tests cover automatic reference loading and retry, genuine model loading, replay/manual/native mode separation, both original six-emitter components and their nine BLPs, source-linked Elemental Blast movement and overlap, deterministic seek/pause/reset/mode restore, delayed and failed native loads, real character pose changes, animation and camera controls, actionable model/WebGL failure states, the bundled full-state fixture, a legacy partial report, navigation, playback, diagnostics, and desktop/mobile overflow.

## Generated outputs

The CLI helpers keep their generated output under the ignored `.local/` directory:

| Path | Contents |
| --- | --- |
| `.local/simc-build/` | CMake build files and CLI executable |
| `.local/build-log.*/` | A new `configure.log` and `build.log` directory per build invocation |
| `.local/results/smoke-test.*/` | A new `run.log`, `report.json`, and `report.html` directory per smoke invocation |
| `.local/wow-export/` | Local exporter archive, application, profile, cache, and raw exports |
| `web/public/model/native-effects/` | Prepared original M2/BLP component files |

Failed CLI runs retain their logs and any partial reports. The script prints the directory before execution. Keep private character exports under `.local/` as well; do not commit them or generated reports.

The browser app also creates ignored paths outside `.local/`: `web/public/model/` for the two local GLBs, `web/node_modules/` for dependencies, `web/dist/` for production builds, and `web/test-results/` or `web/playwright-report/` for browser-test output. Project-local browser binaries remain under `.local/playwright/`.

## Verified environment and limitations

Verified on macOS ARM64 with CMake 4.4.3, AppleClang 21, and a Unix Makefiles generator. The pinned engine reports SimulationCraft `1210-01` and Live game data `12.1.0.69933`. Other platforms and multi-configuration generators have not been validated.

Known diagnostics remain visible:

- Upstream sets a macOS 10.15 deployment target, producing `The selected platform is no longer supported by libc++.` warnings with the tested toolchain. The build succeeds; upstream source is unchanged.
- The sample reports `implementation_not_yet_verified` for Rune of Unleashed Fire: its proc targeting and damage/healing behavior include assumptions. The smoke test succeeds without claiming that effect is mechanically verified.

One user-supplied Retail character export also completed a private manual baseline, with active talents and equipped-item details checked. This does not validate arbitrary inputs. Character identity, input, and output remain untracked. Gear/talent comparisons, full upstream tests, and Raidbots result parity are not completed. See the [research index](research/README.md), [execution details](research/simulationcraft/local-execution.md), and [future experiments](research/evaluation/implementation-options.md).
