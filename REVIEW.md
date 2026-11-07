# REVIEW.md: handoff for the Opus 5.5 reviewer

Built by Sonnet 5.5 (no subagents were used). All work is inside `dev/nyc-violations-mcp`. Nothing was pushed, published or made public.
Git history is local (`git log --oneline`). Facts below were checked on 2026-11-01. Anything not verified is marked **UNVERIFIED**.

## 1. What was built

A TypeScript MCP server (official `@modelcontextprotocol/sdk`, stdio, zod validation) with five read-only tools:
`resolve_property`, `get_dob_violations`, `get_ecb_violations`, `get_hpd_violations`, `building_compliance_summary`.
It queries three NYC Open Data Socrata datasets (DOB `3h2n-5cm9`, ECB `6bgk-3dad`, HPD `wvxf-dwi5`) and uses NYC Planning Labs
GeoSearch for address -> BIN/BBL. It has a SQLite TTL cache, 1 req/sec limiter, retry with backoff, request timeout, a
response-size cap, a single place for per-dataset status mapping and for date normalization, coverage notes instead of bare
zeros for HPD, offline vitest tests with recorded fixtures, inspector scripts, a 10-building validation, README and docs.

## 2. How to run

```bash
npm install && npm run build
npm test                           # builds, then runs every test offline (vitest prints the count); tests/setup-no-network.ts makes any global fetch throw
npm run check:network-guard       # shows the no-network guard both ways: a scratch fetch test fails with it, passes without it
bash scripts/inspect.sh            # Inspector web UI
bash scripts/inspect.sh --cli --method tools/list
bash scripts/inspector-check.sh    # all 5 tools via Inspector CLI, LIVE network, writes docs/evidence/inspector-*.json
npm run validate                   # 10-building live validation (network)
node dist/scripts/record-fixtures.js   # re-record fixtures (network)
```

Server entry: `node dist/src/index.js` (note `dist/src/`, because tsconfig `rootDir` is `.` so scripts compile too).

## 3. Claims and what proves them

| Claim (file) | Proof |
|---|---|
| Dataset IDs, fields, update dates (docs/DATA.md) | Live queries to `/api/views/<id>.json` and `/resource/<id>.json`, 2026-11-01. Re-run: `curl https://data.cityofnewyork.us/api/views/3h2n-5cm9.json` |
| GeoSearch available and returns BIN/BBL (DATA.md) | `curl "https://geosearch.planninglabs.nyc/v2/search?text=350%205th%20Ave%20Manhattan&size=1"`; recorded in `tests/fixtures/http/` |
| GeoSearch cannot resolve a bare BIN/BBL (design reason for DOB/HPD lookup) | Tested live during build with `text=1008350041`, `text=1015862`: 0 features. Not recorded as a fixture. |
| DOB/ECB `lot` is 5-digit padded; BBL lot is 4-digit (DATA.md) | Live `curl` with `lot='00041'` (matched); bug found and fixed in `src/ids.ts` `joinBbl` / `src/socrata.ts` `locatorClause`. Tested in `tests/tools.test.ts` "locatorClause only ever embeds validated digits" |
| 5 tools work through the MCP Inspector | `scripts/inspector-check.sh`; raw outputs in `docs/evidence/inspector-*.json` (CLI mode; the Inspector web UI v2.13.0 was also driven headlessly in the final review: all 5 tools OK, placeholder BIN rejected; see `docs/reviews/REVIEW_REPORT_FINAL.md`) |
| Tool descriptions say when / when not to use | `docs/evidence/inspector-tools-list.json`; test "lists the 5 read-only tools with WHEN-to-use descriptions" |
| Responses carry source, dataset id, fetched_at, notice | `src/format.ts` `envelope`; tests "resolves an address..." and "summary shape"; evidence files |
| HPD empty -> coverage note, never bare 0; Empire State fixture test | `tests/tools.test.ts` "coverage, not zero (HPD)" (3 tests); `src/tools/violations.ts` `HPD_COVERAGE_NOTE`; `src/tools/summary.ts` |
| DOB open rule = "ACTIVE" in `violation_category`, a heuristic (DATA.md, README) | `src/status.ts`; `tests/status-and-dates.test.ts` |
| 13 ACTIVE rows with a disposition are recorded and tested | `tests/fixtures/dob_active_with_disposition.json` (recorded live), test "the 13 real ACTIVE DOB rows" |
| Status mapping in one place | `src/status.ts` (`STATUS_MAPPER`, `STATUS_CLAUSE`, `STATUS_FIELD`); tests "per-dataset status mapping" |
| Dates normalized in one place before sorting | `normalizeDate`, `byDateDesc` in `src/normalize.ts`; tests "date normalization" |
| BIN/BBL disagreement -> fix-it error | `resolveProperty` in `src/resolve.ts`; tests "BIN/BBL disagreement" (3 tests) |
| Address resolved once (GeoSearch); DOB/ECB by BIN, HPD by BBL/BIN | `src/tools/summary.ts`, `src/tools/violations.ts` |
| Injection safety | Section 4; tests "query-injection attempts" (4 tests incl. through the MCP protocol) |
| Size cap (~12,000 chars; text fields 300) | `src/format.ts` `capList`, `src/config.ts` `LIMITS`; tests "response size cap" |
| Timeout / retry / empty / malformed rows | tests "resilience (synthetic stubbed responses)" (synthetic data, labeled in the test names) |
| Cache TTL and 1 req/sec spacing | tests "cache and rate limiter" (fake clock, injected sleep) |
| Tests need no network | `tests/setup-no-network.ts` + `vitest.config.ts` |
| 10-building validation, all matched | `docs/VALIDATION.md`, `docs/evidence/validation-output.md`, `scripts/validate.ts`. **It is an API-to-API cross-check. The final review compared the Open Data web UI on 8 searches: the UI search is full text and equals the API `$q` count in 8 of 8 (it differs from an exact BIN filter in 6 of 8, as documented). Re-run after Fixes 3: see section 9** |
| README config works in Claude Code | Same JSON shape loaded with `claude -p --mcp-config ... --strict-mcp-config`; tool was called successfully (`docs/evidence/conversation-*.txt`). Persistent install via `claude mcp add` **UNVERIFIED**; the project-scoped `.mcp.json` path showed "Pending approval" and was not approved |
| README config works in Claude Desktop | **UNVERIFIED** (not tested) |
| Example conversations are real output | `docs/evidence/conversation-1.txt`, `-2.txt` (Claude Code `-p --model sonnet`). Which model the `sonnet` alias resolved to is **UNVERIFIED** |
| App token support (`SOCRATA_APP_TOKEN` -> `X-App-Token` header, Socrata host only) | `src/http.ts` line ~42. **UNVERIFIED** with a real token (none used; never printed). The header logic is unit tested with a fake token |
| Comparison with other servers (README, docs/COMPARISON.md) | Only nyc-property-intel was read (GitHub API/raw files, not cloned or run). All other entries are from search-result listings (**UNVERIFIED** beyond that) |
| No secrets in repo | `.env.example` has an empty value; grep of the tree for token/secret/password/api key shows only variable names and docs |

## 4. Every place that handles untrusted input or builds a query

- `src/ids.ts`: zod schemas for `address`, `bin`, `bbl`, `status`, `limit` (regexes, length, control-char check, numeric coercion). `normalizeBbl` for hyphenated BBL.
- `src/server.ts`: `run()` wraps each tool; only `ToolError` messages are shown, other exceptions become a generic message (details to stderr, no stack, no URLs).
- `src/socrata.ts`:
  - `digits()` the only function that quotes a value into SoQL; it throws unless the value is all digits (BIN and BBL patterns enforced in `locatorClause`).
  - `locatorClause`, `queries.*` build all `$where`/`$select`/`$group`/`$order` from constants plus `digits()` output; `buildUrl` uses `URLSearchParams` and clamps `$limit`.
  - Response validation: non-array bodies rejected; `count()` tolerates NaN.
- `src/status.ts`: `STATUS_CLAUSE` fixed SQL fragments (no interpolation).
- `src/resolve.ts`: the address goes into the GeoSearch URL via `URLSearchParams`. The GeoSearch response is untrusted: BIN/BBL are re-validated by regex; labels pass through `cleanText`. User text echoed in errors is `cleanText`-truncated to 80 chars. BIN/BBL derived from DOB/HPD rows are regex-validated before reuse.
- `src/normalize.ts`: `cleanText` (control chars, whitespace, truncation), `normalizeDate`, `mapRow` (allowlisted fields only, junk -> null, rows without id skipped).
- `src/format.ts`: `capList` size cap; `envelope` adds the "untrusted data" notice to every response.
- `src/http.ts`: URLs are internally built only; token header only to `data.cityofnewyork.us`; token never in a URL, log or cache key.
- `src/cache.ts`: SQLite with prepared statements (`?` params); keys are URLs.
- `src/tools/summary.ts`: `encodeURIComponent` on record ids placed in returned links.

Untrusted text that is returned to the model (still a prompt-injection surface, mitigated but not eliminated): DOB `description`, `disposition_comments`,
`violation_type`; ECB `violation_description`, `severity`, hearing fields; HPD `novdescription`; address labels. They are truncated, control-stripped,
returned as data, and accompanied by the notice. There is no sanitization of instruction-like *words*.

## 5. Known weaknesses

1. **DOB open/closed is a heuristic and overstates open items.** The raw `open` count still includes records annotated `DELETED`; the summary now adds `open_excluding_deleted` and `data_quality_notes`, but both are heuristics (other annotations, e.g. "BARAMIS OVERNIGHT RUN", are not excluded). (Fix 3)
2. ECB raw `open` includes `WRITTEN OFF`; `open_excluding_written_off` is reported as a second count. HPD/ECB mapping is otherwise literal. (Fix 3)
3. Multi-building lots: the summary now counts all three agencies by one BIN and reports `footprint` + an approximate `other_bins_on_lot` (max distinct BINs seen in DOB/HPD, minus 1), so it can undercount buildings with no records in either dataset. A lot like Stuyvesant Town is still only covered one building at a time. (Fix 1)
4. BIN/BBL-only resolution depends on that property having DOB or HPD rows; otherwise the user is told to use the address.
5. The BIN/BBL "agree" check relies on DOB lot data (and HPD); it does not consult an authoritative PAD source.
6. GeoSearch match quality: its score is the same for right and wrong matches (0.8, or 1/exact for names, including "Queens" -> a
   Bronx building), so it is not used. Since Fixes 4 the tool refuses place-only input, compares house number, street name (in order),
   street type, borough and zip with each of 10 candidates, and returns a building only if exactly one matches (`docs/DATA.md`,
   `docs/ADDRESS_CASES.md`). What could still return a wrong building, as far as the self-check found: (a) ambiguity is only seen
   among the 10 candidates GeoSearch returns, so the same address in another borough ranked lower would be missed when no borough
   is typed (asking for each of the 11 no-borough successes, 10 addresses and "City Hall", in each of the 4 other boroughs, 44 live
   checks, found none); (b) a house-less input that exactly equals a building's name resolves to that building, even if the caller
   meant a place of the same name; (c) the check trusts GeoSearch's own house number, street and BIN for the candidate (its borough
   name is checked against the BIN digit).
7. Rate limiter is per-process; two server instances can exceed 1 req/sec in aggregate. Worst-case latency with retries is long (3 attempts x 15 s per request).
8. Fixture lookup is keyed by exact request URL: changing the query builder requires re-recording (`record-fixtures`). Fixtures are re-recorded from live APIs; ECB `respondent_*` fields and certificate/licence numbers are redacted at record time; free-text descriptions were reviewed once by hand (Fixes 3) and must be reviewed again after re-recording. All commits, including the original ones, now hold redacted fixtures (history was rewritten and scrubbed).
9. `src/index.ts` is covered by `tests/startup.test.ts` (built server over real stdio, cache fallback, stdout hygiene); the wiring to a real MCP client is exercised only by Inspector runs (Claude Code and Claude Desktop runs are UNVERIFIED).
10. SDK validation errors for bad input arrive as MCP error -32602 text ("... at bin"), not as the server's own wording; the zod messages are included.
11. `status` filter lists exclude `unknown`-status rows (counts in the summary include an `unknown` bucket when present).
12. Validation counts are independent of the builder but come from the same backend as the web UI; they cannot reveal upstream data problems.
13. `get_*` tools do two upstream requests (count + page); a dataset update between them can make `total_matching` and `returned` disagree slightly.
14. No CI, no lint config, no npm packaging metadata beyond `package.json` (marked `private`).

## 6. Unfinished / not done

- Claude Desktop test; `claude mcp add` persistent install test (UNVERIFIED). The Inspector web UI session was done in the final review (v2.13.0, all 5 tools, plus a rejected placeholder BIN).
- Comparison against the official city systems (DOB BIS / DOB NOW, HPD Online, OATH) is UNVERIFIED. The Open Data web UI comparison was done in the final review (8 searches on 5 buildings: the UI search is full text and equals the API's `$q` count in 8 of 8; see `docs/VALIDATION.md`).
- App-token path never run with a real token (header behavior is unit tested with a fake token).
- (Done) Git history rewritten: noreply author/committer on every commit; old fixtures scrubbed. Verified with the history searches listed in the final fix report.
- HPD list pagination beyond `limit` (max 100) is not offered (by design: summaries first), so full histories are not retrievable.
- Dataset `rowsUpdatedAt` is recorded in DATA.md as of 2026-11-01 only; no freshness check at runtime.

## 7. Fixes (second pass, responding to [REVIEW_REPORT.md](docs/reviews/REVIEW_REPORT.md); that report is unchanged apart from removing local paths)

Commits are listed oldest to newest. The hashes are those of the **rewritten** history (author/committer set to the GitHub noreply address; old fixtures scrubbed of ECB respondent names; session trailers and local paths removed in a second rewrite). Earlier histories exist only in backup bundles kept outside the repo.

| Finding ([REVIEW_REPORT.md](docs/reviews/REVIEW_REPORT.md)) | Status | Commit | What changed / evidence |
|---|---|---|---|
| M1 summary mixes BIN and lot footprints; README:155 false | Fixed | `a9c62c3` Fix 1 | DOB, ECB, HPD all by the resolved BIN; `footprint` + `other_bins_on_lot` always returned; README corrected. Tests "fix 1: consistent footprint" with a recorded Stuyvesant Town lot |
| M2 HPD "newest first" wrong (NULLs first) | Fixed | `ceba04d` Fix 2 | Verified live: NULLs sort first on DESC, `NULLS LAST` accepted but not relied on. Recency queries filter to dated rows; `undated_excluded` reported. Same check applied to DOB/ECB: junk text dates (e.g. `Y30819`) sorted above real ones, now filtered. Tests "fix 2" (live fixtures + synthetic junk) |
| M3 "open" counts mislead; warnings buried | Fixed (heuristic, documented) | `19519f7` Fix 3 | Raw `open` kept; added DOB `open_excluding_deleted` and ECB `open_excluding_written_off`; `data_quality_notes` is the first key of the summary; flagged items marked, not reclassified. docs/DATA.md and README document the rule. Tests "fix 3" (Empire State 7 raw / 0 excluding; Grand Central ECB) |
| m1 `limit` max 100 vs size cap | Fixed (documented) | `49486c3` Fix 4 | Tool descriptions and README state the ~12,000-char cap and `truncated`. Also fixed in `19519f7`: the cap was exceeded by ~160 chars because truncation fields were added after measuring |
| m2 fixtures hold respondent names; personal author email | Fixed (new fixtures and rewritten history) | `a9c62c3` (redaction at record time) | History rewritten: every commit has the noreply author/committer and redacted fixtures. `LICENSE` keeps the user's full name by the user's decision |
| m3 untrusted-text notice placement | Fixed | `19519f7`, `49486c3` | `notice` and `untrusted_text_fields` precede the data in every response; docs note that record text also drives classification |
| m4 case-sensitive status enum | Deliberately not fixed (reason was wrong; see Fixes 2) | n/a | The original reason ("a case-insensitive pre-process would erase the `enum` from the JSON schema") was incorrect: `z.preprocess(lowercase, z.enum(...))` keeps the enum in the published schema. Only a `transform(...).pipe(...)` form loses it. Fixed in the second pass |
| m5 loose coercion (arrays accepted; unknown keys ignored) | Deliberately not fixed | n/a | Harmless (verified the emitted query is unchanged); the SDK builds a non-strict object from the shape, and rejecting arrays would also require dropping the clean JSON schema |
| m6 Retry-After ignored; per-process limiter; no token test; index.ts untested | Partly fixed | `49486c3` | Retry-After honored (capped at 10 s) and tested; X-App-Token header unit test (fake token). Not fixed: per-process limiter (documented), `src/index.ts` wiring untested (listed above), worst-case latency (documented) |
| m7 summary performance | Mitigated | `49486c3` | Summary made 13 upstream requests then (superseded in Fixes 3: 12 to 14 depending on the building); tool description says so and that results are cached for an hour |

Re-verification after the fixes: `npm test` (64 passing at that time, no-network guard on), `scripts/inspector-check.sh` (all 5 tools, evidence refreshed), `npm run validate`
(10 of 10 buildings match independent direct queries, by BIN; `docs/VALIDATION.md` regenerated; web-UI comparison still UNVERIFIED), example conversations regenerated
with the fixed server (`docs/evidence/conversation-*.txt`).

## 8. Fixes 2 (responding to [REVIEW_REPORT_INDEPENDENT.md](docs/reviews/REVIEW_REPORT_INDEPENDENT.md); that report is unchanged apart from removing local paths)

The history was rewritten again for items 2 and 3, and again for Fixes 3 (fixture free text, session-link text); all hashes in this file are those after the **final** rewrite. A backup bundle of each earlier history is kept outside the repo.
The session-link trailer is no longer added to commits; the Co-Authored-By line is kept.

| Finding | Status | Commit | What changed / evidence |
|---|---|---|---|
| M1 placeholder BINs accepted (and the analogous BBL placeholders) | Fixed | `09913a1` Fix 1 | `X000000` BINs rejected in every tool, in GeoSearch/DOB-derived values and in the query builder, with "use the address". BBL placeholders verified live (DOB 5,842 rows with block/lot 00000 across 811 BINs; ECB 178) and rejected the same way (block 00000/99999 or lot 0000). `tests/placeholder-bins.test.ts` |
| M2 session link in all commit messages | Fixed | whole history (rewrite) | Every session-link trailer removed from all commits; author and committer stay the noreply identity. Verified by the history search commands in the session transcript |
| Local paths, username, session ids in docs and history | Fixed | `67f3fcf` Fix 3 + history rewrite | Review reports moved to `docs/reviews/` and linked; absolute paths and scratch directory references removed from the tree and from every commit; an accidentally tracked `.vitest/` output file (it held absolute paths) removed and ignored |
| m1 `status` enum rationale wrong | Fixed | `c86aa28` Fix 4 | `z.preprocess(lowercase, z.enum(...))`: any letter case accepted, enum still published (verified through the MCP SDK `tools/list`). The wrong rationale in the Fixes table row m4 above is corrected |
| m2 impossible dates pass the filter | Fixed | `c86aa28` Fix 4 | SoQL now requires a real month/day (10 more DOB rows excluded live, e.g. `19108124`); Feb 29 in a non-leap year (3 DOB rows) is caught in code; both count toward `undated_excluded` (verified live for BIN 1081244) |
| m3 `limit` accepts odd values | Fixed | `c86aa28` Fix 4 | Only integers or plain digit strings 1-100; rejects booleans, hex, floats, exponents, signs, padding, arrays |
| 127 hostile inputs only existed in a scratch script | Fixed | `c86aa28` Fix 4 | `tests/hostile-inputs.test.ts`: 160 cases with expected outcomes and a strict URL allowlist |
| m4 latency / request counts inconsistent | Fixed | `8339eda` Fix 6 | Summary = 13 upstream requests then (superseded in Fixes 3: 12 to 14); measured 12.1 s earlier and 17.9-23.7 s on re-measure; stated in the tool description, README and this file |
| m5 DOB/ECB descriptions lack the resolve_property hint | Fixed | `f488f9c` Fix 5 | "Requires a BIN: if you only have an address, or are unsure of the BIN, call resolve_property first" |
| m6 HPD schema has no `required` | Fixed (best the SDK allows) | `f488f9c` Fix 5 | Published as an object with `anyOf: [{required:[bbl]},{required:[bin]}]` plus a clear runtime error; tests over the published schema |
| m7 `REVIEW_REPORT.md` in history | Kept on purpose | `67f3fcf` | Both reports are kept under `docs/reviews/` as an honest record |
| Web-UI full-text search note | Documented | `8339eda` Fix 6 | `docs/VALIDATION.md`: UI search is full text, totals can be +1; `$q` matches the UI exactly |

Still UNVERIFIED: Claude Desktop config; a live Socrata app token (header logic is unit tested with a fake token); comparison with the official city systems
(DOB BIS/NOW, HPD Online, OATH).


## 9. Fixes 3 (responding to [REVIEW_REPORT_FINAL.md](docs/reviews/REVIEW_REPORT_FINAL.md))

| Finding | Status | Commit | What changed / evidence |
|---|---|---|---|
| M1 wrong addresses matched silently | Fixed | `c1574e9` | Verified live that GeoSearch returns `confidence 0.8`, `match_type fallback` for right and wrong matches alike (recorded in `docs/DATA.md`), so the score is not used. `src/address.ts` compares the typed house number, street (abbreviations, ordinals, directions, Saint), borough and zip with the match; a mismatch is an error showing the candidate and its BIN, never a success. "123 Fake Street, Queens", "Lot 1 Block 1, Manhattan" and "9999 5th Ave, Manhattan" fail (recorded live responses); correct addresses, abbreviations and case variants pass (37 live inputs checked, one real-world spelling "Centre St" added after the live check). If no borough/zip was typed, the match carries a note naming the borough assumed |
| M2 rate limiter race | Fixed | `cdbff55` | Callers chained on a promise. Fake-timer tests: 5 concurrent calls start at least 1000 ms apart; retries/backoff interleaved with other callers stay spaced; a failed call does not block the queue. Real-time repro: gaps 1004, 1003, 1001, 1002 ms (was 1003, 1, 0, 0) |
| m1 flat "13 requests" | Fixed | `464adf4` | Measured 12 to 14 (12 Stuyvesant Town by BIN, 13 Empire State Building and BIN 2130638, 14 233 Broadway); reasons in README |
| m2 `other_bins_on_lot` counts placeholder BINs | Fixed | `880348a` | `bin NOT LIKE '_000000'` in the distinct-BIN count (verified live on DOB and HPD); BIN 2130638 now reports 0 others (test with recorded counts) |
| m3 "Node 20+" unverified | Fixed (claim was wrong) | `ddac86a` | Tested Node 20.20.2 (fails: `better-sqlite3` segfault, vitest unsupported), 22.22.0 and 24.22.2 (build, all tests, server start pass). `engines` is `>=22`; other versions UNVERIFIED |
| m4 partial BIN list not marked | Fixed | `861bef5` | `other_bins_total` and `other_bins_truncated` when the list is partial (Stuyvesant Town: 8 listed, total 34) |
| m5 docs lag | Fixed | `e50d75d` | README review section, UNVERIFIED lines closed with the final review's evidence, this section |
| m6 history tidiness | Fixed | final history rewrite (no commit of its own; this file's hashes were updated in the commit that follows it) | The temp-directory word and the truncated session-link string removed from the tree and all commit messages; the two review files that rode along in Fix 1 commits stay (the reports are kept on purpose) |
| m7 test gaps / 3 mutation survivors | Fixed | `9edcc15`, `f1bf49b` | New tests exercise each layer alone; re-ran each mutation and it now fails a test. `tests/startup.test.ts` covers the cache fallback and real-stdio start-up |
| Fixture free text (37 unusual words) | Fixed | `ce70c1d` | Counts only: 37 words; 19 in code-like system fields (kept), 8 typos/inflections (kept), 10 redacted; one private person's name plus certificate numbers redacted (tree and history). Recorder blanks `CERT#`/`LIC#`; review new free text by hand after re-recording |
| Move `REVIEW_REPORT_FINAL.md` to `docs/reviews/` | Fixed | `e50d75d` | README and this file link to the new path |

## 10. Fixes 4 (responding to [REVIEW_REPORT_GATE.md](docs/reviews/REVIEW_REPORT_GATE.md))

Done by Opus 5.5 (no subagents). Every check below was run on 2026-11-03.

| Finding | Status | Commit | What changed / evidence |
|---|---|---|---|
| MAJOR 1: "Queens" / "Queens, NY" returned a Bronx building as a success | Fixed | `58b5ecc`, `3d4dd21` | Fixed as a class, not just the case. Input naming only a borough, city or zip (also misspelt, or after a house number) is refused before any request and again inside the matcher. The street is split into name and type (last word); names must be equal and in order and types must agree, so a type word never matches by itself; house-less input must equal the candidate's name exactly ("Empire State Building" still resolves). 10 GeoSearch candidates are compared and a building is returned only if exactly one distinct BIN matches ("Borough Hall", "350 Fifth Ave", "1 Main St" are now errors listing every match). Misspelt boroughs in the place part are recognised; two boroughs, or a typed borough/zip the candidate cannot confirm, are refused; the candidate's borough name must agree with its BIN digit ("The Bronx" normalized). Run live: every input in `docs/ADDRESS_CASES.md` (generated; outcome and reason per input). No wrong building came back as a success. Run against the previous matcher, 8 of them were wrong successes; all 8 are now errors. `tests/address-cases.test.ts` replays every recorded case offline (outcome and BIN) and checks every place-only input against all its recorded candidates; `tests/address-match.test.ts` has unit tests per rule |
| Minor: two words left between "BY" and a redacted name in one fixture (2 places) | Fixed | history rewrite (no commit of its own) + `1b3fb67` | Fresh bundle outside the repo first; `git filter-branch --tree-filter` over all 34 commits (the words were in 3 blobs and 26 commits), then refs/original deleted, reflog expired, gc with prune. All fixtures and evidence searched for letters next to REDACTED: 0 directly adjacent, no other name-like word before it. `scripts/redact.ts` now also blanks words signed between "BY" and CERT/LIC; `tests/redaction.test.ts` scans every committed fixture and evidence file |
| Minor: DOB staff identifiers ("DELETED BY" plus 3 letters) | Kept by design | none | Agency staff initials, not private persons (`docs/DATA.md`) |
| README "290 tests" (hand-typed count) | Fixed | `382eea6` | Counts removed from README and this file; `npm test` prints the count. The address-case count lives only in the generated `docs/ADDRESS_CASES.md` |
| README "updated within about a day" | Fixed | `382eea6` | Measured `rowsUpdatedAt` per dataset (DOB 2026-11-02 18:38 UTC, ECB 2026-10-31 17:10 UTC, HPD 2026-11-02 15:52 UTC; checked 2026-11-03 16:41 UTC), cadence varies, and what `fetched_at` means |
| README third-party comparison not labelled | Fixed | `382eea6` | Labelled UNVERIFIED in README and `docs/COMPARISON.md` (checked once 2026-11-01, not re-checked) |
| No-network guard shown only one way | Fixed | `382eea6` | `npm run check:network-guard`: a scratch test fetching a local server fails with the guard ("NETWORK USED IN TEST") and passes without it (`vitest.no-guard.config.ts` includes only that scratch file); plain Node, no sed, no internet. Run in a clean clone: both outcomes as expected |
| Gate report location | Fixed | `382eea6` | `docs/reviews/REVIEW_REPORT_GATE.md`, linked from README and this file; local temp paths and search-pattern text neutralized; hashes remapped |
| (found during verification) regenerating the Inspector evidence brought back 2 redacted words | Fixed | `fd60ac0` | Redacted again; `tests/redaction.test.ts` now fails if a word redacted in a fixture appears unredacted in the same text in the evidence (it failed on the regenerated file before the fix). Evidence refreshed live: all 5 tools, plus new borough-only and ambiguous cases |

Self-check: (1) a re-read of the diff found the "The Bronx" borough-name variant and a missing BIN/borough consistency check (`3d4dd21`);
what could still return a wrong building is listed in section 5, item 6. (2) Mutation check in a temp clone (clean baseline: all tests
pass): 16 mutations, each disabling one new guard (pre-request place-only refusal, the matcher's place-only rule, misspelt boroughs,
ordered name equality, type agreement, ambiguity check, 10 -> 1 candidates, two-borough rule, borough and zip confirmability, borough
vs BIN digit, borough normalization, NFKC/invisible-character cleaning, last-token type rule, the new redaction rule, the house-number
check): all 16 caught. (3) The 12 correct gate-review addresses still resolve (live, real stdio server, clean clone); the 25 bad ones
give 24 errors and one success that is the typed address itself ("350 5th Ave, Brooklyn" -> 350 5 AVENUE, Brooklyn).

Verification: clean clone on Node 22.22.0 (`npm ci`, build, all tests pass, `npm run check:network-guard` both ways); Inspector run of all
5 tools (`fd60ac0`); 10-building validation re-run live 2026-11-03T16:51Z: 10 of 10 match and every count is identical to
`docs/VALIDATION.md` (all 10 addresses resolve under the new matcher). Hashes earlier in this file were remapped after the Fixes 4
history rewrite (by commit subject; subjects unchanged).

## 11. Fixes 5 (responding to the 2026-11-07 pre-publish gate run)

Done by Opus 5.5 (no subagents) on 2026-11-07. The gate run stopped before publishing because the README failed its check;
the other items below were found in the same run.

| Finding | Status | Commit | What changed / evidence |
|---|---|---|---|
| README: no example on the first screen; install said "clone/copy the folder, then `npm install`"; "Status: local, unpublished" | Fixed | `169fb17` | First screen: what it does, who it is for, then selected fields of the recorded `building_compliance_summary` output (`docs/evidence/inspector-building_compliance_summary.json`). `tests/readme-example.test.ts` checks every value in the excerpt against that file and that it comes before the long explanation. Install: `git clone https://github.com/am718/nyc-violations-mcp.git`, `cd`, `npm ci`, `npm run build`, `npm test`, plus a command that prints the absolute path for the Claude Code and Claude Desktop configs. Status line removed. UNVERIFIED labels kept or made explicit: Claude Desktop, project `.mcp.json` and `claude mcp add`, a live app token, the official systems and web UI, third-party servers |
| The grade-average abbreviation and the local-username search term appeared in review-report checklist lines (no grade value anywhere) | Fixed in the current tree | `bb1856e` | Rows now say "no academic or personal details" and "the local username"; the gate report no longer quotes the author display name. 0 occurrences of either in the tree outside the noreply identity. History not rewritten, as instructed: the old wording remains in 6 historical blobs (the abbreviation) and 1 (the search term) |
| `docs/COMPARISON.md` heading carried an internal note about not claiming "first" or "only" | Fixed | `8630526` | Heading is now "How this project differs" |
| `scripts/validate.ts` `indep()` read `res.json()` unchecked: an upstream error body became NaN and was reported as "MISMATCH" (2 of 10 in the gate run) | Fixed | `91d96a0` | `scripts/independent-count.ts`: a body must be exactly one row with one non-negative integer; network errors, 429, 5xx and malformed bodies are retried (4 tries, 2 s / 4 s / 8 s backoff); other 4xx and exhausted retries throw `IndependentQueryError`; the row says ERROR and the process exits 1. `tests/validate-indep.test.ts` fakes each failure; 4 mutations of the new guards were each caught |
| `scripts/inspector-check.sh` wrote raw live output: two words redacted by hand in the fixtures came back in the ECB evidence (caught by the test, not by the script) | Fixed | `5d66806` | One rule set for fixtures and evidence (`scripts/redact.ts`), now including the 9 hand-redacted words as truncated SHA-256 hashes (built by aligning the live records behind the fixtures with the redacted fixtures: 16 of 17 fields reproduced exactly, 746 of 746 string fields identical, none of the words in any historical blob). `scripts/redact-evidence.ts` applies it to every file the script writes; the script then runs `tests/redaction.test.ts` and `tests/evidence-redaction.test.ts` and exits 1 if they fail. Live proof in a temp clone of the same tree: the ECB file was redacted on write, "redaction check: passed", and all 6 regenerated data files are identical to the committed ones apart from `fetched_at`. A test fails if any tracked file (not only fixtures and evidence) contains a listed word. 5 mutations caught |
| This table | Added | (this commit) | |
