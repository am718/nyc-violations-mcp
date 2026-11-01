# nyc-violations-mcp

A small, read-only [MCP](https://modelcontextprotocol.io) server that lets an AI assistant look up **NYC building
violations** (DOB, ECB and HPD) from public NYC Open Data. Safe, bounded, tested and keyless.

> Status: local, unpublished portfolio project (v0.1.0). Not on npm.

## Problem and who it is for

Checking a building's violation history means juggling three agencies, three datasets with different status vocabularies,
and address/BIN/BBL conversions. This server gives an assistant five narrow tools that do that correctly and return
**short, caveated answers** instead of raw data dumps. It is aimed at people who track building compliance for properties
(property managers, brokers, compliance analysts, tenants) and want an assistant to do the first pass.

It is **not** a legal or compliance determination tool. See [Data caveats](#data-caveats-and-lag).

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

## Install and run (local)

Requires Node 20+. Not published to npm: clone/copy the folder, then:

```bash
npm install
npm run build
npm test            # offline: uses recorded fixtures, no network
```

Optional environment variables (see `.env.example`; never commit real values):

| Variable | Purpose |
|---|---|
| `SOCRATA_APP_TOKEN` | Optional Socrata app token for higher rate limits. The server works without it. |
| `NYC_VIOLATIONS_CACHE_DB` | SQLite cache file (default `~/.cache/nyc-violations-mcp/cache.sqlite`; `:memory:` disables persistence) |
| `NYC_VIOLATIONS_CACHE_TTL_SECONDS` | Cache TTL (default 3600) |

### Claude Code

Add to a `.mcp.json` (or your Claude Code MCP config), replacing the path with your absolute path:

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

Tested: this JSON shape was loaded by Claude Code (`claude -p ... --mcp-config`) and the tools were called successfully
(see `docs/evidence/conversation-*.txt`). The `claude mcp add` one-liner is untested: `claude mcp add nyc-violations -- node /ABSOLUTE/PATH/dist/src/index.js`.

### Claude Desktop

Add the same `mcpServers` block to `~/Library/Application Support/Claude/claude_desktop_config.json` and restart Claude Desktop.
**UNVERIFIED:** not tested in Claude Desktop (same stdio server and JSON shape as above).

### MCP Inspector

```bash
npm run inspect                       # opens the Inspector UI
scripts/inspect.sh --cli --method tools/list
scripts/inspector-check.sh            # calls all 5 tools via the Inspector CLI against live data -> docs/evidence/
```

## Example conversations (real output)

Both were run with Claude Code against the live server on 2026-11-01 (`docs/evidence/conversation-1.txt`, `-2.txt`).

**1.** *"What's the violation situation at 1 Stuyvesant Oval, Manhattan?"* (tool used: `building_compliance_summary`)

> **1 Stuyvesant Oval (Stuyvesant Town), BIN 1082881, BBL 1009720001**
> - **HPD:** 15 open and 611 closed. The latest were issued 2026-10-02. They are mostly plaster and paint repairs (§ 27-2005). One open item from 2025-12-31 says apartments were vacated by HPD and can't be reoccupied until HPD orders it.
> - **DOB:** 0 open and 33 closed. The latest was issued 2020-04-07.
> - **ECB:** 0 open and 1 closed, from 2002.
>
> Caveats: open-data extracts can lag official city systems; DOB "open" status is a heuristic; only the 5 most recent open items were listed, so severity classes weren't available; not legal advice.

**2.** *"Is 350 5th Ave, Manhattan clean on HPD violations?"*

> No HPD violation records turned up for 350 5th Ave (BBL 1008350041, BIN 1015862). That doesn't show the building is clean. This address is the Empire State Building, which is commercial. HPD only covers residential buildings, so it wouldn't be expected to have records there.
>
> The address match had only 0.8 confidence, so confirm the BBL is the right property. To check compliance, look at DOB and ECB violations, which I can pull if you want. Open-data extracts can also lag the city's official systems.

(The server returned an HPD coverage note instead of a bare `0`, which is why the assistant did not call the building compliant.)

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
BECAUSE DUPLICATE"; the tool flags these (`open_with_disposition_notes`, per-record `caveat`). ECB uses `ACTIVE`/`RESOLVE`,
HPD uses `Open`/`Close`. All three mappings live in `src/status.ts`.

## Data caveats and lag

- Open data can lag official systems (DOB BIS/DOB NOW, HPD Online, OATH). Datasets were updated within about a day when checked.
- No result is legal advice or proof of compliance. An empty result is "none found", never "compliant".
- **HPD covers residential buildings only.** No HPD rows means "no HPD coverage expected or none found".
- Text fields (descriptions, comments, respondent names) come from public records and are untrusted: they are truncated,
  stripped of control characters, and returned as data only.
- Validation: [`docs/VALIDATION.md`](docs/VALIDATION.md) compares summary counts for 10 buildings against independent
  Socrata queries (all matched). It is an API-to-API check, **not** a comparison against the web UI or the official city systems.

## Safety

- No user text is ever placed into a Socrata query. Only digit-validated BIN/BBL parts are embedded (`src/socrata.ts`), fields and
  dataset ids are constants, and free-text addresses go only to GeoSearch as a URL-encoded parameter.
- Inputs are validated with zod; errors say what a valid value looks like.
- 1 request/second, retry with exponential backoff, request timeout, SQLite TTL cache.

## How this compares to other servers

Checked 2026-11-01; details and caveats in [`docs/COMPARISON.md`](docs/COMPARISON.md). I read only one repo's code
(nyc-property-intel); the rest are from directory listings.

- [ccedacero/nyc-property-intel](https://github.com/ccedacero/nyc-property-intel) (MIT, Python): a much broader due-diligence server
  (18 tools: ownership, tax, ACRIS, permits, crime, comps...) over its own Postgres mirror of the data. Use it if you want that breadth.
- [frogr/nyc-open-data-mcp](https://glama.ai/mcp/servers/frogr/nyc-open-data-mcp), [HT224/nycdata](https://glama.ai/mcp/servers/HT224/nycdata),
  [srobbin/opengov-mcp-server](https://mcpservers.org/en/servers/srobbin/opengov-mcp-server): generic Socrata/open-data access; the agent writes the queries.
- [MatchupLabs/nycapi](https://claudemarketplaces.com/mcp/matchup-labs/nycapi): property + violations tools behind an API key.

This project is deliberately narrow: five violation tools, no database to run, no API key, a hard response-size cap,
offline tests with recorded fixtures, and an explicit query-injection test.

## Limitations

- Only DOB, ECB and HPD violations. No permits, complaints, ownership, or OATH hearing details beyond the ECB dataset.
- One BIN per property. A lot with several buildings is reported with `other_bins_on_lot`, and DOB/ECB counts are for the chosen BIN only.
- BIN/BBL inputs are resolved through DOB/HPD rows, so a valid BIN with no violation records anywhere cannot be resolved (use the address).
- GeoSearch matches can be low confidence; the confidence is reported.
- The summary needs about 8-10 upstream requests (1 req/sec), roughly 10 seconds on a cold cache.
- Datasets or field names can change; `docs/DATA.md` records what was verified on 2026-11-01.
- Recorded test fixtures contain public record text, including ECB respondent names, as returned by NYC Open Data.

## What I would build next

- Permits and DOB complaints tools, and ECB hearing detail.
- Tag likely-inactive DOB "ACTIVE" records (deleted/duplicate) as closed with a stated rule, after checking against DOB BIS.
- A multi-building (BBL-wide) summary for lots with several BINs.
- Compare against DOB/HPD official systems and the web UI, and track dataset freshness over time.
- Publish to npm and add CI (after review).

## Development

```bash
npm test                         # vitest, fixtures only
npm run build
node dist/scripts/record-fixtures.js   # re-record fixtures from live APIs (network)
npm run validate                 # 10-building live validation (network)
```

License: MIT.
