# WoW Rendering, Spell Visuals, and SimC Replay Research

Research date: **2026-09-26**. Scope: native M2/SKIN/SKEL/ANIM rendering, character customization composition, spell-visual data, particle/ribbon reconstruction, and SimulationCraft replay synchronization for WoW **Retail** build `12.1.0.69933`.

This directory condenses a deep-research pass (ChatGPT Pro report of 2026-09-26, registered as source G1 in the [source register](../sources/README.md)) together with two local reference-implementation inspections (wow.export, WebWowViewerCpp) and re-verification against this repository's pinned engine and local assets. The GPT report is a **secondary, synthesized** source: every fact below is labeled with its own evidence class, and facts drawn only from G1 are marked as such.

## Statement classes

| Label | Meaning |
| --- | --- |
| **Format** | Community-documented structure (wowdev wiki family, WoWDBDefs comments). Layout facts, not runtime proof. |
| **Reference (wow.export)** | Behavior read in Kruithne/wow.export at commit `c2fd7bde36a712be78a5da896c995b84fbfa2545`. A reference implementation, not the game client. |
| **Reference (WWV)** | Behavior read in Deamon87/WebWowViewerCpp at commit `1a8cccbeffc46231c6497e6b3f5bfbf3507d8071`. Same caveat. |
| **Reference (SimC)** | Behavior read in the pinned `simc/` engine at commit `1e0751c16d04df565bea9d7c4ac228f9cc4b0e46`. |
| **Log evidence** | A fact re-verified by grep against the local run log `.local/results/log-demo/log.txt` (2117 lines, seed 20260925, 45.000 s, MID2 Shaman Elemental). |
| **Build evidence** | A fact from the project's 2026-09-25 build audit (asset/component inventory, EDGF probe, attachment mapping), relayed via G1. Not independently re-extracted for these documents. |
| **Policy** | An explicitly chosen implementation decision for this repository's browser viewer. Not a recovered client behavior. |
| **Unresolved** | Not established by the available evidence. Do not fill these with plausible guesses. |

The two reference repositories are cited with repository-relative `file:line` paths that resolve at the pinned commits above (GitHub links in the [source register](../sources/README.md)). "Repo" in the gap analysis means this repository's `web/src/` at commit `ab42fc8`.

## Reading guide

| Document | Purpose |
| --- | --- |
| [m2-format-and-rendering.md](m2-format-and-rendering.md) | Native-M2 architecture decision, MD21/SKIN/ANIM/SKEL layouts, bones and attachments, shader selection, pixel combiners, blend table, render flags, lighting, color-space policy |
| [particles-and-ribbons.md](particles-and-ribbons.md) | Particle emitter layout and flags, spawn generators, RNG, integration, multitexture/TXAC/EXP2, ribbon ring-buffer algorithm |
| [character-customization.md](character-customization.md) | Character customization DB2 joins, geoset selection, atlas compositing, replaceable texture types |
| [spell-visuals.md](spell-visuals.md) | Spell-visual DB2 graph, kit-effect catalog, caster animations, missiles and impact timing, build-specific component inventory, unresolved event enum |
| [simc-synchronization.md](simc-synchronization.md) | Real log-line formats, occurrence matching, overloads, ancestor identity, aura timelines, GCD caveat, capture options |
| [current-implementation-gaps.md](current-implementation-gaps.md) | Verified defect list in `web/src/` at `ab42fc8` with file:line evidence, and the M0–M9 milestone plan |

## Headline findings

1. **Native M2 is the correct destination; GLB is a bridge.** glTF materials cannot express the M2 combiner/blend contract, the exporter path lacks attachments and effect emitters, and the largest visual gains come from semantics (materials, spaces, timing), not from PBR tuning. (Policy, following the format/reference evidence.)
2. **A dozen concrete defects are already identified** in the current viewer — inverted blend factors for particle blend 7, depth-flag sign inversions, unsplit TXAC, unconditional 5-bit texture-index masking, SKIN `level` applied to vertex starts, UV rotations read as compressed quaternions, reversed zSource direction, additive speed variation, and fixed 0.2 s release windows. Each is verified in [current-implementation-gaps.md](current-implementation-gaps.md).
3. **The pinned engine's text log carries the timing the JSON action sequence lacks** (cast intervals via schedule→perform gaps, travel times, impact times), but it also contains genuine ambiguities: duplicate actor names for the two ancestors, hits without `performs` lines (`stormfury_aoe`), and no explicit GCD timeline.
4. **The remaining exact-retail unknowns are concentrated**: `SpellVisualEvent` numeric event semantics, positioner/motion-script execution, full EDGF parameters, TXAC's particle-UV variant, refraction, client RNG seeding, retail post-processing defaults.

## Boundaries

- No claim here disassembles or otherwise reads Blizzard's client. Everything is format documentation, reference-implementation behavior, locally re-verified logs, or explicitly labeled policy.
- Build-specific DB2 rows (spell components, customization choices) come from the project's own audit and stay labeled **Build evidence**; they were not re-extracted from a fresh CSV dump for these documents.
- Reference repositories were inspected at pinned commits; their `master` branches are mutable and must not be vendored without re-pinning.
