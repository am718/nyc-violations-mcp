# Comparison with existing servers

**UNVERIFIED as of 2026-11-03:** these findings come from one bounded, read-only check via GitHub web/API on 2026-11-01 and were
not re-checked; third-party repos and listings change. Nothing was cloned or run.
Everything below was read from the repo's public pages and is as of that date.

## ccedacero/nyc-property-intel (closest overlap)

Confirmed:
- MIT license, 7 stars, 1 fork, 0 open issues, Python, last push 2026-10-23, 298 commits.
- 18 tools, broad due-diligence scope (ownership, tax, ACRIS, permits, crime, comps, etc.). Violations are covered by
  `get_property_issues` (HPD + DOB + ECB, by BBL) and `analyze_property` (summary).
- Violation queries use parameterized SQL against its own Postgres mirror (not live Socrata).
  `limit` 1-200 (default 25) applies per table, so source=ALL can return up to 600 raw rows.
  Rows are returned as stored, including free-text fields. No overall byte/character cap.
- Its Socrata client passes `$where` as a raw string with no escaping; callers must build safe SoQL. No response cache there.
- Tests: many, mocked/in-process, but no recorded HTTP/JSON fixtures (only one tiny Python fixture module).
  The security test covers LIKE-escaping and auth middleware, not query injection.
- Includes a `data_as_of` note and verification links.

Not confirmed: how its Postgres mirror is populated in practice, hosted-service limits, code quality beyond the files read.

## Others (from search-result listings only; code not read)
- [frogr/nyc-open-data-mcp](https://glama.ai/mcp/servers/frogr/nyc-open-data-mcp): generic read-only Socrata access, 2,400+ datasets.
- [HT224/nycdata](https://glama.ai/mcp/servers/HT224/nycdata): generic dataset search/describe/query/profile.
- [srobbin/opengov-mcp-server](https://mcpservers.org/en/servers/srobbin/opengov-mcp-server): one `get_data` tool for any Socrata portal.
- [MatchupLabs/nycapi](https://claudemarketplaces.com/mcp/matchup-labs/nycapi) (`@matchuplabs/nyc-api-mcp`): includes `get_building_violations`; needs an API key.

## How this project differs (do not claim "first" or "only")
Safe, bounded, tested, keyless: five narrow read-only tools over live NYC Open Data, a validated/escaped query builder,
an overall response size cap, summaries first, SQLite TTL cache, offline tests with recorded fixtures including an
injection test, and no required API key or database.
