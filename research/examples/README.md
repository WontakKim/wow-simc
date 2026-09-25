# Research Examples

## Official-profile smoke test

[`smoke-test.simc`](smoke-test.simc) is a tracked execution-check input. It includes the pinned engine's official Frost Mage profile and the single-target overlay below, then overrides duration/sampling settings to keep validation short.

From the repository root:

```sh
./script/build-simc.sh
./script/smoke-test.sh
```

The smoke helper resolves the repository root even when invoked from another directory. It supplies fresh JSON/HTML paths under ignored `.local/results/smoke-test.*/` and checks the resulting reports. If running the `.simc` input directly instead, its include paths require the repository root as the working directory and output settings must be supplied separately.

- Live data, local item lookup, 60 seconds, 100 requested iterations, zero duration variation, two threads, and a fixed seed.
- The official profile/APL remains in the submodule; it is not copied into this repository's examples.
- The original run completed with valid JSON-v2 and HTML reports. Exact DPS and iteration/sample counts are not contractual expected values.
- Compiler and engine warnings remain visible; this is not a performance benchmark or proof that all modeled effects are correct.
- The fixed helper is not a general character or profileset runner. See the [execution runbook](../simulationcraft/local-execution.md) for prerequisites, diagnostics, and limits.

## Single-target encounter overlay

[`single-target.simc`](single-target.simc) contains only encounter and sampling settings. It intentionally does not invent a character, gear, talents, or an action priority list.

Load a complete, compatible Retail character export before this file and put `ptr=0` before the actor definition:

```text
simc ptr=0 <character.simc> research/examples/single-target.simc html=<report.html> json2=<report.json>
```

The angle-bracket values are placeholders, not literal shell syntax. This direct command assumes `simc` is on PATH; the repository's built executable is `.local/simc-build/simc`.

- The overlay requests 10,000 iterations, one target, 300-second nominal duration with 20% variation, and four threads.
- `target_error=0` makes it a fixed-count experiment; it does not guarantee any particular achieved precision.
- Inspect buffs/consumables and other unlisted settings in the effective configuration.
- Load order matters. This overlay does not repair invalid or incompatible character exports.
- The official smoke run exercises this overlay **with duration, variation, iteration, and thread overrides**. A separate private character baseline also completed its full default workload with active talents and equipped-item details checked. That input and its results are not versioned; arbitrary-character and mechanics correctness are not established.

Keep personal character exports and generated reports under ignored `.local/`; only generic settings and the official-profile smoke input belong in this directory.
