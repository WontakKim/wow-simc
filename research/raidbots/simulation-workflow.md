# Running Simulations on Raidbots

Research date: 2026-09-25. This is a manual workflow, not an automation recipe.

## 1. Capture the current character

Install the [official SimulationCraft addon](https://github.com/simulationcraft/simc-addon) for Retail. In game, select the intended specialization, talents, and equipped gear, then run:

```text
/simc
```

Copy the complete export into Raidbots' addon-input field. Export again after changing the character. Raidbots' [addon guide](https://support.raidbots.com/article/54-installing-and-using-the-simulationcraft-addon) recommends this over Armory because the addon captures current in-game state and additional inventory information; Armory can lag and contains less detail.

Other commands documented by the addon:

- `/simc nobags`: export equipped gear without bag contents; suitable for a small baseline, not a bag-wide Top Gear search.
- `/simc minimap`: toggle the addon minimap button.
- `/simc [Item Link]`: append linked items as comments; chat limits constrain the number of links.

The reviewed sources do not establish complete coverage of every bank, warband-storage, or currently unavailable item. Inspect the export rather than assuming all owned gear is present. Bag-item comments help Raidbots expose alternatives; a local CLI baseline does not automatically search every commented item.

Character exports can contain identifiable character/realm information and detailed inventory data. Keep real exports and report fixtures out of public repository history unless deliberately approved.

## 2. Choose the smallest tool that answers the question

| Tool | Question | Input / caution |
| --- | --- | --- |
| [Quick Sim](https://www.raidbots.com/simbot/quick) | What is this character's baseline under chosen conditions? | Start here before comparing alternatives |
| [Top Gear](https://www.raidbots.com/simbot/topgear) | Which selected combination of available gear/talents performs best? | Use the full addon export and select only relevant candidates |
| [Droptimizer](https://www.raidbots.com/simbot/droptimizer) | Which potential drops are worth pursuing? | Choose content/difficulty; results are conditional on the simulated character |
| [Gear Compare](https://www.raidbots.com/simbot/gear) | How do explicitly configured gear alternatives compare? | Keep encounter and character assumptions unchanged |
| [Talent Compare](https://www.raidbots.com/simbot/talents) | How do talent alternatives compare? | Use current, valid Retail talent strings |
| [Advanced](https://www.raidbots.com/simbot/advanced) | How does a custom SimC script behave? | Supply a complete valid script; restrictions and time limits still apply |

The current Advanced page states that iterations, fight style, and fight length in the input override its UI options. It also warns against combining Armory imports and profilesets because this can produce excessive Armory requests and failures. Prefer an already exported actor definition.

Plan-specific run time, actor, and combination limits can change. Inspect the current account/UI rather than hard-coding historical numbers. This research did not use an account or verify current subscription limits.

## 3. Define an encounter before reading DPS

A useful **initial experiment**, not a universal recommendation:

- Live Retail rather than PTR/beta.
- Patchwerk, one target, 300-second nominal duration.
- Consistent duration variation, buffs, consumables, and execution assumptions across comparisons.
- Community-maintained default APL; no custom rotation in the baseline.
- Save the exact engine revision and full generated input shown by the report.

A multi-target Patchwerk run can answer a sustained-AoE question, but it does not model an entire Mythic+ route. Similarly, a five-minute single-target result is not a forecast of every raid encounter.

The [unreliable fight styles article](https://support.raidbots.com/article/43-unreliable-fight-styles) records specialization-specific Dungeon Slice problems for patch 11.2 and describes Dungeon Route as experimental. It was updated in August 2025. This supports checking specialization-specific guidance; it **does not establish the support status of every specialization on the observed 12.1 dataset**.

## 4. Run and inspect

1. Submit through the normal website UI and wait for completion.
2. Check warnings and verify character, specialization, gear, talents, and encounter settings.
3. Record mean DPS and the uncertainty information the report actually provides.
4. Inspect ability/buff details when available. An unexpected result may reflect input or APL assumptions, not an item improvement.
5. For small differences, increase statistical precision before declaring a winner. Lower sampling error does not remove modeling error.
6. Save the report URL and download the relevant [report files](developer-interface.md#downloading-an-existing-report) before retention expires.

## Expert Mode versus Advanced

[Expert Mode](https://support.raidbots.com/article/15-simc-expert-mode) injects custom directives into non-Advanced tools:

| Field | Insertion point |
| --- | --- |
| Script Header | Before the base actor definition |
| Pre-Actor | After the custom APL, before additional actors |
| Post-Actor | After additional actors, before enemy definitions |
| Script Footer | After generated simulation settings |

Most SimC options are accepted, but threading, networking, and hardware/I/O controls are restricted. The article says injected input is not validated or supported for troubleshooting; adding actors may break generated workflows. Always inspect the generated raw input.

The article dates to May 2021, so verify current UI behavior. Local CLI file-output/thread options in this research are **not** a list of options permitted on Raidbots.

## Comparing Raidbots with a local run

Use a simple Quick Sim first, not Smart Sim's multistage optimizer. Match the character input, engine commit, live/PTR data, APL, duration model, target count, buffs, consumables, and relevant execution settings. Compare statistical ranges rather than expecting identical floating-point DPS. A same-day local build is not proof of matching Raidbots' engine build.

No simulation was submitted as part of this research.
