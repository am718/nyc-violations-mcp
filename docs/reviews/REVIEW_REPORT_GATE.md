# Gate review: nyc-violations-mcp (HEAD de5e396, 34 commits)

Date: 2026-11-03. Node 22.22.0 (the version in `engines: >=22`). All results below come from commands run during this review.

**Independence disclosure.** The brief asked for a reviewer who did not build the project. This pass was run by the same Claude session that built and fixed it, so it is **not independent**. I did not use the earlier reports or REVIEW.md as evidence; every number below was re-measured, and all probes were written fresh in a temp directory. A reviewer with no shared context could still find things I missed.

## Verdict: DO NOT PUSH (one major, narrow, easy to fix)

The server clones, builds and passes all 295 tests on the engines version. The limiter, placeholder handling, history and privacy checks, and the 10-building data check all passed. However, the gate's own rule is "a wrong building must NEVER come back as a success", and I found one input class that breaks it: a bare borough name for Queens. `resolve_property` with `"Queens"` or `"Queens, NY"` returns the Bronx building "QUEEN'S COURT" as a success with `confidence 1 / exact` and no error. Fifteen-plus other bad inputs were refused correctly, so the defect is narrow, but it is in the exact area (wrong building returned silently) that Fix 1 existed to close, and the user listed "a bare borough" as a required case. Fix it (a small change and a test), re-run this check, then push.

## Blockers and majors

**Blockers: none found.**

**MAJOR 1: bare "Queens" resolves to a Bronx building as a success.**
- File: `src/address.ts` (`parseInput` / `checkAddress`), which feeds `resolveAddress` in `src/resolve.ts`.
- Reproduction (live, real stdio server, fresh cache):
  - `resolve_property {"address":"Queens"}` and `{"address":"Queens, NY"}` return `isError` false, `address: "QUEEN'S COURT, Bronx, NY, USA"`, `bin 2102048`, `match: {confidence 1, match_type "exact"}`, plus the note "No borough or zip code was given...it is in Bronx".
  - Via `building_compliance_summary` the same input would likewise produce a summary for that building (not run separately; same `resolveAddress` path).
- Cause (from reading `src/address.ts`): with no house number the typed street text is the single token `queens`. GeoSearch returns the place "QUEEN'S COURT", which normalizes to `queens court`. `court` is in `STREET_TYPES`, so it is allowed as an extra token; no house number on either side passes; and no borough is "typed", because a borough word in the first comma part is treated as street text. The check passes. "Bronx", "Brooklyn", "Manhattan" and "Staten Island" were all refused (their candidates are colleges), so the defect depends on the name.
- Suggested fix: in `parseInput`/`checkAddress`, if the typed street text (after dropping place noise) is only a borough word, reject it as "only a borough was given" before comparing; and/or, for inputs with no house number, require the street tokens to match exactly (no extra street-type tokens). Add "Queens" and "Queens, NY" to `tests/address-match.test.ts` using recorded fixtures.
- Note: "Empire State Building" (a landmark name) is also a no-house success, correctly, so a blanket ban on house-less inputs is wrong.

## Check results

| # | Check | Result |
|---|---|---|
| 1 | Clean clone | `git clone` of the repo (34 commits), `npm ci` (0 vulnerabilities), `npm run build`, `npm test`: **9 files, 295 of 295 tests pass** on Node 22.22.0. No-network guard: a test calling real `fetch` failed with `NETWORK USED IN TEST: use fixtureFetch/stubFetch from tests/helpers.ts`. My attempt to switch the guard off to show the opposite case failed because of a macOS `sed` flag error, so I did not re-run it; the "guard blocks fetch" half is shown, the "passes without it" half is not shown in this review. |
| 2 | Addresses | 25 bad or tricky inputs and 12 correct ones through the real stdio server (see below). 23 of 25 bad inputs refused; 1 of the 25 turned out to be a genuine address (see below); **1 wrong success ("Queens, NY", plus "Queens" in an extra probe)**. All 12 correct inputs (abbreviations, upper case, no commas, zip form) succeeded. |
| 3 | Rate limit | 10 concurrent tool calls (alternating DOB and HPD, one a placeholder BIN) caused 27 upstream requests. Start-time gaps in ms: 1000 1002 1002 1000 1001 1001 1002 1001 1002 1001 1001 1002 1000 1001 1002 1001 1000 1002 1000 1001 1001 1001 1001 1001 1001 1001. **Minimum 1000 ms.** |
| 4 | Placeholders | `resolve_property`, `get_hpd_violations` and `building_compliance_summary` rejected BINs 1000000 to 5000000 and the placeholder BBLs I tried (block 00000, block 99999, lot 0000) with the placeholder message. `get_dob_violations` and `get_ecb_violations` take only `bin` (a `bbl` argument fails schema validation, so BBLs cannot reach them); all five placeholder BINs were rejected there too. A placeholder BIN taken live from upstream HPD data (1000000) was rejected by all 5 tools. The BBL `2048530011` (real lot, upstream BIN 2000000) resolves to BIN 2130638 and never lists 2000000 as a building. Note: 13 of my 50 cases first looked "not rejected"; all 13 were harness mistakes on my side (a `bbl` sent to a bin-only tool, and one BBL with block 00001, which is not a placeholder). |
| 5 | History and privacy | See commands below. All zero. |
| 6 | Fixture free text | 119 HTTP fixtures plus 13 evidence files; 111 records with text fields; 202 free-text values scanned. CERT/LIC numbers: 0. Phone numbers: 0. Emails: 0. See limitations for the residual items. |
| 7 | Data | 10 buildings re-queried directly (see below): **10 of 10 match** VALIDATION.md. |
| 8 | Claims | See below. |

### Check 2: the inputs

Bad (refused with the "does not match the closest NYC address found ... NOT used" error unless noted): "123 Fake Street, Queens"; "99999 Broadway, Manhattan"; "1 Nonexistentia Blvd, Brooklyn"; "350 5th Ave, Bronx"; "350 Fith Avenue, Manhattan"; "350 Fifth Avnue, Manhattan"; "Broadway & 42nd St, Manhattan"; "5th Ave and 34th St" (no match error); "Manhattan"; "Brooklyn"; "12345 Main St, Staten Island"; "1 Wall St, Queens"; "0 Broadway, Manhattan"; "-5 Broadway, Manhattan"; "Lot 1 Block 1, Manhattan"; "asdfghjkl" (no match error); "350 5th Ave, Manhattan, NY 11111"; "1600 Pennsylvania Ave, Manhattan"; "100 Queens Blvd"; "9999 5th Ave"; "1 Smith Street, Bronx"; "30 Rockefeller Plaza, Staten Island"; "Times Square" (refused: borough-level placeholder BIN).
Plus extra probes, all refused: "Bronx, NY", "Brooklyn, NY", "Manhattan, NY", "Staten Island, NY", "Queens Blvd", "Broadway", "Main Street", "Harlem", "New York", "Kings", "Brooklyn Heights", "Central Park, Manhattan", and a quote-injection address.
Succeeded: **"Queens, NY" (wrong, see MAJOR 1)**. "350 5th Ave, Brooklyn" also succeeded; the match was `350 5 AVENUE, Brooklyn` in Brooklyn, i.e. the street, number and borough all agree with the input, so I count it as a correct match, not a defect (I did not verify against an official source that the building exists).
Correct (all succeeded): "350 5th Ave, Manhattan"; "350 FIFTH AVENUE, MANHATTAN"; "350 fifth ave manhattan"; "233 Broadway, New York, NY 10279"; "209 Joralemon St, Brooklyn"; "209 JORALEMON STREET BROOKLYN"; "1 Centre St, Manhattan"; "11 Wall St, Manhattan"; "2 St Marks Pl, Manhattan"; "30 Rockefeller Plaza, Manhattan"; "1 E 161st St, Bronx"; "120 Broadway, Manhattan".

### Check 5: commands (run in the clone; all counts over 34 commits and 421 unique blobs)

```
git log --all --format='%an <%ae> | %cn <%ce>' | sort | uniq -c        -> 34 x AMQ <163986147+am718@users.noreply.github.com> (author and committer)
git log --all --format=%B | grep -ciE '<session-trailer and session-link patterns>'   -> 0
git log --all --format=%B | grep -i '^co-authored-by' | sort | uniq -c  -> 33 x Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
git log --all --format=%B | grep -ciE '<home-dir prefix>|<temp-dir prefix>|<temp-dir name>|<username>'        -> 0
git rev-list --all --objects | ... git cat-file --batch-check ... -> 421 blobs
per blob: session ids / trailers -> 0 ; absolute local paths or the temp-directory name -> 0 ; secret patterns (sk-, ghp_, AKIA, xox, private key, app token) -> 0 ; CERT/LIC numbers -> 0
per blob: username / personal email patterns -> 4, but 0 after removing the noreply address (the noreply address contains the username by design)
email-like strings in all blobs: noreply github address (5), noreply@anthropic.com (5); nothing else
respondent values (all blobs): 148 x "REDACTED", 37 x "RESPONDENT NAME REDACTED"; no other values
git ls-files | grep -iE '\.env$|\.sqlite|\.bundle|\.pem|\.key$|node_modules'   -> none tracked
git remote -v (source repo)  -> 0 lines; git branch -a -> main only; git status --short before this report -> clean
```

Not counted as a leak: the author display name "AMQ" and the name of a webmail provider appear as descriptive text in review documents (checked in the earlier pass; the per-blob address patterns above found no actual address).

### Check 7: data

Direct Socrata `count(*)` queries (my own `$where` strings, `bin=` equality, `upper(violation_category) like '%ACTIVE%'`, `ecb_violation_status='ACTIVE'`, `violationstatus='Open'`) for the 10 BINs. Open and total counts matched on all 10 for DOB, ECB and HPD. The VALIDATION.md "excl. deleted / excl. written off" columns are open minus annotated records; my annotated counts convert exactly (for example 350 5th Ave: 7 open, 7 with a DELETED comment, so 0; 233 Broadway: 11 open, 7 annotated, so 4; Grand Central ECB: 6 open, 6 written off, so 0). My first script compared the wrong quantity and printed 2 of 10; after correcting the interpretation it is 10 of 10.
- DOB deleted-annotation rule: Empire State Building summary says "7 of 7 open DOB record(s) carry a DELETED disposition comment ... open_excluding_deleted = 0", matching my direct query.
- HPD coverage note: for BIN 1015862 (commercial) the summary says "No HPD records found for this BIN. HPD covers residential buildings only; this is NOT evidence of compliance." My direct HPD count for the BIN was 0.
- Multi-building lot: lot 1009720001 has 35 distinct non-placeholder BINs in HPD and 35 in DOB (my queries). `resolve_property` by BBL returned 8 listed, `other_bins_total` 34, `other_bins_truncated` true. This matches (35 minus the queried BIN = 34).
- Other: BIN 2130638 (placeholder upstream BIN, real lot) works through its lot; placeholders are not listed as buildings.

### Check 8: README claims

VERIFIED by me now: Node 22 works (22.22.0); 295 tests offline; five tools; sources and notice in responses; untrusted-text fields; 1 request per second limiter; 12/13/14 requests measured on four buildings (Stuyvesant by BIN 12, Empire State by address 13, 233 Broadway 14, BIN 2130638 13; 11.3 to 14.1 s cold; repeat calls 0 requests, 1 ms); the summary returns at most 5 recent open items; `get_dob_violations` with `limit=100` returned 11,535 characters (under the ~12,000 cap); the BBL lot list is 8 entries (under "at most 9") with total and truncated fields; hostile BIN strings rejected before any upstream request; placeholder rejection; address matching; DOB open rule and deleted annotation; HPD coverage note; Stuyvesant "about 34 other buildings"; the example numbers for 1 Stuyvesant Oval (counts only: the 10-building check confirms the HPD 1 open of 63 and DOB 0/33).
Labeled UNVERIFIED in the README and still unverified: Claude Desktop; `claude mcp add` one-liner; Node 25 and other 22.x/24.x versions; comparison with the official city systems and the web UI.
Neither verified nor clearly labeled (list for the author):
1. README line 36 says "290 tests"; the suite now has 295 (stale number, not wrong behaviour). Node 24.22.2 passing is stated but I did not re-run it (I ran 22.22.0 only).
2. Lines 68 to 69: "this JSON shape was loaded by Claude Code and the tools were called successfully (docs/evidence/conversation-*.txt)". I confirmed the evidence files exist but did not re-run Claude Code (needs a model call); it is a claim about a past run.
3. Lines 143 to 155 (comparison with other servers): tool counts, licences and languages of third-party repos. I did not check them (network use was limited to NYC Open Data and GeoSearch). The README does say most come "from directory listings", but the specific facts are not marked UNVERIFIED.
4. Line 127: "Datasets were updated within about a day when checked." Today the DOB and HPD datasets were last updated 2026-11-02 and the ECB dataset on 2026-10-31 (about 3 days). The sentence is time-dependent and could mislead later.
5. Lines 86 to 102: the two example conversations are quoted output of past model runs. I could not reproduce model wording; the numbers they quote for the BINs agree with the direct data checks above.

## Known limitations (minors)

- **Possible residual person fragment in one fixture/evidence file.** Two occurrences of one disposition comment still show a 2-letter word and a 4-letter word before "REDACTED" ("... BY xx yyyy REDACTED ..."). I did not print them; I cannot tell if they are initials or a partial name. Suggest a manual look and, if in doubt, redact the whole span.
- **DOB staff identifiers.** 7 fixture/evidence files contain "DELETED BY <3-letter code> ON <date>" in DOB comments (agency staff initials, not private persons). Kept by design; counted here for completeness.
- **Free-text sampling.** 61 distinct tokens in the 202 scanned values are not in the system dictionary (30 of them occur in project source or docs; the other 31 are mostly typos, abbreviations and street/business words). My name check was pattern-based (role word plus two capitalised words: 14 hits, 11 of them the DOB-staff-code or fragment cases above), so a private name in an unusual position could be missed.
- README claims listed as "neither verified nor labeled" (4 items above).
- Street matching uses a small abbreviation table; an unknown spelling gives an error showing the candidate and its BIN (observed for "Fith", "Avnue"), not a wrong building.
- Cold `building_compliance_summary` takes 11 to 14 s because of the 1 request/second limit (as documented).
- "350 5th Ave, Brooklyn" succeeds because the address exists in Brooklyn; users who forget the borough get a note, not an error.
- The rate limiter is per process (documented).

## What I could not check

- Whether Node 24 and Node 20 behave as the README says (I tested 22.22.0 only; Node 20 and 24 were verified in the earlier session, not re-run here).
- The "guard off passes" half of the no-network proof (my sed command failed; not re-run).
- Claude Desktop, Claude Code end to end, a live Socrata app token.
- Comparison with DOB BIS/DOB NOW, HPD Online, OATH, and the Open Data web UI.
- Third-party repo facts in the README comparison section.
- Whether the quoted building facts in the example conversations match the official systems.
- Review independence (see disclosure).
- I did not touch the five backup bundles in the session's temp directory.

## Temp files created and removed

Created in a temp directory outside the project: a clone of the repo with `node_modules`, three SQLite cache files, the probe scripts (`lib.mjs`, `addr.mjs`, `two.mjs`, `rate.mjs`, `ph.mjs`, `multi.mjs`, `val.mjs`, `claims.mjs`, `more.mjs`, `ft*.py`), the blob list and an unknown-token list (`unk.json`, which holds tokens from fixture text). One stray file was created by mistake in the system temp directory and moved into that directory. At the end I deleted that whole directory; I did not delete or modify anything else. The only change to the project is this file, `REVIEW_REPORT_GATE.md`.
