# Raidbots Developer Interfaces

Research date: 2026-09-25. Primary source: [Developers](https://www.raidbots.com/developers).

## Interface boundaries

| Capability | Publicly documented behavior | Project relevance |
| --- | --- | --- |
| Static game data | JSON datasets selected by environment, build, or content hash | Item/talent lookup and UI metadata |
| Existing report files | Files beneath an existing simulation report URL | Importing a result and its input |
| Talent embeds | Render a URL-encoded talent string in an iframe | Optional display, not simulation execution |
| Website integration | Pre-fill Armory region, realm, and character fields | Hand off to a user-driven web simulation |
| Aggregate analysis | Daily summaries of high observed simulations | Exploratory data, not a controlled benchmark |
| DBCache downloads | Verified/unverified lists and client cache files | Advanced game-data research; not needed for a first CLI experiment |
| Automated simulation submission | No supported contract identified in the reviewed documentation | Do not assume an available public simulation API |

The developer page does not establish an API-key issuance process, authentication header, supported job-creation endpoint, request schema, polling/cancellation contract, rate quota, pricing, or service-level guarantee for third-party simulation submission. Do not confuse Blizzard Armory API credentials with Raidbots credentials.

## Downloading an existing report

Documented pattern:

```text
https://www.raidbots.com/simbot/report/<report-id>/<filename>
```

| File | Contents | Availability stated by the developer page |
| --- | --- | --- |
| `data.json` | SimC JSON plus Raidbots metadata; top 200 actors plus base actor | Always generated |
| `input.txt` | Raw SimC input | Always generated; Smart Sim may transform actual execution, especially multistage runs |
| `preview.png` | Report preview image | Always generated |
| `data.full.json` | Untruncated JSON | Only for large profileset simulations; can be tens of MB |
| `data.csv` | Actor names and DPS metrics | Reports created after 2019-04-13; check `simbot.hasCsv` in `data.json` |
| `index.html` | SimC HTML report | Not generated for large profileset simulations |
| `output.txt` | SimC text output | Not generated for large profileset simulations |

“Always generated” describes a report's normal files, **not permanent availability**. The [privacy policy](https://www.raidbots.com/privacy) currently says simulation reports are stored for **28 days**; raw-data request archives are stored for up to **2 days**.

Implementation implications:

- Fetch only a known report the user intends to use; do not enumerate report IDs.
- Cache downloaded files locally and link to the original Raidbots report, as requested by the developer page.
- Retain `input.txt`, original JSON, report URL, and retrieval time together.
- A missing `data.full.json` or `index.html` may be normal. A missing required result must not become a successful zero-DPS result.
- Do not label `data.json` as a complete ranking for large runs. Handle truncation explicitly.
- An expired report is a retrieval failure, not proof that the original simulation failed.
- The report file's name is not its schema version. Inspect its contents before parsing.

No report was downloaded during this research: no user report URL was supplied, and the documentation's example report is not evidence of a still-live fixture.

## User-driven website integration

The documented query parameters are `region`, `realm`, and `name`:

```text
https://www.raidbots.com/simbot/quick?region=<region>&realm=<realm-slug>&name=<character-name>
```

URL-encode values. Realm identifiers use the Blizzard realm **slug**, not the display name. This pre-fills Armory input; it does not constitute a job-submission API or automatically run a simulation.

Talent-tree embeds use:

```text
https://www.raidbots.com/simbot/render/talents/<url-encoded-talent-string>
```

The developer page describes static server-rendered HTML by default, with optional display parameters and an interactive-app mode. Treat this as a display integration only.

## Other published resources

- Analysis: `https://www.raidbots.com/static/analysis/top/summary.csv` and `https://www.raidbots.com/static/analysis/top/details.json`.
- Historical analysis names: `YYYY-MM-DD-summary.csv` and `YYYY-MM-DD-details.json` under the same `top/` directory.
- The page describes daily generation around 10:30 UTC, using the highest observations within the last 30 days and the top 100 actors per specialization from Quick Sim / Top Gear. Custom APLs and nonstandard addon input are excluded.
- These are selected observations, not normalized tests of class balance. Gear, encounters, versions, and sampling bias prevent treating them as a controlled ranking.
- DBCache lists: `/api/dbcache/verified` and `/api/dbcache/unverified` on `www.raidbots.com`.
- DBCache files: `https://storage.googleapis.com/raidbots-static/wow/<environment-or-build>/enUS/DBCache.bin`. The example environment is `retail`, unlike the static JSON alias `live`. Numeric builds omit major/minor/patch components.
- Verified caches come from Raidbots' NA/enUS collection; unverified caches are opt-in community submissions described as retained for 30 days. Neither is a guaranteed-safe or complete game model.

These auxiliary resources were documented, not downloaded or integrated.

## Usage restrictions and unresolved access

The [Terms of Use](https://www.raidbots.com/tou) contain broad restrictions on non-browser automated site access and disproportionate infrastructure load. The developer page separately invites use of its published files, with local caching. Do not infer permission for automated simulation submission or broad site scraping from the public download documentation.

Before any hosted automated integration, confirm with Raidbots:

1. Whether the intended integration is permitted and whether a supported interface is available.
2. Authentication, payload format, job lifecycle, errors, and cancellation behavior.
3. Request/concurrency limits, compute limits, pricing, and retention.
4. Allowed reuse and redistribution of reports and game-data files.

No numeric API rate limit or supported polling interval was established in this research. Inventing either would create a false integration contract.

See [static data](../data/static-game-data.md), [manual workflow](simulation-workflow.md), and the [source register](../sources/README.md).
