# REVIEW.md: handoff for the Opus 5.5 reviewer

Built by Sonnet 5.5 (no subagents were used). All work is inside `dev/nyc-violations-mcp`. Nothing was pushed, published or made public.
Git history is local (`git log --oneline`). Facts below were checked on 2026-11-01. Anything not verified is marked **UNVERIFIED**.

## 1. What was built

A TypeScript MCP server (official `@modelcontextprotocol/sdk`, stdio, zod validation) with five read-only tools:
`resolve_property`, `get_dob_violations`, `get_ecb_violations`, `get_hpd_violations`, `building_compliance_summary`.
It queries three NYC Open Data Socrata datasets (DOB `3h2n-5cm9`, ECB `6bgk-3dad`, HPD `wvxf-dwi5`) and uses NYC Planning Labs
GeoSearch for address -> BIN/BBL. It has a SQLite TTL cache, 1 req/sec limiter, retry with backoff, request timeout, a
response-size cap, a single place for per-dataset status mapping and for date normalization, coverage notes instead of bare
zeros for HPD, 64 offline vitest tests with recorded fixtures, inspector scripts, a 10-building validation, README and docs.

## 2. How to run

```bash
npm install && npm run build
npm test                           # 64 tests, offline; tests/setup-no-network.ts makes any global fetch throw
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
| 5 tools work through the MCP Inspector | `scripts/inspector-check.sh`; raw outputs in `docs/evidence/inspector-*.json` (CLI mode only; the web UI was not opened: **UNVERIFIED**) |
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
| 10-building validation, all matched | `docs/VALIDATION.md`, `docs/evidence/validation-output.md`, `scripts/validate.ts`. **It is an API-to-API cross-check, not the web UI; web-UI comparison is UNVERIFIED** |
| README config works in Claude Code | Same JSON shape loaded with `claude -p --mcp-config ... --strict-mcp-config`; tool was called successfully (`docs/evidence/conversation-*.txt`). Persistent install via `claude mcp add` **UNVERIFIED**; the project-scoped `.mcp.json` path showed "Pending approval" and was not approved |
| README config works in Claude Desktop | **UNVERIFIED** (not tested) |
| Example conversations are real output | `docs/evidence/conversation-1.txt`, `-2.txt` (Claude Code `-p --model sonnet`). Which model the `sonnet` alias resolved to is **UNVERIFIED** |
| App token support (`SOCRATA_APP_TOKEN` -> `X-App-Token` header, Socrata host only) | `src/http.ts` line ~42. **UNVERIFIED** with a real token (none used; never printed). Not covered by a test |
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
6. GeoSearch match quality: confidence is reported (0.8 for the Empire State Building) but low-confidence matches are not rejected.
7. Rate limiter is per-process; two server instances can exceed 1 req/sec in aggregate. Worst-case latency with retries is long (3 attempts x 15 s per request).
8. Fixture lookup is keyed by exact request URL: changing the query builder requires re-recording (`record-fixtures`). Fixtures are re-recorded from live APIs; ECB `respondent_*` fields are redacted at record time (free-text descriptions are not). All commits, including the original ones, now hold redacted fixtures (history was rewritten and scrubbed).
9. `src/index.ts` (cache fallback, wiring) is not unit tested; exercised only by Inspector/Claude Code runs.
10. SDK validation errors for bad input arrive as MCP error -32602 text ("... at bin"), not as the server's own wording; the zod messages are included.
11. `status` filter lists exclude `unknown`-status rows (counts in the summary include an `unknown` bucket when present).
12. Validation counts are independent of the builder but come from the same backend as the web UI; they cannot reveal upstream data problems.
13. `get_*` tools do two upstream requests (count + page); a dataset update between them can make `total_matching` and `returned` disagree slightly.
14. No CI, no lint config, no npm packaging metadata beyond `package.json` (marked `private`).

## 6. Unfinished / not done

- Claude Desktop test; `claude mcp add` persistent install test; Inspector web UI session (CLI only).
- Visual comparison against the Open Data web UI and official city systems (manual steps are in `docs/VALIDATION.md`).
- App-token path never run with a real token (header behavior is unit tested with a fake token).
- (Done) Git history rewritten: noreply author/committer on every commit; old fixtures scrubbed. Verified with the searches in the session transcript.
- HPD list pagination beyond `limit` (max 100) is not offered (by design: summaries first), so full histories are not retrievable.
- Dataset `rowsUpdatedAt` is recorded in DATA.md as of 2026-11-01 only; no freshness check at runtime.

## 7. Fixes (second pass, responding to REVIEW_REPORT.md; REVIEW_REPORT.md is unchanged)

Commits are listed oldest to newest. The hashes are those of the **rewritten** history (author/committer set to the GitHub noreply address; old fixtures scrubbed of ECB respondent names). The pre-rewrite history exists only in a backup bundle kept outside the repo.

| Finding (REVIEW_REPORT.md) | Status | Commit | What changed / evidence |
|---|---|---|---|
| M1 summary mixes BIN and lot footprints; README:155 false | Fixed | `655341e` Fix 1 | DOB, ECB, HPD all by the resolved BIN; `footprint` + `other_bins_on_lot` always returned; README corrected. Tests "fix 1: consistent footprint" with a recorded Stuyvesant Town lot |
| M2 HPD "newest first" wrong (NULLs first) | Fixed | `653ff44` Fix 2 | Verified live: NULLs sort first on DESC, `NULLS LAST` accepted but not relied on. Recency queries filter to dated rows; `undated_excluded` reported. Same check applied to DOB/ECB: junk text dates (e.g. `Y30819`) sorted above real ones, now filtered. Tests "fix 2" (live fixtures + synthetic junk) |
| M3 "open" counts mislead; warnings buried | Fixed (heuristic, documented) | `720a0d4` Fix 3 | Raw `open` kept; added DOB `open_excluding_deleted` and ECB `open_excluding_written_off`; `data_quality_notes` is the first key of the summary; flagged items marked, not reclassified. docs/DATA.md and README document the rule. Tests "fix 3" (Empire State 7 raw / 0 excluding; Grand Central ECB) |
| m1 `limit` max 100 vs size cap | Fixed (documented) | `4288686` Fix 4 | Tool descriptions and README state the ~12,000-char cap and `truncated`. Also fixed in `720a0d4`: the cap was exceeded by ~160 chars because truncation fields were added after measuring |
| m2 fixtures hold respondent names; personal author email | Fixed (new fixtures and rewritten history) | `655341e` (redaction at record time) | History rewritten: every commit has the noreply author/committer and redacted fixtures. `LICENSE` keeps the user's full name by the user's decision |
| m3 untrusted-text notice placement | Fixed | `720a0d4`, `4288686` | `notice` and `untrusted_text_fields` precede the data in every response; docs note that record text also drives classification |
| m4 case-sensitive status enum | Deliberately not fixed (reason was wrong; see Fixes 2) | n/a | The original reason ("a case-insensitive pre-process would erase the `enum` from the JSON schema") was incorrect: `z.preprocess(lowercase, z.enum(...))` keeps the enum in the published schema. Only a `transform(...).pipe(...)` form loses it. Fixed in the second pass |
| m5 loose coercion (arrays accepted; unknown keys ignored) | Deliberately not fixed | n/a | Harmless (verified the emitted query is unchanged); the SDK builds a non-strict object from the shape, and rejecting arrays would also require dropping the clean JSON schema |
| m6 Retry-After ignored; per-process limiter; no token test; index.ts untested | Partly fixed | `4288686` | Retry-After honored (capped at 10 s) and tested; X-App-Token header unit test (fake token). Not fixed: per-process limiter (documented), `src/index.ts` wiring untested (listed above), worst-case latency (documented) |
| m7 summary performance | Mitigated | `4288686` | Summary makes 13 upstream requests (measured 12.1 s, later 17.9-23.7 s cold; at least ~12 s because of the 1 req/s limit); tool description says so and that results are cached for an hour |

Re-verification after the fixes: `npm test` (64 passing, no-network guard on), `scripts/inspector-check.sh` (all 5 tools, evidence refreshed), `npm run validate`
(10 of 10 buildings match independent direct queries, by BIN; `docs/VALIDATION.md` regenerated; web-UI comparison still UNVERIFIED), example conversations regenerated
with the fixed server (`docs/evidence/conversation-*.txt`).

Checklist status: see the final message in the session; this file is the evidence index.
