# Static Game Data

Research date: 2026-09-25. Source: [Raidbots Developers](https://www.raidbots.com/developers#static-data).

## Purpose and limits

Raidbots publishes JSON derived from WoW client data using SimulationCraft extraction tools. These files help identify gear, bonuses, talents, encounters, and crafting choices. They are **not a replacement for SimulationCraft's combat model, APLs, or specialization implementations**.

The developer page says the files are produced for Raidbots, may omit fields, and are provided without accuracy/completeness guarantees. A successful JSON download is not proof of a correct damage calculation.

## URL structure

```text
https://www.raidbots.com/static/data/<selector>/<filename>
```

Supported documented selectors:

- Environment: `live`, `ptr`, or `beta`; mutable and potentially cached.
- Exact game build: for example, the observed `12.1.0.69933`.
- Content hash: for example, the observed `031bc0017082a9628929355494566340`.

For reproducible ingestion, resolve `live/metadata.json` first and use its content hash for related files. An exact build identifies the client build, but content-hash addressing more directly identifies one generated dataset. Do not assume game build alone identifies all subsequent data-generation changes.

## Observed metadata

All three URLs returned equivalent JSON during this research:

- [Live metadata](https://www.raidbots.com/static/data/live/metadata.json)
- [Build metadata](https://www.raidbots.com/static/data/12.1.0.69933/metadata.json)
- [Hash metadata](https://www.raidbots.com/static/data/031bc0017082a9628929355494566340/metadata.json)

| Field | Observed value |
| --- | --- |
| `environment` | `live` |
| `wowBuild` | `12.1.0.69933` |
| `contentHash` | `031bc0017082a9628929355494566340` |
| `generatedAt` | `2026-09-24T23:00:32.508Z` |
| Number of entries in `files` | 52 |

The [saved metadata snapshot](snapshots/raidbots-live-metadata.2026-09-25.json) preserves the full file list. This is an observation, not a promise that `live` will keep returning these values.

## Dataset selection

| File | Intended use / caveat |
| --- | --- |
| `metadata.json` | Dataset identity, generation time, and available filenames |
| `equippable-items.json` | Equippable items; older-expansion entries have reduced fields |
| `equippable-items-full.json` | Full older-item fields; download only if needed |
| `item-names.json` | Localized item names, separate from item mechanics |
| `bonuses.json` | Bonus-ID effects such as item-level changes, curves, quality, and affixes |
| `talents.json` | Talent-tree data; pair with the correct game build and valid exported talent string |
| `instances.json` | Current-expansion instances/encounters from the Adventure Journal |
| `enchantments.json` | Enchantment lookup |
| `crafting.json` | Optional reagents/slots, relevant to crafting and embellishments |
| `item-curves.json` | Item-level curves; the page describes linear interpolation by drop level |
| `item-conversions.json` | Catalyst conversion relationships with bonus/class/spec/slot/armor constraints |
| `item-sets.json` | Set identities and effects unlocked at item counts |
| `item-limit-categories.json` | Unique-equipped category information |

The observed metadata also lists specialized bonus, squish-era, content-tuning, and consumable datasets. Their presence is verified; their full schemas and composition rules were **not** audited. Consult the metadata rather than assuming the developer page lists every current file.

## Item identity is richer than an item ID

Retain exported item options such as bonus IDs, enchants, gems, crafting modifiers, and other version-specific fields. Items sharing an ID can have different simulated behavior. Do not flatten an item to only `{id, itemLevel}`, rebuild current item-level logic from an old expansion guide, or discard unrecognized export fields silently.

For the first simulation experiment, preserving the original SimC gear lines is safer and simpler than implementing an independent item resolver.

## Recommended ingestion behavior

These are project recommendations, not a Raidbots SDK contract:

1. Fetch and validate metadata; retain the source URL and retrieval timestamp.
2. Select only datasets required for the current feature.
3. Fetch those files under the same content hash and cache locally, as Raidbots requests.
4. Validate top-level shapes and required fields before replacing a usable cache. Preserve the last valid snapshot if a refresh fails.
5. Fail clearly if data required for a requested operation is unavailable. Optional localized labels can fall back to an ID/display placeholder without blocking a valid engine run.
6. Do not silently switch live inputs to PTR/beta data.
7. Keep Raidbots dataset identity separate from SimulationCraft engine/data identity in result provenance.

The page mentions cache-busting query parameters for mutable aliases; it does not prescribe a polling interval. Routine aggressive cache busting is unnecessary. No full item/talent datasets were downloaded in this research.
