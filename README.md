# nyc-violations-mcp

A small, read-only [MCP](https://modelcontextprotocol.io) server that lets an AI assistant look up **NYC building
violations** (DOB, ECB and HPD) from public NYC Open Data and answer with short, caveated summaries instead of raw data dumps.
No API key needed.

**Who it is for:** people who track building compliance (property managers, brokers, compliance analysts, tenants) and want an
assistant to do the first pass. It is **not** a legal or compliance determination tool (see [Data caveats](#data-caveats-and-lag)).

## Example (real recorded output)

Asked about 350 5th Ave, Manhattan (the Empire State Building), the assistant calls `building_compliance_summary`. Selected
fields of the actual response, recorded live on 2026-11-03 (full output:
[`docs/evidence/inspector-building_compliance_summary.json`](docs/evidence/inspector-building_compliance_summary.json)):

<!-- example-source: docs/evidence/inspector-building_compliance_summary.json (tests/readme-example.test.ts checks every value below against it) -->
```json
{
  "data_quality_notes": [
    "7 of 7 open DOB record(s) carry a \"DELETED ...\" disposition comment and are probably not outstanding (open_excluding_deleted = 0). Verify in DOB's own system."
  ],
  "property": { "address": "350 5 AVENUE, New York, NY, USA", "bin": "1015862", "bbl": "1008350041", "borough": "Manhattan" },
  "agencies": {
    "DOB": { "open": 7, "closed": 684, "open_excluding_deleted": 0 },
    "ECB": { "open": 0, "closed": 241 },
    "HPD": { "coverage": "no HPD coverage expected or none found" }
  }
}
```

In words: 7 DOB records are still marked "ACTIVE" but all 7 carry a deletion note, ECB has nothing open, and HPD has no records
(it covers residential buildings only). Two full assistant conversations are [further down](#example-conversations-real-output).

## Why

Checking a building's violation history means juggling three agencies, three datasets with different status vocabularies,
and address/BIN/BBL conversions. This server gives an assistant five narrow tools that do that and return bounded,
caveated answers.

## Tools

All tools are read-only. Every response includes `sources` (source, dataset id, fetched_at), a top-level `fetched_at`,
and a notice that results may be incomplete, are not legal advice, and that text fields are untrusted data.

| Tool | Input | Use it when | Not for |
|---|---|---|---|
| `resolve_property` | one of `address`, `bin`, `bbl` (or `bin`+`bbl` to verify a pair) | You only have an address, or need to check a BIN/BBL pair | Fetching violations |
| `get_dob_violations` | `bin`, optional `status` (open/closed), `limit` (default 25, max 100) | DOB records for one building | ECB penalties, HPD housing violations |
| `get_ecb_violations` | same | Penalties, hearing status, balance due (OATH/ECB) | DOB or HPD records |
| `get_hpd_violations` | `bbl` or `bin`, `status`, `limit` | Residential housing-maintenance violations (Class A/B/C) | Commercial buildings (no HPD coverage) |
| `building_compliance_summary` | one of `address`, `bin`, `bbl` | First call for "what is the situation here?": open vs closed per agency, latest issue date, 5 most recent open items, links | Full detail of one agency |

Design choices that follow Anthropic's guidance on [writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents):
descriptions say when to use and when not to; responses are concise (text fields capped, whole response capped at ~12,000
characters, summaries before details); errors say what a valid value looks like and how to recover.

## Install and run

Requires **Node 22 or newer** (`engines: >=22`). Tested: Node 22.22.0 (fresh clone, 2026-11-07) and 24.22.2 (2026-11-02): build, all tests and server start pass; `npm test` prints the current count. **Node 20.20.2 does not work**: the SQLite cache module (`better-sqlite3` 13) crashes with a segfault and the test runner (vitest 5) does not support it. Other 22.x/24.x/later versions are UNVERIFIED (vitest declares `^22.12 || ^24 || >=26`; Node 25 was not tested). Not published to npm; install from GitHub:

```bash
git clone https://github.com/am718/nyc-violations-mcp.git
cd nyc-violations-mcp
npm ci
npm run build
npm test                        # offline: uses recorded fixtures, no network
echo "$PWD/dist/src/index.js"   # prints the absolute path to use in the configs below
```

Optional environment variables (see `.env.example`; never commit real values):

| Variable | Purpose |
|---|---|
| `SOCRATA_APP_TOKEN` | Optional Socrata app token for higher rate limits. The server works without it. **UNVERIFIED** with a real token: the header logic is unit-tested with a fake value; no real token was ever used. |
| `NYC_VIOLATIONS_CACHE_DB` | SQLite cache file (default `~/.cache/nyc-violations-mcp/cache.sqlite`; `:memory:` disables persistence) |
| `NYC_VIOLATIONS_CACHE_TTL_SECONDS` | Cache TTL (default 3600) |

### Claude Code

Save this as a JSON file (or a project `.mcp.json`), replacing the path with the absolute path printed above:

```json
{
  "mcpServers": {
    "nyc-violations": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/nyc-violations-mcp/dist/src/index.js"],
      "env": { "SOCRATA_APP_TOKEN": "" }
    }
  }
}
```

Tested: this JSON shape was loaded with `claude -p ... --mcp-config <file> --strict-mcp-config` and the tools were called
successfully (2026-11-02, see `docs/evidence/conversation-*.txt`; repeated 2026-11-07). **UNVERIFIED:** loading it from a project
`.mcp.json` (Claude Code asks for a one-time approval) and the one-liner `claude mcp add nyc-violations -- node /ABSOLUTE/PATH/TO/nyc-violations-mcp/dist/src/index.js`.

### Claude Desktop

Add the same `mcpServers` block, with the same absolute path, to `~/Library/Application Support/Claude/claude_desktop_config.json`
and restart Claude Desktop. **UNVERIFIED:** not tested in Claude Desktop (same stdio server and JSON shape as above).

### MCP Inspector

```bash
npm run inspect                       # opens the Inspector UI
scripts/inspect.sh --cli --method tools/list
scripts/inspector-check.sh            # all 5 tools via the Inspector CLI, live -> docs/evidence/ (redacted, then checked)
```

## Example conversations (real output)

Both were run with Claude Code against the live server on 2026-11-02 after the fix pass (`docs/evidence/conversation-1.txt`, `-2.txt`).

**1.** *"What's the violation situation at 1 Stuyvesant Oval, Manhattan?"* (tool used: `building_compliance_summary`)

> **1 Stuyvesant Oval (BIN 1082881, BBL 1009720001)** has one open violation across the three agencies.
>
> - **HPD:** 1 open, 62 closed. The open one is violation 17193699, issued 2024-08-15, for mold over 10 sq ft that needs its source traced and repaired. The most recent HPD issue date is 2025-12-19.
> - **DOB:** 0 open, 33 closed. The latest was issued 2020-04-07.
> - **ECB:** 0 open, 1 closed, from 2002.
>
> Caveats: the counts cover only this BIN. The lot holds about 34 other buildings, and their violations are not included. DOB "open" is a heuristic. Open-data extracts can lag city systems and may be incomplete; confirm with DOB, HPD and OATH.

**2.** *"Does 350 5th Ave, Manhattan have any open DOB violations?"*

> Probably not. 350 5th Ave (the Empire State Building, BIN 1015862) shows 7 DOB records marked "ACTIVE", but all 7 are old elevator violations from 1988-2010. Every one carries a disposition note saying it was deleted. The reasons given include wrong address, entered in error and incorrect date. The 1988 record actually belongs to 34 Fletcher St.
>
> The "open" status is a heuristic based on the record's category, so these are most likely stale entries and not outstanding violations. The data can also lag the city's systems. To be certain, check DOB's BIS/DOB NOW portal. This lookup covered DOB only, not ECB or HPD.

(Before the fix pass, conversation 1 reported lot-wide HPD counts as if they belonged to one building; the summary now counts one BIN and says how many
other buildings share the lot.)

## Data sources

| Dataset | ID |
|---|---|
| DOB Violations | `3h2n-5cm9` |
| DOB ECB Violations | `6bgk-3dad` |
| HPD Housing Maintenance Code Violations | `wvxf-dwi5` |

Address resolution uses [NYC Planning Labs GeoSearch](https://geosearch.planninglabs.nyc). Details, verified field names and
last-updated dates: [`docs/DATA.md`](docs/DATA.md).

**DOB open/closed rule:** the DOB dataset has no status column, so *open* means the text `ACTIVE` appears in
`violation_category`. This is a **heuristic**. Many "open" DOB records are decades old and carry notes like "DELETED BY ...
BECAUSE DUPLICATE". The summary keeps the raw `open` count and adds a second count excluding records annotated as deleted (DOB:
`open_excluding_deleted`) or written off (ECB: `open_excluding_written_off`), with a `data_quality_notes` array as the first key of the
response. Both rules are heuristics and nothing is silently reclassified (see `docs/DATA.md`). ECB uses `ACTIVE`/`RESOLVE`,
HPD uses `Open`/`Close`. All three mappings live in `src/status.ts`.

## Data caveats and lag

- Open data can lag official systems (DOB BIS/DOB NOW, HPD Online, OATH), and how often each dataset is refreshed varies. Measured
  2026-11-03 16:41 UTC (`rowsUpdatedAt` from `/api/views/<id>.json`): DOB `3h2n-5cm9` last updated 2026-11-02 18:38 UTC, ECB `6bgk-3dad`
  2026-10-31 17:10 UTC (about 3 days earlier, although the portal lists it as "Every weekday"), HPD `wvxf-dwi5` 2026-11-02 15:52 UTC
  (listed as "Daily"). Every response's `fetched_at` says when this server read the data; it is not the dataset's own update time.
- No result is legal advice or proof of compliance. An empty result is "none found", never "compliant".
- **HPD covers residential buildings only.** No HPD rows means "no HPD coverage expected or none found".
- Text fields (descriptions, comments, respondent names) come from public records and are untrusted: they are truncated,
  stripped of control characters, and returned as data only.
- Validation: [`docs/VALIDATION.md`](docs/VALIDATION.md) compares summary counts for 10 buildings against independent
  Socrata queries (all matched). It is an API-to-API check. Agreement with the official city systems (DOB BIS/DOB NOW, HPD
  Online, OATH) and with the Open Data web UI is **UNVERIFIED**.

## Safety

- No user text is ever placed into a Socrata query. Only digit-validated BIN/BBL parts are embedded (`src/socrata.ts`), fields and
  dataset ids are constants, and free-text addresses go only to GeoSearch as a URL-encoded parameter.
- Inputs are validated with zod; errors say what a valid value looks like.
- Record text is returned as data, but it can still influence a model that reads it. Responses put the untrusted-text notice and an `untrusted_text_fields` list before the data. Note that record text also drives status classification (a DOB category containing `ACTIVE` counts as open); that is classification, not instruction-following.
- 1 request/second, retry with exponential backoff, request timeout, SQLite TTL cache.

## How this compares to other servers

**UNVERIFIED:** checked once on 2026-11-01 and not re-checked since; third-party repos and listings change. Details and caveats in
[`docs/COMPARISON.md`](docs/COMPARISON.md). I read only one repo's code (nyc-property-intel); the rest are from directory listings.

- [ccedacero/nyc-property-intel](https://github.com/ccedacero/nyc-property-intel) (MIT, Python): a much broader due-diligence server
  (18 tools: ownership, tax, ACRIS, permits, crime, comps...) over its own Postgres mirror of the data. Use it if you want that breadth.
- [frogr/nyc-open-data-mcp](https://glama.ai/mcp/servers/frogr/nyc-open-data-mcp), [HT224/nycdata](https://glama.ai/mcp/servers/HT224/nycdata),
  [srobbin/opengov-mcp-server](https://mcpservers.org/en/servers/srobbin/opengov-mcp-server): generic Socrata/open-data access; the agent writes the queries.
- [MatchupLabs/nycapi](https://claudemarketplaces.com/mcp/matchup-labs/nycapi): property + violations tools behind an API key.

This project is deliberately narrow: five violation tools, no database to run, no API key, a hard response-size cap,
offline tests with recorded fixtures, and an explicit query-injection test.

## Limitations

- Only DOB, ECB and HPD violations. No permits, complaints, ownership, or OATH hearing details beyond the ECB dataset.
- One BIN per summary. `building_compliance_summary` counts DOB, ECB **and HPD** by the same BIN and returns a `footprint` field saying so, plus `other_bins_on_lot` (approximate count of other buildings on the same lot seen in DOB/HPD records, whose violations are not counted). For a lot like Stuyvesant Town (about 35 BINs) the summary covers one building only. `resolve_property` with a `bbl` lists other BINs on the lot (at most 9); when that list is partial it also returns `other_bins_total` (approximate) and `other_bins_truncated: true`. Measured for Stuyvesant Town: 8 listed, total 34.
- BIN/BBL inputs are resolved through DOB/HPD rows, so a valid BIN with no violation records anywhere cannot be resolved (use the address).
- GeoSearch always returns candidates and scores right and wrong ones alike (0.8 for street addresses; 1/exact even for "Queens" -> a Bronx building), so the score is not trusted. `resolve_property` refuses input that names only a borough, city or zip code; compares the house number, street name, street type, borough and zip you typed with each of GeoSearch's 10 closest candidates; and returns a building only when exactly one matches. Otherwise it returns an error showing the closest candidate, or every matching building, with BINs. Ambiguity is only seen among those 10 candidates. Every adversarial and control input tried, with its outcome: [`docs/ADDRESS_CASES.md`](docs/ADDRESS_CASES.md) (generated from the recorded cases); rules: `docs/DATA.md`.
- `building_compliance_summary` makes **12 to 14 upstream requests** at 1 request per second, so a cold call takes at least about 11 to 13 seconds. The count depends on the building: 12 is the base; +1 for each of DOB and ECB that has open records (a second count of annotated rows), and +1 when the BIN has to be looked up in HPD because DOB has no rows for it. Measured on 2026-11-02 on five buildings: 12 (Stuyvesant Town, by BIN), 13 (Empire State Building by address, by BBL; BIN 2130638), 14 (233 Broadway); 11.2 to 13.1 s each, and 19.0 s once when the upstream was slow. A repeat call is served from the cache in under 10 ms with 0 requests. `get_*_violations` make 3 requests (2.3 s measured); `resolve_property` by address makes 1 (0.1 s), by BBL 1 to 3 (3 when the lot has many address variants or buildings).
- Borough placeholder identifiers (BINs `X000000`; BBLs with block 00000/99999 or lot 0000) are rejected with a message to use the address, because thousands of unrelated records share them.
- Datasets or field names can change; `docs/DATA.md` records what was verified on 2026-11-01.
- Recorded test fixtures are real NYC Open Data responses with ECB `respondent_*` fields replaced by placeholders (the free-text violation descriptions are public text, with one private person's name, certificate/licence numbers and a few other unusual words redacted after a manual review; see `docs/DATA.md`).
- Responses are capped at ~12,000 characters, so a large `limit` can return fewer records (see `truncated`); recency lists contain dated records only and report `undated_excluded`.
- Worst-case latency is long when the upstream is failing (3 attempts of up to 15 s per request, plus backoff). The 1 req/sec limiter is per process.

## What I would build next

- Permits and DOB complaints tools, and ECB hearing detail.
- Tag likely-inactive DOB "ACTIVE" records (deleted/duplicate) as closed with a stated rule, after checking against DOB BIS.
- A multi-building (BBL-wide) summary for lots with several BINs.
- Compare against DOB/HPD official systems and the web UI, and track dataset freshness over time.
- Publish to npm and add CI (after review).

## Reviews and known weaknesses

Four reviews are kept in the repo on purpose, including what they found wrong: [`docs/reviews/REVIEW_REPORT.md`](docs/reviews/REVIEW_REPORT.md) (the builder's
self-review), [`docs/reviews/REVIEW_REPORT_INDEPENDENT.md`](docs/reviews/REVIEW_REPORT_INDEPENDENT.md) (a second pass),
[`docs/reviews/REVIEW_REPORT_FINAL.md`](docs/reviews/REVIEW_REPORT_FINAL.md) (a third pass with mutation testing and live checks) and [`docs/reviews/REVIEW_REPORT_GATE.md`](docs/reviews/REVIEW_REPORT_GATE.md)
(a push/no-push gate review). The second, third and gate reviews were run in the same session as the build, so they are not fully independent. [`REVIEW.md`](REVIEW.md) maps each finding to the commit that fixed it.

## Development

```bash
npm test                         # vitest, fixtures only
npm run build
node dist/scripts/record-fixtures.js   # re-record fixtures from live APIs (network)
npm run validate                 # 10-building live validation (network)
```

License: MIT.
