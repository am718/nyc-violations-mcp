# REVIEW_REPORT_FINAL.md

Round-two review of `dev/nyc-violations-mcp` at commit `d69b8e6`, 2026-11-02. This report was written by a new review pass; it did not read or trust the earlier reviews in `docs/reviews/` and re-ran everything it relies on.

**Independence caveat (read first).** The reviewer is Claude Sonnet 5.5 and ran in the same session that built the project and fixed the earlier findings. I remember the build, so I am not independent in the strict sense and I share its blind spots. To offset that I wrote every script in this pass from scratch (a new URL allowlist, new hostile inputs, new data queries), used a fresh clone, and added probes the earlier passes did not try. A reviewer with no prior context should still run before the repo goes public.

## Verdict: ready after fixes

The previous blockers are fixed and the fixes hold up. Placeholder BINs and BBLs are rejected in all five tools (122 of 122 cases, five boroughs, including values that come back from GeoSearch and from data rows), and the real GeoSearch does return placeholder BINs for parks, piers and airports, so the guard matters. The history is clean of session trailers, session ids, absolute paths, personal emails, secrets and unredacted respondent values. The 251 tests pass from a clean clone with the no-network guard on, and a mutation test (26 deliberately broken guards in a temp copy) was caught by the suite in 22 cases, with the 4 survivors (3 distinct mutations) explained as redundant layers. All 10 documented buildings match my own direct queries. Two things still need fixing before it goes public, both about the project's core promise of correct, bounded behavior. First, the address resolver silently accepts wrong matches: "123 Fake Street, Queens" resolves to a Manhattan building and "Lot 1 Block 1, Manhattan" to an unrelated street, both with confidence 0.8 and no warning, because the low-confidence warning fires only below 0.8 and GeoSearch returns 0.8 for ordinary correct matches too. Second, the "1 request per second" limiter is a race: concurrent tool calls were sent within 1 ms of each other. A few smaller inaccuracies are listed below. No blockers.

## Claims table

| # | Claim (source) | Proof I ran | Result |
|---|---|---|---|
| 1 | Clean clone builds and all tests pass (REVIEW.md: 251 tests) | `git clone` to temp, `npm ci`, `npm run build`, `npx vitest run`: 4 files, 251 passed | VERIFIED |
| 2 | The no-network guard is real (`tests/setup-no-network.ts`) | Scratch test that calls `fetch`: with the project's setup file it fails with "NETWORK USED IN TEST"; without it, it passes with a real 200 | VERIFIED |
| 3 | The 160 hostile-input tests are real (REVIEW.md, `tests/hostile-inputs.test.ts`) | Mutation test, section below: 26 guards broken one at a time in a temp copy; 22 caught, 4 survivors explained as redundant layers | VERIFIED |
| 4 | Placeholder BINs and BBLs rejected in all 5 tools, 5 boroughs, including from GeoSearch and data rows (README, DATA.md) | My own script: 122 cases (direct, bin+bbl pairs, synthetic GeoSearch result, synthetic data rows, real BIN with placeholder block/lot), 122 pass, 0 upstream requests for direct placeholders. Real GeoSearch returns placeholder BINs for Pier 40, Prospect Park, JFK, LaGuardia, Governors Island, and the real tool rejected them | VERIFIED |
| 5 | Each Fixes 2 row in REVIEW.md maps to a real commit that does what it says | See "Fixes table check" | VERIFIED (with the notes there) |
| 6 | History has no session-link trailers, session ids, local paths, username, personal emails, secrets or unredacted respondent values | Commands and output in "History and privacy" | VERIFIED, with two harmless text mentions noted |
| 7 | Dataset IDs, names, fields (docs/DATA.md) | `/api/views/*.json` names match; `rowsUpdatedAt` equals the DATA.md values; all queried fields exist | VERIFIED |
| 8 | DATA.md numbers: 573,684 ACTIVE DOB rows / 31,834 with DELETED; 59,165 ECB WRITTEN OFF; junk dates; 13 ACTIVE rows with a disposition date; placeholder counts | My own counts: all matched (13 rows: 10 DELETED, 2 PAID INVOICE, 1 junk date `7`; placeholder block/lot 00000: DOB 5,842 rows / 811 BINs, ECB 178 / 78; HPD for BIN 2000000 is 7,892 now versus 7,891 in the notes: normal drift) | VERIFIED |
| 9 | NULLs sort first on DESC; junk DOB text dates sort above real ones (DATA.md) | HPD and DOB first DESC row has no date; 4 DOB rows have text > `22001231` | VERIFIED |
| 10 | 10-building validation, all match (docs/VALIDATION.md) | My script parsed the table, resolved each address through my own GeoSearch calls, recounted DOB/ECB/HPD (open, total, excluding-annotated) and distinct BINs on the lot by direct URL: 10 of 10 match | VERIFIED |
| 11 | Footprint consistency, undated exclusion, second open count, `data_quality_notes` first, size cap (Fixes) | Live runs against direct counts: Stuyvesant 63 HPD records by BIN versus 626 lot-wide, 35 BINs on the lot, tool says 34 others; Empire State DOB 7 open / 7 flagged / 0 excluding; `data_quality_notes` is key 0; `limit=100` responses 10,653 to 11,535 chars (cap 12,000) | VERIFIED |
| 12 | Web UI agrees with the data (VALIDATION.md note) | Headless Chrome on 8 searches over 5 buildings: UI equals `bin=` in 2, equals full-text `$q` in all 8 (+1 in 6 because another row's ID column holds the same digits) | VERIFIED (UI search is full text, as documented) |
| 13 | All 5 tools work in the Inspector web UI | Inspector v2.13.0 launched headlessly; 5 tools listed; one successful call per tool; a placeholder BIN typed into the form was rejected with the placeholder message | VERIFIED |
| 14 | Latency: "13 upstream requests, at least about 12 s cold, measured 12.1 s then 17.9 to 23.7 s" (README) | Measured: summary 12.9 s / 13 requests (address, Empire State), 12.2 s / 13 (BIN), 12.2 s / 13 (BBL); Grand Central 13.4 s / **14**; 233 Broadway 13.2 s / **14**; Stuyvesant Town 11.2 s / **12**; `get_dob` 2.3 s / 3; `resolve_property` 0.1 s / 1; cached repeat 0.002 s / 0 | PARTLY: the count is 12 to 14 depending on the building, not a flat 13 (Finding m1) |
| 15 | "Each limiter spaces requests at 1 request per second" (README Safety, DATA) | 5 concurrent calls: sent at t = 2, 1005, 1006, 1006, 1006 ms | **FAILED** under concurrency (Finding M2) |
| 16 | "GeoSearch matches can be low confidence; the confidence is reported" (README) | `resolve_property` reports confidence, but the warning only appears below 0.8, and correct and wrong matches both return 0.8 | PARTLY (Finding M1) |
| 17 | Example conversations are real and accurate (README) | Re-checked facts: HPD open item 17193699 issued 2024-08-15; latest HPD NOV 2025-12-19; DOB 0 open / 33; ECB 1 record from 2002; Empire State: 7 open DOB rows, all elevator, all DELETED, one mentions 34 Fletcher St, dates 1988 to 2010 | VERIFIED (the model-written wording was not re-run) |
| 18 | README Claude Code config works | Needs a model call (outside this review's allowed actions) | UNVERIFIED by me |
| 19 | README Claude Desktop config works | Cannot be tested here | UNVERIFIED (labeled in README) |
| 20 | Live Socrata app token works | No token; the header logic is unit tested with a fake token | UNVERIFIED (labeled in REVIEW.md) |
| 21 | Comparison with other servers (README, COMPARISON.md) | Needs GitHub, Glama and npm, outside the allowed network scope | UNVERIFIED (README says the other entries came from listings) |
| 22 | "Requires Node 20+" (README line 36, `package.json` engines) | Only Node 22.22 is available here; native module `better-sqlite3` was not built on Node 20 | UNVERIFIED and **not labeled** (Finding m3) |
| 23 | "Datasets were updated within about a day when checked" (README) | `rowsUpdatedAt`: DOB 2026-11-01 18:38, HPD 2026-11-01 15:53, ECB 2026-10-31 17:10 versus today 2026-11-02 | PARTLY (ECB is more than a day old) |
| 24 | No GPA; no "first"/"only" product claims | `grep` of README and docs for GPA, first, only, unique, best, novel: remaining hits are limitations or usage hints | VERIFIED |
| 25 | `.env.example` only; no secrets | Tree: `.env.example` with an empty value; history scan of 359 blobs for 8 secret patterns: 0 matches | VERIFIED |
| 26 | Nothing pushed; no remote | `git remote -v` and `git config --get-regexp '^(remote|branch)\.'` both empty; one ref | VERIFIED |
| 27 | Tool responses return text as data (README Safety) | Injection test: JSON-breaking, control-character and prompt-injection text in four fields: output still parses as the same keys, text capped (300 / 160 chars), `notice` and `untrusted_text_fields` precede the data, nothing else is requested afterward | VERIFIED |
| 28 | The server never writes to stdout except protocol messages | `grep` for `console.log` / `process.stdout` in `src`: none; startup logs go to stderr; with an unusable cache path it logs a fallback message and runs | VERIFIED |

## Fixes table check

Original Fixes table (REVIEW.md section 7): every cited hash exists in the rewritten history and matches its subject (`fd333b4` Fix 1, `62f44c4` Fix 2, `f4f8439` Fix 3, `56f61fd` Fix 4).

Fixes 2 (REVIEW.md section 8):

| Row | Commit | Does it do what it says? |
|---|---|---|
| M1 placeholder BINs (and BBLs) | `7100bf1` | Yes. Files touched: `ids.ts`, `socrata.ts`, `resolve.ts`, `tests/placeholder-bins.test.ts`, docs. Behavior verified (claim 4); removing the schema refine, the GeoSearch check or the builder guard each fails tests. Note: the commit also swept in an unrelated file (`REVIEW_REPORT_INDEPENDENT.md`) |
| M2 session link in all commit messages | whole history | Yes. 0 matches for a session-link trailer or URL in any commit message; 21 of 22 commits keep the `Co-Authored-By` line |
| Local paths, username, session ids | `f2aa80c` + rewrite | Yes. 0 absolute paths, 0 temp-directory names, 0 `amq` outside the noreply identity in all blobs. Residual text only: the word "scratch directory" in `REVIEW.md` and one commit message, and a truncated a session link string in the independent report (no real id) |
| m1 status enum | `0781d03` | Yes. Published schema keeps `enum: [open, closed]`; `OPEN` works. Mutation (remove the lowercase preprocess) fails 5 tests |
| m2 impossible dates | `0781d03` | Yes. BIN 1081244 (row with `19108124`): total 19, returned 18, `undated_excluded` 1. Dropping the calendar bounds fails 34 tests. Feb 29 in a non-leap year: 3 DOB rows, caught in code as documented |
| m3 `limit` odd values | `0781d03` | Yes. `true`, `"0x10"`, `5.5`, `"007"`, `[5]`, `"1e2"`, `" 5"` all rejected; `"5"`, `25`, `"100"` accepted |
| 127 hostile cases as a permanent test | `0781d03` | Yes. 160 numbered cases plus meta tests; the file is real (mutation results) |
| m4 latency numbers | `7fc3fdb` | Mostly. The "13 requests" statement is only exact for some buildings (Finding m1) |
| m5 / m6 tool descriptions and HPD schema | `b107c13` | Yes. DOB and ECB descriptions contain "Requires a BIN: if you only have an address, or are unsure of the BIN, call resolve_property first"; HPD publishes `type: object` with `anyOf: [{required:[bbl]},{required:[bin]}]` and returns "Provide bbl … or bin …" for `{}`; removing the `.meta` anyOf fails a test |
| m7 reports kept and moved | `f2aa80c` | Yes. `docs/reviews/` holds both reports; README and REVIEW.md link to them |
| Web-UI full-text note | `7fc3fdb` | Yes (claim 12) |

## Findings

### Blockers
None.

### Major

**M1. A wrong address is silently resolved to a different building, and the low-confidence warning never fires.**
- Where: `src/resolve.ts` `resolveAddress` (the `confidence < 0.8` check), README line 162 ("GeoSearch matches can be low confidence; the confidence is reported").
- What is wrong: GeoSearch returns `confidence: 0.8, match_type: fallback` for ordinary correct matches (350 5th Ave, 350 5th Ave Brooklyn) as well as wrong ones. The tool warns only when confidence is below 0.8, which essentially never happens. It also never compares the matched address or borough with what the user typed.
- Reproduce (live, `resolve_property`): `"123 Fake Street, Queens"` → `"123 WEST 123 STREET, New York"`, borough Manhattan, BIN 1087830, confidence 0.8, `warning: null`. `"Lot 1 Block 1, Manhattan"` → `"1 LT HALLORAN STREET"`, BIN 1088918, no warning. An agent would then report real violation counts for a building the user did not ask about.
- Suggested fix: compare the house number and a normalized street name of the input with the match, and when a borough name appears in the input compare it with the returned borough; set `match.note` (and a `data_quality_notes` entry in the summary) when they differ. Treat `match_type: fallback` plus a mismatch as a warning, and add live-shaped fixtures for these two addresses.

**M2. The 1 request per second limiter is a race: concurrent calls are not spaced.**
- Where: `src/http.ts` `throttle()` (it reads `lastRequestAt`, awaits, then writes it).
- What is wrong: two callers that start together compute the same wait, sleep the same time, and both send. MCP clients can issue parallel tool calls, and the Socrata API is unauthenticated by default.
- Reproduce: `HttpClient` with a stub fetch, 5 concurrent `getJson` calls: sends at t = 2, 1005, 1006, 1006, 1006 ms (gaps 1003, 1, 0, 0 ms; the configured minimum is 1000 ms).
- Suggested fix: serialize the throttle with a promise chain (each caller awaits the previous caller's slot), and add a concurrency test with a fake clock. Also consider coalescing identical in-flight requests.

### Minor

**m1. Request counts and times are building-dependent, not a flat 13.**
- Where: README line 163, REVIEW.md Fixes rows, `src/server.ts` summary description ("Makes 13 upstream requests …").
- Measured: 12 requests / 11.2 s (Stuyvesant Town), 13 / 12.9 s (Empire State), 14 / 13.4 s (Grand Central, 233 Broadway). The count rises by one for each of DOB and ECB that has open records, because the flagged-count query only runs then.
- Fix: say "12 to 14 requests, at least about 12 s".

**m2. `other_bins_on_lot` counts borough placeholder BINs as buildings.**
- Where: `src/socrata.ts` `distinctBinsOnLot` (`count(distinct bin)` includes `X000000`), `src/resolve.ts` `otherBinsOnLot`.
- Reproduce (live): `building_compliance_summary` for BIN 2130638 (lot 2048530011) says "holds about 1 other building(s)"; in HPD that lot has 13 rows for the real BIN and 120 rows for placeholder BIN 2000000, so there are no other real buildings. Found on 2 of the first 3 lots I checked that mix real and placeholder BINs.
- Fix: add `AND bin NOT LIKE '_000000'` (or exclude via the same placeholder rule) to the distinct-BIN counts.

**m3. "Requires Node 20+" is not verified and not labeled.**
- Where: README line 36, `package.json` `engines`. Only Node 22.22.0 was available; `better-sqlite3` is a native module. Fix: test on Node 20 and 22 in CI or mark it UNVERIFIED.

**m4. `resolve_property` with a BBL returns a partial list of other BINs without saying so.**
- Where: `src/resolve.ts` `resolveBbl` (group query limited to 10 rows). For Stuyvesant Town it returned 8 other BINs while the lot has 34 others; nothing marks the list as partial. README says "lists up to 9", which is accurate but easy to misread. Fix: add `other_bins_on_lot_total` or a note.

**m5. Docs lag the latest state.** README's "Reviews" section describes two reviews (a third now exists); REVIEW.md still lists the Inspector web UI as UNVERIFIED and GeoSearch placeholder BINs as UNVERIFIED (both are now verified: this report). README says ECB data was "updated within about a day".

**m6. History tidiness.** The `Fix 1` commits (`fd333b4`, `7100bf1`) each also added a review report file; the word "scratch directory" survives in `REVIEW.md` and one commit message. Neither leaks anything.

**m7. Test-suite gaps shown by mutation.** Removing the HPD schema refine alone, or the first of two redundant `digits()` calls in `locatorClause`, does not fail any test because another layer covers it (defense in depth, not a hole). There is no automated test for the `src/index.ts` cache fallback (I confirmed it manually: the server logs the fallback and runs).

## Mutation test: are the 160 hostile tests real?

Method: copy of the repo in a temp directory (with the project's `node_modules` linked), one deliberate break at a time via a regex patch, `npx vitest run`, restore, next.

| Break | Failing tests |
|---|---|
| `digits()` stops validating | 2 |
| `binSchema` regex loosened to any text | 1+ |
| placeholder-BIN refine removed | 7 |
| placeholder-BBL refine removed | 4 |
| GeoSearch placeholder check removed | 1 |
| builder placeholder-BIN guard removed | 1 |
| status lowercase preprocess removed | 5 |
| `limit` accepts any string | 7 |
| SoQL calendar bounds dropped | 34 |
| `buildUrl` adds an extra parameter | 46 |
| HPD `.meta(anyOf)` removed | 1 |
| control characters no longer stripped | 1 |
| size cap disabled | 1 |
| record text no longer capped | 2 |
| undated rows not excluded | 22 |
| address interpolated into the GeoSearch URL unencoded | 16 |
| token sent to every host | 1 |
| untrusted-text `notice` dropped | 2 |
| `data_quality_notes` no longer first | 1 |
| HPD summary queried by BBL again | 13 |
| Retry-After ignored | 1 |
| cache TTL never expires | 1 |
| **Survivors (4 runs, 3 distinct)** | HPD schema refine alone (runtime check still covers it); HPD runtime check alone (schema covers it); first of two `digits()` calls in the BBL path (the second covers it) |

22 of 26 breaks were caught. The 4 survivors are 3 distinct mutations (the HPD schema-refine removal was tried twice); each is a redundant layer covered by another check, not a hole.

## Hostile input results

Three independent sets, all through the real server over the in-memory MCP transport with a stubbed network that records every URL.

- **My fresh set (102 cases):** SoQL keywords and operators (`OR`, `AND`, `ORDER BY`, `LIMIT`, `GROUP BY`, `HAVING`, `UNION`), comment markers, encodings (`%27`, `&#39;`), brackets and braces, whitespace and Unicode (tab, CR/LF, NEL, line separator, word joiner, combining mark, emoji, fullwidth digits), numeric tricks (`1e3`, `0b…`, `1_015_862`, `1,015,862`, leading zero, 5 and 8 digits), BBL variants (`1/00835/0041`, `1.00835.0041`, `1e9`, `0x…`, block `99999`, block `00000`, lot `0000`, borough 0 and 6), addresses (multiline, `$q=1`, `../../..`, `file:///`, `javascript:`, RTL override, ligature, full-width), wrong types for `status` and `limit`, extra identifiers, unknown tool, missing arguments object. Result: 95 rejected, 7 accepted (a tab- or space-padded valid BIN that is trimmed, `limit` "100" and 3, two valid-looking BINs `1000001` and `1999999` that have no records, and an extra-identifier call on a bin-only tool), 33 upstream requests, **0 URLs outside my allowlist**. The allowlist was written fresh: host and path, only the five `$` parameters, `$limit` ≤ 1000, grammar for `$select`/`$group`/`$order`, and `$where` made only of digit-validated `bin`/`bbl`/`boro-block-lot` terms and the fixed status, annotation and calendar fragments.
- **Placeholder set (122 cases):** all pass (claim 4).
- **The repository's own 160 cases:** all pass in the clean clone; the mutation table shows they detect regressions.

No input changed query structure. Free-text addresses reach only GeoSearch (percent-encoded `text=…&size=1`).

## History and privacy (commands run)

```
git remote -v | wc -l                                          -> 0
git config --get-regexp '^(remote|branch)\.'                   -> (none)
git for-each-ref                                               -> refs/heads/main only; tags 0; stash 0
git log --all --format='%an <%ae> | %cn <%ce>' | sort | uniq -c -> 22 x AMQ <163986147+am718@users.noreply.github.com> (author = committer)
case-insensitive search of every commit message for a session-link trailer or URL                    -> 0
search of every commit message for absolute local paths and temp-directory names                    -> 0
case-insensitive search of every commit message for the word for the temp directory                  -> 1  (in a commit message describing the cleanup; removed by the final history clean-up)
git log --all --format=%B | grep -E -o 'https?://[^ ]+|[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+' | sort | uniq -c -> 21 noreply@anthropic.com
git ls-files | grep -i -E 'bundle|\.env$|\.sqlite|\.vitest|\.pem|\.key'  -> none (.env.example only)
python scan of all 359 blobs reachable from all refs (250 distinct paths):
  session link / session id            8   (all in the review reports: text that described a session link with an ellipsis; 0 real ids)
  absolute local paths                 0
  temp-directory names                 0
  'scratch directory' (word only)             1   (REVIEW.md)
  personal email / gmail               0
  'amq' as a bare word                 0
  AWS / GitHub / private key / Bearer / key=value / SOCRATA_APP_TOKEN value   0 each
  distinct email-like strings          ['163986147+am718@users.noreply.github.com', 'noreply@anthropic.com']
  ECB respondent_* values              185 placeholders, 0 unredacted
```

Fixture free text. 158 distinct fixture records (DOB 96, HPD 32, ECB 30). I sampled 60 records (76 free-text/address values). Pattern hits by kind: email 0, phone 0, honorific + name 0, company suffix 0, mixed-case two-word name 0; street address in a note 11 (all in the property's own `street`/`streetname` field); "DELETED BY <initials> ON" staff initials 3 (9 across all records); all-caps word runs 29 (mostly generic violation vocabulary). Across all 158 records the descriptive free-text fields hold 292 distinct word-tokens: 224 are English dictionary words, 31 are four letters or fewer (abbreviations), and 37 are five letters or longer and not in the dictionary (22 of them occur in a single record). I did not print them; a heuristic cannot prove none is a person or business name, so a human should skim those 37.

## What the builder and the first review both missed

Items found only in this pass: M1 (silent wrong-address match), M2 (limiter race), m2 (placeholder BINs counted as buildings), m1 (request count varies by building), and the fact that real GeoSearch returns placeholder BINs for parks, piers and airports (which turns an UNVERIFIED line in REVIEW.md into a verified one).

Short list of what I would try next:
1. A property-based/fuzz test of the address-to-building match against the input (house number, street, borough) using a few hundred real addresses and perturbations.
2. Parallel tool calls from a real MCP client (Claude Code issuing 3 to 5 calls at once) with a recorded Socrata 429 to see the retry and limiter behavior together.
3. Condo buildings (billing lot `75xx` versus unit lots) and buildings whose DOB rows carry a different BBL than HPD: check the `bin → bbl → other BINs` chain.
4. A BIN that moved lots, or a lot that was merged or split: the BBL derived from "the most common DOB row" may be stale.
5. Long-running behavior: the cache TTL of one hour next to dataset updates during the hour, and what `fetched_at` tells an agent about stale cached rows.
6. A Node 20 and Node 22 build matrix for `better-sqlite3`, and `npm ci` on Linux and Windows.
7. A fresh-context human read of the 37 unusual words in the fixtures and of the free-text violation descriptions that reach the model.
8. Black-box testing against the real city sites (DOB BIS / DOB NOW, HPD Online) for 3 buildings, which nobody has done.

## What I could not check, and why

- **Claude Desktop config**: not available. UNVERIFIED. Close it by pasting the README block into the config and calling a tool.
- **Claude Code end to end**: needs a model call, outside this review's allowed actions. UNVERIFIED by me. Close it with `claude mcp list` and one question.
- **Live Socrata app token**: no token; I must not handle secrets. UNVERIFIED; unit tested with a fake token.
- **Official city systems (DOB BIS / DOB NOW, HPD Online, OATH)** and **comparison with other MCP servers (GitHub, Glama, npm)**: outside the allowed access. UNVERIFIED.
- **Node 20**: not installed here.
- **Whether the 37 unusual fixture words are names**: heuristic only.
- **Open versus closed counts in the web UI**: the preview search is full text, so only totals per BIN were comparable.

## Checklist

- [x] Only `REVIEW_REPORT_FINAL.md` was added to the repo (verified with `git status --short` at the end)
- [x] Clean-clone install, build and tests pass (251); no-network guard shown to fail a fetch test and pass without it
- [x] Fixes table verified row by row, including all Fixes 2 rows
- [x] 30 or more hostile inputs tried (102 fresh, 122 placeholder, 160 committed)
- [x] Placeholder BINs and BBLs checked in all 5 tools, all 5 boroughs, from GeoSearch and from data rows
- [x] All 10 buildings re-checked independently (10 of 10)
- [x] Web-UI comparison attempted (8 searches, 5 buildings)
- [x] Inspector web UI attempted (all 5 tools, plus a rejection)
- [x] History, secrets, respondent values and fixture free text checked
- [x] Mutation test run in a temp copy (22 of 26 caught; survivors explained)
- [x] Latency and request-count claims measured
- [x] README claims classed as VERIFIED, UNVERIFIED (labeled) or UNVERIFIED (not labeled: Node 20)
- [x] Temp files listed and removed (below)
- [x] Verdict given: ready after fixes

## Clean-up list: everything I created in temp

All under one temp directory outside the project (about 400 MB): `clone/` (fresh clone with `node_modules` and `dist`), `mut/` (mutation-test copy), `guard/` (guard demo), `pw/` (temp `playwright-core` install and scripts), and my scripts and outputs (`placeholders.mjs`, `hostile2.mjs`, `mutate.py`, `mutate2.py`, `data.py` / `data.out`, `geo.py`, `geotool.mjs`, `concurrency.mjs`, `cache2.mjs`, `inflate*.py/mjs`, `lotprobe.mjs`, `timing*.mjs`, `sizes.mjs`, `readme_ex.py`, `fix2rows.mjs`, `inspector.log`). I stopped the Inspector and the headless Chrome sessions. The three git backup bundles outside the repo were not touched.
