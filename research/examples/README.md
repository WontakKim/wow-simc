# Research Examples

## Single-target encounter overlay

[`single-target.simc`](single-target.simc) contains only encounter and sampling settings. It intentionally does not invent a character, gear, talents, or an action priority list.

Load a complete, compatible Retail character export before this file and put `ptr=0` before the actor definition:

```text
simc ptr=0 <character.simc> research/examples/single-target.simc html=<report.html> json2=<report.json>
```

The angle-bracket values are placeholders, not literal shell syntax. See the [local execution runbook](../simulationcraft/local-execution.md) for concrete paths and prerequisites.

- The configuration requests 10,000 iterations, one target, 300-second nominal duration with 20% variation, and four threads.
- `target_error=0` keeps this example a fixed-count experiment; it does not guarantee any particular achieved precision.
- Character buffs/consumables and other unlisted settings must be inspected in the effective run configuration.
- Load order matters. This overlay does not repair invalid or incompatible character exports.
- The options were checked against documentation/current source. The file has **not been run through SimulationCraft**.

This directory is research material, not an implemented simulation runner or a benchmark result set.
