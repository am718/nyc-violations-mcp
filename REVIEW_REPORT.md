# REVIEW_REPORT.md

Reviewer: Claude Sonnet 5.5, run inside the **same session that built the project**, at the user's request. This is **not an independent review in the strict sense**: I remember the build and share its blind spots. To compensate, every conclusion below rests on a command I ran during this review. The commands and scratch scripts are in the temp directory outside the project; none were added to the repo. Date of review: 2026-11-01. A separate fresh-context review (for example the planned Opus 5.5 session) would still add value.

Scope followed: read files, run tests, run the inspector CLI, run read-only GETs against NYC Open Data and GeoSearch, write this one file. I changed nothing else (`git status --short` was empty before writing this file). I did not run `scripts/inspector-check.sh`, because it overwrites `docs/evidence/`. I used the inspector CLI directly with output sent to the temp directory.

## Verdict: ready after fixes

The build is solid on the things it was asked to be solid on. Query construction is safe: none of ~40 hostile inputs changed query structure. The 46 tests are real and the no-network guard works. Counts match my independent re-queries for all 3 buildings I rechecked. Git history has no pushes and no secrets. It is not ready to make public as-is, for two reasons that both produce **wrong or misleading answers to the exact question the flagship tool exists to answer**. First, `building_compliance_summary` silently mixes footprints: DOB/ECB are counted for one BIN while HPD is counted for the whole tax lot, and the README claims otherwise. For Stuyvesant Town, that is 1 building of at least 35 against the whole lot. Second, HPD "newest first" ordering is wrong because Socrata sorts NULLs first and about 7% of HPD rows have no NOV date. Add a third, narrower concern: the headline DOB "open" count can be entirely records marked deleted, and ECB "open" includes written-off items. Neither is flagged where an agent will read it. All three are fixable in small changes. No blockers.

## Claims table

| # | Claim (where) | Proof I used | Result |
|---|---|---|---|
| 1 | Dataset IDs `3h2n-5cm9`, `6bgk-3dad`, `wvxf-dwi5` and field names (docs/DATA.md) | Earlier live `/api/views/<id>.json` reads; this review's own queries on `bin`, `bbl`, `violation_category`, `violationstatus`, `disposition_*`, `novissueddate` all returned data | VERIFIED |
| 2 | GeoSearch resolves addresses to BIN/BBL | Live GET for 3 addresses; BIN/BBL match README/VALIDATION (e.g. 350 5th Ave -> 1015862 / 1008350041, confidence 0.8, `match_type: fallback`) | VERIFIED |
| 3 | 13 ACTIVE DOB rows carry a disposition date | Live count today: 13. Fixture file `tests/fixtures/dob_active_with_disposition.json` has 13 rows | VERIFIED |
| 4 | "All 7 open DOB records at the Empire State Building say DELETED" (DATA.md, VALIDATION.md) | Live query: 7 ACTIVE rows, all 7 `disposition_comments` start with "DELETED BY" | VERIFIED |
| 5 | DOB/ECB `lot` is a 5-digit padded text column; BBL lot is 4 digits | `src/socrata.ts:51-52`; live query `boro='1' AND block='00835' AND lot='00041'` returns rows | VERIFIED |
| 6 | VALIDATION.md counts for 10 buildings | Rechecked 3 myself with direct queries (below). All 3 match | VERIFIED (3 of 10); other 7 UNVERIFIED by me |
| 7 | "ECB open includes WRITTEN OFF" (DATA.md) | Live: Grand Central, ECB `status=open`: both rows returned have hearing_status `WRITTEN OFF`. The DATA.md count of 59,165 matches the earlier distinct query | VERIFIED |
| 8 | 46 tests pass offline (README/REVIEW.md) | `npx vitest run`: 2 files, 46 passed | VERIFIED |
| 9 | Tests never touch the network (`tests/setup-no-network.ts`) | Scratch test with the project's setup file: a call to `fetch(...)` throws "NETWORK USED IN TEST". Control run without the guard: no throw | VERIFIED. Limit: it guards global `fetch` only; tests inject fetch stubs, so this is the right layer |
| 10 | "No user text is ever placed into a Socrata query" (README Safety) | Code read + 40 hostile calls with all emitted URLs checked against a strict allowlist of query shapes (see below) | VERIFIED |
| 11 | All 5 tools work through the MCP Inspector | Inspector CLI: `tools/list` shows 5 read-only tools; `get_ecb_violations`, `get_dob_violations` calls succeeded. The Inspector **web UI** was not opened | VERIFIED via CLI; UI UNVERIFIED |
| 12 | Tool descriptions say when / when not to use | Read via inspector `tools/list` (see "Tool design") | VERIFIED, with ambiguities noted |
| 13 | Responses carry source, dataset id, fetched_at, notice | Seen in every response I inspected; `src/format.ts` `envelope` | VERIFIED |
| 14 | Response size cap ~12,000 chars | `get_dob_violations bin=1015862 limit=100` returned 11,368 chars, `truncated: true`, 25 of 100 | VERIFIED |
| 15 | HPD empty -> coverage note, not bare 0 | Tests plus live tool run for the Empire State Building (earlier smoke output, and this session's `get_hpd_violations`): `coverage` field + note, counts null in summary | VERIFIED |
| 16 | Dates normalized in one place; sorting across YYYYMMDD and ISO | Unit tests pass; `normalizeDate` read. Real-data sorting is **not** correct for HPD (Finding 2) | PARTLY VERIFIED: normalization correct, HPD "newest first" FAILED |
| 17 | "A lot with several buildings is reported with `other_bins_on_lot`" (README:155) | Address `1 Stuyvesant Oval, Manhattan` (35 BINs on the lot): summary `notes: null`; `other_bins_on_lot` only set in `resolveBbl` (`src/resolve.ts:138`), never in `resolveAddress` | **FAILED** (true only for bbl input) |
| 18 | "DOB/ECB counts are for the chosen BIN only" (README:155) | True; but HPD is by BBL (`src/tools/summary.ts:71,76`), which README does not say for the summary | PARTLY: see Finding 1 |
| 19 | Example conversations are real output | Conversation 1 numbers (HPD 15 open/611 closed, DOB 0/33, ECB 0/1) match my live recount (HPD 15/626, DOB 0/33, ECB 0/1) | VERIFIED. Conversation also repeats the footprint problem (Finding 1) |
| 20 | README Claude Code config works | Not re-run. I did not re-run `claude -p --mcp-config` in this review | UNVERIFIED by me |
| 21 | README Claude Desktop config works | Not testable here | UNVERIFIED |
| 22 | `SOCRATA_APP_TOKEN` header path | Code read: header sent only to `data.cityofnewyork.us`, not in URL/cache key (`src/http.ts:42`). No test, no real token | UNVERIFIED (code looks right) |
| 23 | No GPA; no "first"/"only" product claims in README | `grep -n -i -E "\bGPA\b|\bfirst\b|\bonly\b|\bunique\b|\bbest\b|novel"` on README/docs. The remaining hits are limitations ("Only DOB, ECB and HPD") and the "First call" usage hint, not superiority claims. `docs/COMPARISON.md:28` even says not to claim "first"/"only" | VERIFIED |
| 24 | No push; local only; no secrets | `git remote -v`: empty; one branch `main`; 8 commits; see Hygiene | VERIFIED |
| 25 | Comparison with other MCP servers | Not re-checked (needs web research). nyc-property-intel was read by the builder only via GitHub; others from listings | UNVERIFIED |
| 26 | 10 buildings' addresses resolve first try | Rechecked 3 only | PARTLY |

## Findings

### Blockers
None.

### Major

**M1. `building_compliance_summary` silently mixes footprints (BIN vs whole lot), and README claims otherwise.**
- Where: `src/tools/summary.ts:71-76` (`hpdLoc` is `{by:"bbl"}`, DOB/ECB use `{by:"bin"}`); `src/resolve.ts` `resolveAddress` (never sets `other_bins_on_lot`; only `resolveBbl` does, line 138); note logic `src/tools/summary.ts:82`; README.md:155.
- What is wrong: for an address (the headline input) the summary reports DOB/ECB for one BIN and HPD for the whole BBL, with no note. A lot can hold many buildings.
- Reproduce: summary for `1 Stuyvesant Oval, Manhattan` returns `property.bin 1082881`, DOB 0 open/33 closed, HPD 15 open/611 closed, `notes: null`. Independent: that BBL has 35 distinct HPD BINs; HPD for the BIN alone = 63 rows vs 626 for the BBL; DOB rows for the lot are spread over many BINs (e.g. 1082766: 130, 1082869: 127). An agent will read "DOB 33, HPD 626" as one building.
- Suggested fix: always compute `other_bins_on_lot` (DOB group-by on the resolved BBL), emit the note for every input type, and state in each agency section which key was used (`scope: "BIN 1082881"` / `"BBL 1009720001 (whole lot)"`). Either query HPD by BIN to match, or label HPD as lot-wide. Also fix README:155. Also mention in the `get_hpd_violations` description that `bbl` is lot-wide and `bin` is building-level.

**M2. HPD "newest first" and "5 most recent open items" are wrong when rows lack `novissueddate`.**
- Where: `src/socrata.ts:59` (`DATE_FIELD.hpd = novissueddate`) and the `order` at line 66; fallback `src/normalize.ts:117`; re-sort only inside the fetched page (`src/tools/violations.ts` `items.sort(byDateDesc)`).
- What is wrong: Socrata puts NULLs first for `DESC`. 812,468 HPD rows have no NOV date (228,588 of them Open). The page is filled with null-NOV rows in arbitrary order before any dated rows; the tool then labels them with their inspection date and sorts only that page. Tie order is also unstable (the same query with and without `$select` returned different rows).
- Reproduce: `curl -G https://data.cityofnewyork.us/resource/wvxf-dwi5.json --data-urlencode "\$where=bbl = '2051410120' AND violationstatus = 'Open'" --data-urlencode "\$order=novissueddate DESC" --data-urlencode "\$limit=3"` returns rows with `novissueddate` absent and inspection dates of 2025-11-24; with `$select=violationid,novissueddate,inspectiondate` a different set (2026-10-30). That BBL has 1,598 open null-NOV rows with inspection dates 2015-03-03 to 2026-10-30, so which 5 are "most recent" is arbitrary. For Stuyvesant Town the raw order puts a null-NOV 2025-12-31 row ahead of 2026-10-02 rows (the summary re-sorts it correctly only because there is one such row).
- Suggested fix: order HPD by a column that is always populated (verify `inspectiondate` is never null), or add a second ordering key / filter `novissueddate IS NOT NULL` for the "most recent" query, or fetch more and sort after normalization. Add a fixture test using a BBL with null-NOV rows.

**M3. Headline "open" counts can mislead and the warnings are not where an agent reads them.**
- Where: `src/status.ts` (DOB rule, ECB `ACTIVE`); `src/tools/summary.ts` (counts); `src/tools/violations.ts` notes.
- What is wrong: (a) DOB: Empire State shows `open: 7` and all 7 are "DELETED BY ... BECAUSE ..."; dataset-wide 31,936 of 573,684 ACTIVE rows (5.6%) have a comment but no disposition date. The caveat exists (`open_with_disposition_notes`, per-item `caveat`), but the list tool only adds a generic heuristic note and the per-record caveat is buried in each item; an agent summarising `open: 7` will state 7 open violations. (b) ECB: `ACTIVE` includes `WRITTEN OFF` hearing status; Grand Central's "6 open" ECB items include written-off ones; the summary does not flag this at all. (c) 1,049 DOB rows have category `V%-DOB VIOLATION` and 2 have none: status `unknown`, excluded from open/closed filters.
- Reproduce: DOB count for `bin='1015862' AND violation_category like '%ACTIVE%' AND (disposition_date IS NOT NULL OR disposition_comments IS NOT NULL)` = 7 of 7; `get_ecb_violations bin=1035381 status=open limit=2` shows `hearing_status: WRITTEN OFF` on both.
- Suggested fix: surface a top-level `open_count_caveat` next to the number in both summary and list tools; add `written_off` to the ECB section; consider reporting `open_confirmed` vs `open_with_notes` rather than one `open`. The README already says it is a heuristic, so this is about placement, not honesty.

### Minor

- **m1. `limit` advertises 1-100 but the size cap makes ~25 the practical maximum for DOB.** `limit=100` returned 25 of 100 (11,368 chars). `src/ids.ts:49-53`, `src/format.ts` `capList`. The truncation note is clear; consider documenting the effective maximum in the tool description.
- **m2. Privacy/publicity: fixtures and git identity.** `tests/fixtures/http/` contains raw ECB rows including `respondent_name` (public data, but names of individuals and businesses). The git author identity is a personal Gmail address (`git log` author on all 8 commits). Consider redacting fixtures before a public push and rewriting author metadata if you do not want it public.
- **m3. Untrusted-text placement.** The notice is the last key of the JSON (after the violation text) (`src/format.ts` `envelope`). Prompt-injection via record text is mitigated (truncation, control-char stripping, notice) but not eliminated. Consider putting the notice first and marking text fields (e.g. `text_fields_untrusted: [...]`). Also note data text influences classification: a DOB category containing "ACTIVE" flips a record to open (`src/status.ts`); this is data-driven classification, not instruction-following, but worth a sentence in the docs.
- **m4. Case-sensitive status enum.** `status: "OPEN"` is rejected (helpful message though). Agents commonly send "Open". Consider a case-insensitive preprocess while keeping the JSON schema as an enum.
- **m5. Loose input coercion.** `z.coerce.string()` accepts arrays (`["1015862"]` was accepted and ran) and silently drops unknown keys (`$where`, `$limit`, `__proto__` were ignored; I confirmed the emitted URL was unchanged). Harmless, but `z.strictObject` would turn silent ignoring into an error.
- **m6. Network handling.** `Retry-After` is ignored (`src/http.ts`); the rate limiter is per process; worst case 3 x 15 s per request, so a cold summary with failures could take minutes. No test covers the app-token header (`src/http.ts:42`) or `src/index.ts` cache fallback.
- **m7. Summary performance.** About 8-10 requests at 1 req/s (README says ~10 s); fine, but a note could tell agents not to call it repeatedly.

## Hostile input results

Method: scratch script, in-memory MCP client/server over the built `dist/`, stubbed network that returns empty shapes and records every URL. Every Socrata URL emitted was parsed and checked against an allowlist: only `$select/$where/$group/$order/$limit`, a known dataset path, `$where` composed only of `bin = 'DDDDDDD'`, `bbl = 'DDDDDDDDDD'`, `boro/block/lot` digit triples and the fixed status fragments, `$limit` 1-1000. Result for all accepted calls: `structure: ok`. **No input changed query structure.**

| Input | Outcome |
|---|---|
| bin `1015862' OR '1'='1` | Rejected by schema, 0 requests |
| bin `1015862 OR 1=1` | Rejected, 0 requests |
| bin `1015862;DROP TABLE x` | Rejected, 0 requests |
| bin fullwidth digits `１０１５８６２` | Rejected, 0 requests |
| bin `1015862\n' OR 1=1` | Rejected, 0 requests |
| bin `1015862\n` (trailing newline) | Trimmed to a valid BIN and accepted; query was `bin = '1015862'` |
| bin `["1015862"]` (array) | Coerced to a valid BIN, accepted (m5) |
| bin object, empty string, 100,000 characters, `1e6`, `0000000` | All rejected, 0 requests |
| status `open' OR 1=1` and `OPEN` | Rejected (m4 for case) |
| limit `1e9`, `-1`, `2.5`, `"5; DROP"` | Rejected |
| limit `"1e2"` | Coerced to 100, accepted, harmless |
| Extra args `$where=1=1`, `$limit=99999`, `__proto__` | Silently ignored; emitted URL unchanged |
| bbl `1008350041' OR 1=1 --` | Rejected, 0 requests |
| bbl `1-00835-0041\n`, `1-1-1` | Normalized to valid 10-digit BBLs, accepted; digits only in the query |
| bbl `1-123456-1` (block too long) | Rejected |
| hyphen bbl with injected tail, via summary | Rejected |
| `get_hpd_violations` with bbl (Manhattan) + bin (Bronx) | Error: "bin ... is in Bronx but bbl ... is in Manhattan ... Pass only one"; 0 requests |
| `resolve_property` bin 1015862 + bbl 2046540021 | Same borough-mismatch error |
| Same-borough wrong-lot pair (bin 1015862, bbl 1008350042) | Error "belongs to bbl 1008350041, not 1008350042 ... matching pair" (covered by test, seen earlier live; not re-run here) |
| Address empty, whitespace-only, 10,000 characters | Rejected by schema |
| Address with NUL and ESC control characters | Rejected |
| Address `350 5th Ave' UNION SELECT * --` | Sent to GeoSearch only, 1 request, no Socrata request |
| Address `350 5th Ave&$where=1=1&$limit=1000000#frag'; DROP` | One GeoSearch URL, fully percent-encoded: `text=350+5th+Ave%26%24where%3D1%3D1%26%24limit%3D1000000%23frag%27%3B+DROP&size=1`. No extra parameters |
| Address `350 5th Ave/../../evil?x=y` | Encoded, GeoSearch only |
| Address with Arabic-Indic digits, emoji, RTL override | Encoded, GeoSearch only |
| address + bin together | Error "Pass either address OR bin/bbl, not both" |
| Direct `digits()` on `1\n`, ` 1`, `1;`, `""`, `١٢٣`, `1e5`, `-1`, `0x1F`, 11 digits | All throw. `00000` returns `'00000'` (digits only, safe) |
| `locatorClause` with injected bin/bbl or `\n`-suffixed values | Throws in every case |

I also read every place that builds queries or handles input: `src/ids.ts` (schemas), `src/socrata.ts` (`digits`, `locatorClause`, `queries`, `buildUrl`), `src/status.ts` (`STATUS_CLAUSE` constants), `src/resolve.ts` (GeoSearch URL via `URLSearchParams`, response re-validated by regex), `src/normalize.ts` (`cleanText`, allowlisted fields), `src/http.ts`, `src/cache.ts` (prepared statements). I found no path where user text reaches SoQL.

## Untrusted text
Read through `src/normalize.ts`, `src/tools/*.ts` and `src/server.ts`: data text is only (a) truncated and control-stripped by `cleanText`, (b) copied into response fields, (c) used for status classification by substring (DOB category) or exact match (ECB/HPD). Nothing in the server executes, evals, fetches or follows text from records; record ids placed in links go through `encodeURIComponent`. A test confirms an "IGNORE PREVIOUS INSTRUCTIONS" description is returned as data with no extra requests. Residual risk (m3): the model that reads the response can still be influenced by record text; the notice is advisory.

## Data correctness: 3 buildings re-checked with my own queries

Direct queries, no server code. `open/total`:

| Building | DOB (VALIDATION.md vs mine) | ECB | HPD (bbl) |
|---|---|---|---|
| Empire State, BIN 1015862 | 7/691 vs 7/691 | 0/241 vs 0/241 | 0/0 vs 0/0 (also 0 by BIN) |
| Grand Central, BIN 1035381 | 154/157 vs 154/157 | 6/26 vs 6/26 | 0/0 vs 0/0 |
| Stuyvesant Town, BIN 1082881 | 0/33 vs 0/33 | 0/1 vs 0/1 | 15/626 vs 15/626 (but 63 by BIN: M1) |

Other checks: the 13 ACTIVE rows with a disposition date still exist (13 today; 10 "DELETED ...", 2 "PAID INVOICE", 1 with junk date `7`, per the fixture); HPD returns 0 rows for Empire State, Chrysler and Woolworth (coverage note correct); the Dakota has 1 closed HPD row (matches); one DOB `issue_date` is null and 13 are not 8-character dates (handled as null by `normalizeDate`). Date sorting is correct for DOB/ECB text dates and for normalization across formats, but not for HPD null-NOV rows (M2).

## Tool design

- `resolve_property`: clear. Says one of address/bin/bbl, when to use first, and not for violations.
- `get_dob_violations`, `get_ecb_violations`: good "use for / not for" text and the heuristic is stated up front. The DOB description does not warn that "open" can include records deleted as duplicates (M3).
- `get_hpd_violations`: good coverage warning. Ambiguity: `bbl` (lot-wide) vs `bin` (building) give different results and the description does not say so (M1).
- `building_compliance_summary`: strong "best first call" guidance and honest latency note. Ambiguity: the mixed BIN/BBL footprint (M1).
- Errors are actionable (borough mismatch, matching pair, address format with example, "Use resolve_property first"). Schema validation errors arrive as MCP -32602 text with an " at bin" suffix.
- Size: tool outputs I saw were 0.7-11 KB; hard cap 12,000 chars. Reasonable.

## Hygiene

- `git remote -v`: empty. `git branch -a`: only `main`. 8 commits, authored by the user's personal address (m2).
- Secrets: `git grep` across all revisions for key/secret/password/bearer/token patterns, excluding the variable names in docs and code, found nothing; no 40+ character high-entropy strings in history outside the lockfile and fixtures; `.env.example` is the only `.env*` file ever tracked and its value is empty; no `SOCRATA_APP_TOKEN` assignment with a value anywhere.
- README has no GPA and no "first"/"only" claims (claim 23).
- Working tree clean before this report; the review created only temp directory files outside the repo.

## What I could not check and why

- **Web UI comparison** (VALIDATION.md's stated gap): the Open Data web pages are JavaScript apps; I can only query the same backend API. Closing it: a person filters `data.cityofnewyork.us/d/<id>` by BIN/BBL for a few buildings and compares to the VALIDATION.md table.
- **Official systems (DOB BIS/NOW, HPD Online, OATH)**: no access here. Closing it: compare 3 buildings manually with DOB's public property profile and HPD Online.
- **Claude Desktop config**: Claude Desktop is not available here. Closing it: paste the README block into `claude_desktop_config.json` and call a tool.
- **Claude Code persistent install (`claude mcp add`)** and re-running `claude -p --mcp-config`: not repeated in this review (they spend model calls, and the first needed approval). Closing it: run the README one-liner and `claude mcp list`.
- **Inspector web UI**: I used the CLI only.
- **SOCRATA_APP_TOKEN path**: no token available and I must not handle secrets. Closing it: add a unit test that asserts the `X-App-Token` header is sent only to `data.cityofnewyork.us` and never appears in a URL or cache key; optionally run once with a real token.
- **Other servers in docs/COMPARISON.md**: no web research here. Closing it: have a person open the 4 listed repos and confirm their tool lists and licenses.
- **7 of 10 buildings in VALIDATION.md**: I rechecked 3. Closing it: re-run `npm run validate` and diff.
- **Which model the `sonnet` alias used for the README example conversations**: unknowable from the repo. Closing it: re-run with an explicit model id and record it.

## Checklist

- [x] Only REVIEW_REPORT.md was created, nothing else changed (`git status --short` was empty before writing it; scratch files live in the temp directory outside the project)
- [x] Test suite run (46 passed) and no-network guard checked (guarded test throws; unguarded control does not)
- [x] 10 hostile inputs tried (about 40)
- [x] 3 buildings independently re-checked
- [x] git remote and history checked for pushes and secrets
- [x] Verdict given: ready after fixes
