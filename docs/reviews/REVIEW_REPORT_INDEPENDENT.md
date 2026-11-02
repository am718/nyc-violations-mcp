# REVIEW_REPORT_INDEPENDENT.md

Review of `dev/nyc-violations-mcp` at commit `c80ab84`, 2026-11-02.

**Independence caveat (read first).** The reviewer was Claude Sonnet 5.5 running in the same session that built and fixed this project. I had the build context, so I am not an independent reviewer in the strict sense, and I share the builder's blind spots. I tried to offset that by relying only on things I ran in this pass: a fresh clone, my own scripts written from scratch in a temp directory, direct API queries that do not use the server's code, a headless browser, and the Inspector. The earlier `REVIEW_REPORT.md` is untouched. A reviewer with no prior context should still run next.

## Verdict: ready after fixes

The core work holds up. In a clean clone the build and all 64 tests pass, and the no-network guard is real. I tried 127 hostile inputs and none changed query structure: every URL the server produced matched a strict allowlist. All 10 buildings in `docs/VALIDATION.md` match my own direct queries, using independently resolved BINs. Every numeric claim in `docs/DATA.md` that I re-checked is still true. The behavior behind every row of the Fixes table is real. Record text is returned as JSON string data and nothing in the server acts on it. The web-UI counts agree with the API, and all 5 tools run in the Inspector web UI. Privacy is clean for emails, tokens and respondent fields. Two things still need fixing before it goes public. First, the validators accept the borough placeholder BINs (`1000000`, `2000000`, `3000000`, `5000000`), and these silently resolve to an arbitrary unrelated building and return thousands of unrelated records (HPD: 7,441 for `1000000`). Second, all 15 commit messages carry a `a session link` link that would become public. Both are small to fix. Several minor items are listed below, including that the REVIEW.md rationale for not fixing the case-sensitive `status` enum is factually wrong.

## Claims table

| # | Claim (source) | Proof I ran | Result |
|---|---|---|---|
| 1 | Builds and tests from a clean clone; 64 tests pass (REVIEW.md, README) | `git clone` into temp, `npm ci`, `npm run build`, `npx vitest run`: 2 files, 64 passed | VERIFIED |
| 2 | Tests need no network; the guard is real (`tests/setup-no-network.ts`) | Scratch test that calls `fetch`: with the project's guard it fails with "NETWORK USED IN TEST"; without the guard it passes with a real 200. No project test calls global `fetch` directly (grep) | VERIFIED |
| 3 | Dataset IDs `3h2n-5cm9`, `6bgk-3dad`, `wvxf-dwi5`, names, fields (docs/DATA.md) | `/api/views/<id>.json`: names match; `rowsUpdatedAt` still 2026-11-01 18:38, 2026-10-31 17:10, 2026-11-01 15:53 (the DATA.md values); all queried fields exist | VERIFIED |
| 4 | 573,684 ACTIVE DOB rows; 31,834 with a DELETED comment (DATA.md) | Direct counts: 573684 and 31834 | VERIFIED |
| 5 | 59,165 ECB ACTIVE + WRITTEN OFF (DATA.md) | Direct count: 59165 | VERIFIED |
| 6 | DOB junk dates: 30 invalid + 1 null; ECB 64 invalid; 812,468 HPD null `novissueddate` (228,588 open) (DATA.md) | Direct counts: 30 / 1 / 64 / 812468 / 228588 | VERIFIED |
| 7 | "13 ACTIVE rows with a disposition date: 10 DELETED, 2 PAID INVOICE, 1 junk date `7`" (DATA.md) | Live: count 13; comments classified 10 / 2 / 1; the non-8-digit value is `7` | VERIFIED |
| 8 | NULLs sort first on DESC; `NULLS LAST` accepted (DATA.md) | HPD and DOB: first DESC row has no date; HPD with `NULLS LAST`: first row dated | VERIFIED |
| 9 | Junk DOB text dates sort above real dates (e.g. `Y30819`) (DATA.md) | 4 DOB rows have text > `22001231` (`33218262`, `T90517`, `Y30819`); for one bin the unfiltered DESC top is `33218262`, the filtered top is `20220222`. ECB junk is only `0` (sorts low) | VERIFIED |
| 10 | 10-building validation, all match (docs/VALIDATION.md) | My script parsed the table, resolved each address independently through GeoSearch, and recounted DOB/ECB/HPD (open, total, excluding-deleted, excluding-written-off) and distinct BINs on the lot by direct URL | VERIFIED (10 of 10) |
| 11 | HPD coverage note for non-residential buildings | 8 commercial/civic BINs have 0 HPD rows (direct); tool output shows `coverage` text and null counts (fixture test plus live runs) | VERIFIED |
| 12 | Footprint consistency: all three agencies by the same BIN (README, Fix 1) | Cold summary for Stuyvesant Town through the real fetch path: 11 Socrata requests, 0 not filtered by `bin = '1082881'` apart from the two `count(distinct bin)` lot counters | VERIFIED |
| 13 | `other_bins_on_lot` is approximate; 34 for Stuyvesant Town | Independent distinct BINs on the lot: 35 (DOB 35, HPD 35); tool says 34 | VERIFIED |
| 14 | Undated rows excluded and counted (Fix 2) | HPD bin 2096753 open: tool total/undated 179/8; independent 179/8. DOB bin 1085463: junk row excluded, first date 2021-10-07 | VERIFIED |
| 15 | Second open count; `data_quality_notes` first key (Fix 3) | ESB DOB 7 open / 7 flagged / 0 excluding, independent flagged count 7; Grand Central ECB 6/6/0, independent written-off 6; `Object.keys` index of `data_quality_notes` is 0 | VERIFIED |
| 16 | Size cap about 12,000 characters (README) | Serialized `limit=100` responses: DOB 11,535 chars (25 returned, truncated), ECB 10,653 (truncated), HPD 11,234 (22 returned) | VERIFIED |
| 17 | Summary takes about 10 to 12 requests / about 12 s cold (README, REVIEW.md, tool description) | Measured: 13 requests, 12.1 s cold, 0 requests / 0.00 s on repeat (cache) | PARTLY: the tool description says "~10 seconds" (`src/server.ts:104`) and README "10-12 requests"; real is 13 |
| 18 | Every record's text is returned as data in delimited fields (README Safety) | Stub fetch with a JSON-breaking, control-char, prompt-injection description in 4 fields: output parses; the fake `notice`/`violations` keys did not escape; text capped at 300/160 chars; `notice` and `untrusted_text_fields` precede the data; the server made exactly the 3 expected requests afterwards | VERIFIED |
| 19 | App token header only to the Socrata host, never in a URL (README) | Code read plus the unit test (fake token); no live token | VERIFIED by unit test; live token UNVERIFIED |
| 20 | README Claude Code config works | I did not re-run `claude -p`; the Inspector spawned `node dist/src/index.js` from the clone, which only shows the command path shape works | UNVERIFIED by me |
| 21 | README Claude Desktop config works | Cannot test here | UNVERIFIED |
| 22 | 5 tools work through the MCP Inspector | Inspector web UI v2.13.0 loaded headlessly; all 5 tools listed; one call per tool executed and returned the expected content (see step 8) | VERIFIED |
| 23 | Web counts agree with the tool | Headless Chrome on the dataset preview pages (see step 7): UI total 2,477,598 equals API; 10 searches; 2 exact matches, 8 off by exactly +1 for a reason I traced | VERIFIED with caveat (full-text search, not a column filter; open/closed not checkable in the UI) |
| 24 | Comparison with other servers (README, docs/COMPARISON.md) | Requires GitHub/Glama/npm, which are outside the network scope allowed for this review | UNVERIFIED |
| 25 | No GPA; no "first"/"only" product claims in README | `grep` for GPA, first, only, unique, best, novel: remaining hits are limitations ("Only DOB, ECB and HPD") or usage hints ("First call") | VERIFIED |
| 26 | `.env.example` only; no secrets | Tree listing (`.env.example` only, value empty); all 287 blobs in history scanned for key/token/private-key/bearer/assignment patterns: 0 matches | VERIFIED |
| 27 | `git remote -v` empty; only the noreply email | `git remote -v | wc -l` = 0; no `remote.*`/`branch.*` config; one ref (`refs/heads/main`); `git log --all`: 16 entries, all `AMQ <163986147+am718@users.noreply.github.com>` as author and committer | VERIFIED |
| 28 | No ECB respondent values anywhere in history | Parsed every JSON fixture blob in all history: 110 `respondent_*` values, all placeholders, 0 unredacted | VERIFIED (structured fields only) |
| 29 | Description in the tool says when to use it and when not | Read via `tools/list`; see Tool design | VERIFIED, with minor gaps |
| 30 | Retry-After honored and tested (REVIEW.md m6) | Tests pass (included in the 64); not separately exercised against a live 429 | VERIFIED by tests |

## Fixes table check (REVIEW.md section 7)

All hashes exist as commits in the rewritten history and match their subjects: `655341e` Fix 1, `653ff44` Fix 2, `720a0d4` Fix 3, `4288686` Fix 4, plus `f38dc9e`.

| Row | Confirmed? |
|---|---|
| M1 footprint | Yes. Behavior verified live (claims 12, 13); the fix commit touches `src/tools/summary.ts`, `src/resolve.ts`, `src/socrata.ts`, README and tests |
| M2 HPD ordering | Yes. NULLs-first confirmed live for HPD and DOB; recency queries filter; counts match independent numbers (claim 14). The same check was applied to DOB/ECB, and the junk-date risk is real (claim 9) |
| M3 open counts / `data_quality_notes` first | Yes (claim 15). Raw counts unchanged; flagged items remain listed and are marked |
| m1 `limit` vs cap | Yes. Descriptions and README say so (claim 16). The cap fix is real (limit=100 responses stay below 12,000) |
| m2 respondent names / email | Yes for current files and all history (claims 27, 28). Not covered: other free text and the session link (Findings M2) |
| m3 notice placement | Yes (claim 18) |
| m4 "deliberately not fixed" | **The rationale is incorrect** (Findings m1). A case-insensitive `status` would not erase the enum |
| m5 "deliberately not fixed" | Reasoning is plausible. Arrays are accepted (`z.coerce.string()` accepts `["1015862"]`); unknown keys are ignored; I did not test strict-object registration |
| m6 partly fixed | Yes (Retry-After and the token test exist; per-process limiter and untested `index.ts` remain, as stated) |
| m7 mitigated | Yes. The summary is cached; the request count is 13, not the "~11-12" in the table |

## Findings

### Blockers
None.

### Major

**M1. Borough placeholder BINs are accepted and resolve to an arbitrary building.**
- Where: `src/ids.ts:12-15` (`binSchema` accepts any `[1-5]\d{6}`), `src/socrata.ts:42` (`BIN_RE`), `src/resolve.ts:80-93` (`resolveBin` derives the BBL from the first DOB row), `src/resolve.ts:53` (the same pattern for the GeoSearch result).
- What is wrong: BINs of the form `X000000` are borough-level "unknown building" placeholders used in the data (DOB: 381 such rows, ECB 838, HPD 33,048). A call with `bin: "1000000"` is valid input and returns records for many unrelated buildings, presented as one building.
- Reproduce (live): `resolve_property {bin:"1000000"}` returns `{"address":"1818 MADISON AVENUE","bin":"1000000","bbl":"1017450016"}` with no warning. `get_hpd_violations {bin:"1000000", limit:3}` returns `total_matching: 7441`. Direct counts: BIN `1000000` has DOB 96, ECB 230, HPD 7,441 rows; `2000000`: 12/69/7,891; `3000000`: 172/275/12,148; `5000000`: 4/13/829. `building_compliance_summary` would give these as a building's counts.
- Suggested fix: reject BINs ending `000000` in `binSchema` with a message like "X000000 is a borough placeholder for an unknown building; use the street address or a BBL". Apply the same rule to GeoSearch results (`src/resolve.ts:53`) and to derived BINs (`:124`, `:131`). Add a test with a stub fixture. I could not confirm whether GeoSearch ever returns a placeholder BIN for a real address (UNVERIFIED), so the guard should be there regardless.

**M2. Commit messages contain a `a session link` link on all 15 non-initial-attribution commits.**
- Where: `git log --all --format=%B | grep -o 'a session link ]*'` returns one link, repeated 15 times (the trailer `session-link: …`). It is the only URL in any commit message.
- What is wrong: making the repo public publishes a link to a private session. It is probably access-controlled, but it is not meant to be public.
- Reproduce: `git log --all --format=%B | grep -c the session-link URL` (15).
- Suggested fix: strip the `session-link:` trailer in another history rewrite (backups are outside the repo). Decide whether to keep the `Co-Authored-By: Claude … <noreply@anthropic.com>` line.

### Minor

**m1. REVIEW.md's reason for not fixing the case-sensitive `status` enum is wrong.**
- Where: `REVIEW.md` Fixes table, row m4 ("A case-insensitive pre-process would erase the `enum` from the JSON schema").
- Check: with `z.preprocess(lowercase, z.enum(["open","closed"])).optional()`, zod's input JSON schema stays `{"type":"string","enum":["open","closed"]}`, and through the MCP SDK `tools/list` still advertises the enum and a call with `"OPEN"` runs as `"open"` (I tested both). Only the `transform(...).pipe(...)` form loses the enum.
- Suggested fix: either use `z.preprocess` (as above) or correct the stated reason.

**m2. About 5 DOB rows pass the valid-date filter with impossible dates.**
- Where: `src/socrata.ts:68-72` (`VALID_DATE`) versus `src/normalize.ts:10` (`normalizeDate`).
- What: rows such as `19108124`, `18110561`, `19505536`, `20067328` pass the text filter (8 chars within 1800 to 2200) but have an impossible month or day (3 rows month, 2 rows day). They count as dated, are not reported in `undated_excluded`, and appear with `issue_date: null` sorted last in the list.
- Reproduce: direct count of DOB rows passing the filter with `substring(issue_date,5,2) not between '01' and '12'` is 3, and the day check gives 2 (ECB: 0).
- Suggested fix: add month and day bounds to the DOB/ECB filter, or count rows whose normalized date is null into `undated_excluded`.

**m3. `limit` accepts odd values.**
- Where: `src/ids.ts:48-53` (`z.coerce.number()`).
- What: `true` (becomes 1), `[5]` (5) and `"0x10"` (16) are accepted. Harmless but surprising; `null` and `""` are rejected.
- Suggested fix: `z.number()` with a string preprocess that only accepts `/^\d+$/`.

**m4. Latency and request counts are inconsistent across docs and code.**
- Where: `src/server.ts:104` ("~10 seconds"), README line 163 ("10-12 upstream requests, roughly 12 seconds"), `REVIEW.md` m7 row ("~11-12 requests"). Measured: 13 requests, 12.1 s cold.
- Suggested fix: say "about 13 requests, about 12 s" in all three places.

**m5. The DOB and ECB tool descriptions do not tell an agent how to get a BIN from an address.**
- Where: `src/server.ts` descriptions for `get_dob_violations` and `get_ecb_violations`, and the bin validation message in `src/ids.ts:15`. The HPD error says "Use resolve_property first"; the DOB/ECB ones do not.
- Suggested fix: add "If you only have an address, call resolve_property first" to those descriptions.

**m6. `get_hpd_violations` has no `required` in its JSON schema** (either `bbl` or `bin`; enforced at runtime with a good message). An agent reading only the schema cannot tell. Fix: say so explicitly in the description (partly done: "by bbl or bin").

**m7. `REVIEW_REPORT.md` was committed in the Fix 1 commit** (`655341e`) though the self-review report was meant to be left alone. It is in the public history now. Decide whether it should ship.

## Hostile input results

Method: a fresh script in temp, in-memory MCP client and server over the clone's `dist/`, a stub fetch that records every URL (so no network), and a strict allowlist checked on every URL. The allowlist covers the host and path (one of the three datasets or GeoSearch), only the params `$select`, `$where`, `$group`, `$order` and `$limit`, `$limit` of at most 4 digits and 1000 or less, `$select` and `$group` and `$order` from a fixed grammar, and `$where` made of `bin = '<7 digits>'`, `bbl = '<10 digits>'`, `boro/block/lot` digit triples and the fixed status fragments. Totals: **124 cases through the stub plus 3 live read-only cases = 127**. Accepted 10, rejected 114, upstream requests 30, **cases with a URL outside the allowlist: 0**. No internal errors or thrown exceptions.

| Input group (examples) | Outcome |
|---|---|
| bin with quotes, `' OR '1'='1`, `"`, `''`, `; DROP TABLE x; --`, `UNION SELECT`, `/* c */`, `) OR (1=1`, `AND 1=1`, `LIKE '%'`, `IS NOT NULL`, `--`, `#`, `$where=1=1`, `&$limit=100000`, `%27%20OR%201=1` (about 25 inputs) | All rejected by the schema, 0 requests |
| bin with NUL, RTL override, zero-width space, fullwidth digits, Arabic-Indic digits, `1015862.0`, `0x…`, `-…`, `+…`, `…e0`, space, empty, `null`, `undefined`, `NaN`, `Infinity` | All rejected, 0 requests |
| bin of 50,000 digits; 5,000 quote characters | Rejected, 0 requests |
| bin as array `["1015862"]`, nested array, number `1015862` | Accepted (coerced to a valid 7-digit BIN); URL `bin = '1015862'` only |
| bin as array with injection, empty array, object with `$where`, `{bin:…}`, `null`, `true`, `false`, `1015862.5`, `"constructor"`, `"__proto__"` | Rejected, 0 requests |
| bbl with `' OR 1=1 --`, `UNION SELECT`, NUL, `/*`, fullwidth digits, too short/long, leading 0, borough 6, `1--1`, `1008350041,1008350042` | Rejected |
| bbl `1-00835-0041\n`, `1-0-0` | Accepted after trim/normalization, digit-only query |
| status `open' OR 1=1`, `open;`, `OPEN`, `Open`, `closed\0`, `both`, empty, `open,closed`, `*` | All rejected (m1 about case) |
| limit `1e9`, `-1`, `0`, `101`, `2.5`, `"5; DROP"`, `"NaN"`, `null`, `""`, `"10 OR 1=1"`, `{a:1}`, `1e308` | Rejected |
| limit `"1e2"`, `[5]`, `true`, `"0x10"` | Accepted as 100, 5, 1, 16 (m3) |
| address: empty, whitespace, 100,000 characters, NUL, ESC sequence | Rejected by schema |
| address: `' OR 1=1 --`, `"; DROP`, `&$where=1=1&$limit=1000000#f`, `%26$where%3D1`, `../../etc/passwd`, `http://evil.example/$where=1`, `\r\nHost: evil`, Arabic digits/emoji/RTL, `𝟑𝟓𝟎`, `{{7*7}}`, `${7*7}`, `<script>`, lone surrogate | Sent only to GeoSearch as `text=<percent-encoded>&size=1` (allowlisted shape); 0 Socrata requests; "No NYC address match" message |
| address + bin, address + bbl, no identifier, hpd with neither bin nor bbl | Rejected with fix-it messages |
| bin Manhattan + bbl Bronx (hpd, and resolve_property); Brooklyn bin + Manhattan bbl; summary with an invalid borough-5 bbl | Rejected before any request: "bin ... is in Manhattan but bbl ... is in Bronx ... Pass only one of them" |
| Extra args `$where`, `$select`, `$limit`, `$order`, `$group`, `__proto__`, `constructor` | Silently ignored; URL unchanged and allowlisted |
| Live: bin 1015862 + bbl 1008350042 (same borough, wrong lot) | Rejected: "belongs to bbl 1008350041, not 1008350042 ... matching pair" |
| Live: bin 1015862 + bbl 1012970023 (Chrysler's lot) | Rejected with the matching-pair message |
| Live: bin 1015862 + bbl 1008350041 (matching) | Accepted |

I also read the places that build queries or take input: `src/ids.ts` (schemas), `src/socrata.ts` (`digits`, `locatorClause`, `queries`, `VALID_DATE`, `buildUrl`), `src/status.ts` (constant clauses and flag clauses), `src/resolve.ts` (GeoSearch URL via `URLSearchParams`, regex re-validation of BIN/BBL from responses), `src/normalize.ts` (`cleanText`, allowlisted fields), `src/http.ts` (internal URLs only; token only to the Socrata host), `src/cache.ts` (prepared statements). I found no path where user text reaches a SoQL string. The one weak spot is the placeholder-BIN semantic issue (M1), which is not an injection.

## Data correctness notes

- All 10 buildings: DOB open/total/excluding-deleted, ECB open/total/excluding-written-off, HPD open/total by BIN, and `other_bins_on_lot` match my direct queries (BINs from my own GeoSearch calls equal the documented BINs).
- Stuyvesant Town: BIN 1082881 gives DOB 33, HPD 63; lot-wide HPD is 626 (the old footprint problem is gone). The lot has 35 distinct BINs.
- Open/closed vocab: DOB categories not matching ACTIVE/Resolved/DISMISSED are `V%-DOB VIOLATION` (1,049 rows) and null (2): both end up `unknown`. ECB: ACTIVE/RESOLVE/Unknown(3). HPD: Open/Close only.
- Placeholder BINs: see M1.
- HPD rows by BIN versus BBL: the BIN is never null on rows that have a BBL (0 such rows), so querying HPD by BIN loses nothing for real BINs.

## Fixture free-text sample (counts and kinds only)

Fixtures contain 106 files with record rows, 148 distinct records (DOB 86, HPD 32, ECB 30). I sampled 60 records (99 free-text or address field values) and then ran the same pattern pass over all 148 records (272 free-text values). Patterns: email, phone number, honorific plus name, company suffix, `BY <initials> ON`, street address, and capitalized two-word names.

| Kind | Sampled (99 values) | All (272 values) |
|---|---|---|
| Email address, phone number, honorific + name, company suffix, mixed-case two-word name | 0 | 0 |
| Street address pattern | 13 (all in the property's own `street`/`streetname` field, i.e. the subject property's address) | 37 (33 DOB `street`, 4 HPD `streetname`; none in descriptions or comments) |
| Staff initials in "DELETED BY <initials> ON <date>" comments | 3 | 9 |

Other: the only key names that resemble identity data are `respondent_*` (all placeholders in every history blob) and `name` (GeoSearch building labels). The heuristic cannot prove the absence of a name inside a free-text sentence. The fixtures are small (148 records), and I did not read each value because that would put any names that exist into this report.

## What I could not check, and why

- **Claude Desktop config**: Claude Desktop is not available here. UNVERIFIED. To close it, paste the README block into `claude_desktop_config.json` and call a tool.
- **Claude Code config end to end**: needs a model call, which is outside the allowed actions. UNVERIFIED by me. To close it, run the README snippet with `claude mcp list`, then ask a question.
- **Live Socrata app token**: no token available, and I must not handle secrets. UNVERIFIED live; the header logic is covered by a unit test.
- **docs/COMPARISON.md and the README comparison**: needs GitHub, Glama and npm (outside the allowed network scope). UNVERIFIED. To close it, a person opens the listed repos and confirms their tool lists, licenses and activity.
- **Official city systems (DOB BIS/NOW, HPD Online, OATH)**: not accessible and not in scope. UNVERIFIED.
- **Web UI open/closed counts**: the preview search is full-text, not a column filter. I could compare totals per BIN, not status counts. To close it, apply the column filter by hand for a few buildings.
- **Whether GeoSearch can return a placeholder BIN for a real address**: not tested at scale. UNVERIFIED (relevant to M1).
- **Free text for names**: heuristic only (see above).
- **Concurrent use and the per-process rate limiter**: not tested.
- **`index.ts` cache fallback path**: not tested (also listed by the builder).

## Web-UI comparison (step 7) and Inspector web UI (step 8), in detail

**Web UI (step 7).** I used headless system Chrome driven by `playwright-core` (temp install; the Chrome app was already present and nothing was installed globally). The Open Data dataset pages render and the preview tab has a full-text search box. The dataset total shown for DOB (2,477,598) equals the API (2,477,597 non-null dates plus 1 null). I searched each BIN on the DOB, ECB and HPD preview pages for 10 combinations across 5 buildings:

| Search | UI count | Tool / API `bin=` count | Note |
|---|---|---|---|
| DOB 1015862 | 691 | 691 | match |
| DOB 1082881 | 33 | 33 | match |
| ECB 1015862 | 242 | 241 | +1 |
| DOB 1035381 | 158 | 157 | +1 |
| ECB 1035381 | 27 | 26 | +1 |
| HPD 1082881 | 64 | 63 | +1 |
| DOB 1028637 | 110 | 109 | +1 |
| HPD 1028637 | 2 | 1 | +1 |
| ECB 1087167 | 67 | 66 | +1 |
| DOB 1087167 | 245 | 244 | +1 |

I traced the +1: the UI search is full-text, so it also matches a different record whose ID column holds the same digits (`isn_dob_bis_viol`, `isn_dob_bis_extract` or `violationid` equal to the BIN). The API's full-text `$q=` query returns the UI's exact numbers in all 10 cases, and the BIN-equality counts equal the tool's. So the UI and API agree, and the tool's BIN counts are right; the UI cannot isolate the BIN column. Verdict for this item: **VERIFIED with the caveat above**.

**Inspector web UI (step 8).** I started the Inspector (v2.13.0) with `DANGEROUSLY_OMIT_AUTH=true` against the clone's `node dist/src/index.js`, loaded it headlessly, connected, and opened the Tools tab. All 5 tools are listed with descriptions and the read-only/idempotent/open-world badges. I executed one call per tool through the form and saw the expected content: `resolve_property` (address) returned `"bin":"1015862"`, `get_dob_violations` returned `"total_matching":691`, `get_ecb_violations` returned `"total_matching":26`, `get_hpd_violations` returned `"total_matching":63`, and `building_compliance_summary` returned `"other_bins_on_lot":34`. I killed the Inspector afterwards.

## Tool design

- Names are clear and mutually distinct. Each description says what it is for and what it is not for, and points to the right sibling tool (`resolve_property`, the three agency tools, the summary).
- Descriptions put caveats where an agent reads them (heuristic status, flagged records, size cap, undated rows, lot versus building for HPD). The summary says "read `data_quality_notes` first".
- Error messages are actionable: format examples for bin/bbl/address, the "Pass only one of bin or bbl ... matching pair" message, and "Use resolve_property first". The upstream errors say to retry and mention the app token.
- Response sizes are small enough: 0.8 to 4.8 KB for resolve/summary, and at most about 11.5 KB for list tools at `limit=100` (capped below 12,000).
- Ambiguity left for an agent: placeholder BINs (M1); `get_hpd_violations` has no `required` in the schema (m6); DOB/ECB descriptions do not say how to get a BIN from an address (m5); `open` counts are heuristic, but the raw/excluding pair and notes are clear.

## Checklist

- [x] Only REVIEW_REPORT_INDEPENDENT.md was added to the repo (verified with `git status --short` after clean-up; see below)
- [x] Clean-clone install, build and tests pass (64 passed)
- [x] Fixes table verified row by row
- [x] 30 or more hostile inputs tried (127)
- [x] All 10 buildings re-checked independently (10 of 10)
- [x] Web-UI comparison attempted (10 searches over 5 buildings; verified with caveat)
- [x] Inspector web UI attempted (all 5 tools listed and executed)
- [x] History, secrets and fixture free text checked
- [x] Temp files listed and removed (below)
- [x] Verdict given: ready after fixes

## Clean-up list: everything I created in temp

All under a temp directory outside the project (about 137 MB), removed at the end of this review:

- `clone/` (fresh clone with `node_modules` and `dist`, 123 MB)
- `guard/` (scratch tests and configs for the no-network guard demo; `node_modules` symlink)
- `pw/` (temp `playwright-core` install, scripts and 6 screenshots, 14 MB)
- Scripts and outputs: `behavior.mjs`, `hostile.mjs`, `hostile.out`, `untrusted.mjs`, `placeholder.mjs`, `timing.mjs`, `m4.mjs`, `buildings.py`, `rules.py`, `rules2.py`, `bins.py`, `fulltext.py`, `docclaims.py`, `inspector.log`

Processes: the Inspector (UI on 6274 and proxy) and headless Chrome sessions were stopped. The two git backup bundles (kept outside the repo) were not touched.
