# Data sources (verified by live query, 2026-11-01)

All from NYC Open Data (Socrata, `data.cityofnewyork.us`), queried at `/resource/<id>.json`.
"Data last updated" is the dataset's `rowsUpdatedAt` from `/api/views/<id>.json`.

| Dataset | ID | Data last updated (UTC) | Join keys present |
|---|---|---|---|
| DOB Violations | `3h2n-5cm9` | 2026-11-01 18:38 | `bin`, `boro`+`block`+`lot` (no `bbl` column) |
| DOB ECB Violations | `6bgk-3dad` | 2026-10-31 17:10 | `bin`, `boro`+`block`+`lot` (no `bbl` column) |
| HPD Housing Maintenance Code Violations | `wvxf-dwi5` | 2026-11-01 15:53 | `bin`, `bbl`, `boroid` |

Address resolution: NYC Planning Labs GeoSearch, `https://geosearch.planninglabs.nyc/v2/search?text=...`
(verified live; returns `properties.addendum.pad.bbl` and `.bin`, plus `borough`, `label`).
Example: "350 5th Ave Manhattan" -> BIN 1015862, BBL 1008350041 (confidence 0.8, match_type fallback).

### What GeoSearch `confidence` 0.8 actually means (verified live 2026-11-02)

Match-quality fields present on each feature: `confidence`, `match_type`, `accuracy`, plus the matched `housenumber`, `street`,
`borough`, `postalcode`. In 40+ queries, **every street-address query returned `confidence: 0.8`, `match_type: fallback`,
`accuracy: point`, whether the match was right or wrong**:

- right: "350 5th Ave, Manhattan", "1 Stuyvesant Oval, Manhattan", "37-02 Main St, Queens", ...
- wrong: "123 Fake Street, Queens" -> 123 WEST 123 STREET (Manhattan); "Lot 1 Block 1, Manhattan" -> 1 LT HALLORAN STREET;
  "9999 5th Ave, Manhattan" -> house number 6; "5th Ave" (no number) -> a Queens building; "100 Queens Blvd, Queens" -> 30-100.
- The only different values seen were `confidence: 1` / `match_type: exact` for a landmark *name* ("Empire State Building").
- A wrong zip code in the input (11111) is ignored by GeoSearch (same building returned).

So 0.8 means "GeoSearch returned its best candidate", not "the address matched", and the score cannot be used as a quality gate.
The tool therefore compares what the caller typed with what came back (`src/address.ts`): house number (must be equal, or both
absent), street name (abbreviations, ordinals, directions and Saint/St normalized; every typed word must be found), borough
(if the caller gave one) and zip (if the caller gave one). On any difference it returns an error showing the best candidate and its BIN,
and does not return the building as a success. If no borough or zip was typed, the match carries a note naming the borough
that was assumed. The check is deliberately strict: an unusual spelling the table does not know (e.g. a new abbreviation) produces
an error that still shows the candidate, so the caller can confirm it by passing its BIN. The `< 0.8` low-confidence note is kept but
has not been seen to fire.

## Verified field names

**DOB (`3h2n-5cm9`)**: isn_dob_bis_viol, boro, bin, block, lot, issue_date, violation_type_code, violation_number,
house_number, street, disposition_date, disposition_comments, device_number, description, ecb_number, number,
violation_category, violation_type.
- Dates are text `YYYYMMDD` (e.g. `19880802`). No explicit status column: status is encoded in `violation_category`
  (values seen: `V-DOB VIOLATION - ACTIVE`, `V*-DOB VIOLATION - Resolved`, `V*-DOB VIOLATION - DISMISSED`, and
  W/O-permit / unserved-ECB variants with `ACTIVE` or `DISMISSED`). Rule to decide: ACTIVE in category = open.
  Edge case (verified): 13 ACTIVE rows carry a `disposition_date` (10 say "DELETED BY ... BECAUSE DUPLICATE/..."; 2 say
  "PAID INVOICE"; 1 has the junk date "7"), and many more ACTIVE rows carry `disposition_comments` without a date
  (all 7 ACTIVE records at the Empire State Building say "DELETED BY ... BECAUSE ..."). They are still classed **open**
  by the rule, with a per-item `caveat`/`flag`; the summary adds `open_flagged_deleted` / `open_excluding_deleted` (see below).
  The 13 rows are recorded in `tests/fixtures/dob_active_with_disposition.json` and tested in `tests/status-and-dates.test.ts`.
- DOB/ECB `block` and `lot` are zero-padded 5-digit text (lot `00041`); a BBL's lot is 4 digits (`0041`). A BBL maps to
  DOB/ECB rows via `boro` + `block` + `lot` (`0` prepended to the BBL lot). Verified live.
- Text fields are space-padded (`violation_type`).

**ECB (`6bgk-3dad`)**: isn_dob_bis_extract, ecb_violation_number, ecb_violation_status, dob_violation_number, bin, boro,
block, lot, hearing_date, hearing_time, served_date, issue_date, severity, violation_type, respondent_name,
respondent_house_number, respondent_street, respondent_city, respondent_zip, violation_description, penality_imposed
(sic), amount_paid, balance_due, infraction_code1..10, section_law_description1..10, aggravated_level, hearing_status,
certification_status.
- `ecb_violation_status` values: `ACTIVE`, `RESOLVE`, `Unknown`, and sometimes absent. Dates are `YYYYMMDD` text.
- Rows contain respondent personal/business names and free-text descriptions: untrusted text.

**HPD (`wvxf-dwi5`)**: violationid, buildingid, registrationid, boroid, boro, housenumber, lowhousenumber,
highhousenumber, streetname, streetcode, zip, apartment, story, block, lot, class, inspectiondate, approveddate,
originalcertifybydate, originalcorrectbydate, newcertifybydate, newcorrectbydate, certifieddate, ordernumber, novid,
novdescription, novissueddate, currentstatusid, currentstatus, currentstatusdate, novtype, violationstatus,
rentimpairing, latitude, longitude, communityboard, councildistrict, censustract, bin, bbl, nta.
- `violationstatus` values: `Open`, `Close`. Dates are ISO timestamps (`2026-10-31T00:00:00.000`).
- HPD covers residential housing maintenance only; commercial buildings (e.g. Empire State Building) return no rows.

## Status mapping (one place: `src/status.ts`)

| Dataset | Column | open | closed | other |
|---|---|---|---|---|
| DOB | `violation_category` | contains `ACTIVE` (**heuristic**) | contains `Resolved` or `DISMISSED` | `unknown` |
| ECB | `ecb_violation_status` | `ACTIVE` | `RESOLVE` | `Unknown`/missing -> `unknown` |
| HPD | `violationstatus` | `Open` | `Close` | `unknown` |

The DOB rule is a heuristic because the dataset has no explicit open/closed column. ECB "open" includes ACTIVE records whose
hearing status is e.g. `WRITTEN OFF` (59,165 citywide rows); the hearing status is returned per record.

## Second open count: annotated records (heuristic, never a silent reclassification)

`building_compliance_summary` keeps the raw `open` counts and adds a second count per agency, plus a `data_quality_notes` array
as the **first** key of the response:

| Agency | Raw | Flag rule (verified live 2026-11-01) | Extra fields |
|---|---|---|---|
| DOB | `open` = `ACTIVE` in `violation_category` | `disposition_comments` contains `DELETED` (31,834 of 573,684 ACTIVE rows citywide; e.g. "DELETED BY LCA ON 03/16/2011 BECAUSE WRONG ADDRESS") | `open_flagged_deleted`, `open_excluding_deleted` |
| ECB | `open` = `ecb_violation_status = ACTIVE` | `hearing_status = WRITTEN OFF` (59,165 ACTIVE rows citywide) | `open_flagged_written_off`, `open_excluding_written_off` |
| HPD | `open` = `violationstatus = Open` | none | none |

This is a heuristic. Other DOB annotations (e.g. "BARAMIS OVERNIGHT RUN - ECB NUMBER MATCH", 98 rows; "PAID INVOICE") are NOT
excluded; they only get a generic per-item caveat. Flagged items stay in `most_recent_open_items`, marked `[annotated DELETED]` or
`[WRITTEN OFF]`. Verify against DOB/OATH before treating either number as authoritative.

## Dates (one place: `normalizeDate` in `src/normalize.ts`)
DOB/ECB `YYYYMMDD` text and HPD ISO timestamps are normalized to `YYYY-MM-DD` before merging/sorting. Unparseable values
become `null` (sorted last). HPD "issue date" = `novissueddate` (falls back to `inspectiondate`).

### Recency ordering and undated rows (verified live 2026-11-01)
- Socrata sorts NULLs **first** on `DESC`. `NULLS LAST` is accepted, but the server does not rely on it: recency queries
  filter to rows with a usable date instead.
- HPD: 812,468 rows have no `novissueddate` (228,588 of them Open). Filter: `novissueddate IS NOT NULL`.
  The HPD issue date is the NOV issue date only (no fallback to inspection date).
- DOB `issue_date` is text with junk values (30 rows not 8-digit: e.g. `Y30819`, `0306`, `000000`; 1 null). Because text sorts
  lexically, `Y30819` sorts ABOVE `20211007`. ECB has 64 such rows (e.g. `0`). Filter for DOB/ECB:
  `issue_date between '18000101' and '22001231' AND issue_date like '________'`.
- **Calendar validity (2026-11-02).** The DOB/ECB filter also requires month 01-12, day 01-31, no Feb 30/31 and no 31st in 30-day months.
  Live, this moves 10 more DOB rows (e.g. `19108124`) into the undated/invalid count; ECB loses none. Feb 29 in a non-leap year cannot be
  expressed in SoQL (3 DOB rows citywide, years 1990 and 1991), so the tools drop any returned row whose date is not a real calendar date
  and add it to the undated/invalid count; for those 3 rows the count is exact only when the row is on the returned page.
- Recency lists (`get_*_violations`, `most_recent_open_items`) contain dated rows only and report how many matching rows were left
  out (`undated_excluded`, `open_undated_excluded_from_recent_list`). `total_matching` and the open/closed counts still include them.
- `most_recent_issue_date` is `max()` over dated rows only.

## Placeholder identifiers (rejected by every tool)
- **BINs `X000000`** (`1000000`, `2000000`, `3000000`, `4000000`, `5000000`) mean "building unknown" in the borough. Thousands of unrelated
  records share them (verified live 2026-11-01: BIN `1000000` has DOB 96, ECB 230, HPD 7,441 rows; `2000000` HPD 7,891; `3000000` HPD 12,148;
  `5000000` HPD 829). The tools reject them and say to use the street address.
- **BBLs with block `00000` or `99999`, or lot `0000`** are the matching placeholders (verified live 2026-11-02: DOB has 5,842 rows across
  811 BINs with block 00000 and lot 00000; ECB 178 rows across 78 BINs; a handful of DOB rows have block 99999). They are rejected the same way.
  A real BIN whose DOB records only carry an unknown block/lot cannot be turned into a BBL: `resolve_property` and the summary say so, while
  `get_dob_violations` / `get_ecb_violations` still work with that BIN.
- Also rejected when they come back from GeoSearch or from DOB/HPD rows, and the query builder refuses them as defense in depth.

## Untrusted text
Descriptions, comments and category text come from public records. They are truncated, control-stripped and returned as data. They also feed classification (DOB category `ACTIVE`, comment `DELETED`, ECB hearing status), so a crafted record could change a record's open/closed bucket, but nothing in the server follows instructions found in text.

## Caveats
- Open data lags official systems (DOB BIS/DOB NOW, HPD, OATH). Counts can differ from the city's live property pages.
- Dataset IDs and fields can change; re-verify before relying on them.

## Fixture free text (reviewed 2026-11-02)

Recorded fixtures keep the agencies' free-text fields (descriptions, disposition comments) because tests depend on their wording.
They were reviewed for personal data: of 37 unusual words (5+ letters, not in a dictionary) in 171 distinct records, 19 occur only in
code-like system fields (violation type/category, law section), 8 are typos or inflections of dictionary words, and 10 were redacted
from the free-form fields. One disposition comment held a private person's name next to a certificate number; both were redacted,
as were two certificate/licence numbers. Staff initials ("DELETED BY XX") and business or street names from public records were kept.
A second review (2026-11-03, after the gate review) found that one comment still had two words (2 and 4 letters, not dictionary words)
between "BY" and the redacted name, in 2 places in 1 fixture. They were redacted in the tree and in all history. A search of all
fixtures and evidence for letters next to REDACTED found 0 directly adjacent and no other name-like word before it (the rest are
"NAME", "CERT", ordinary words and escape-sequence debris).
`scripts/redact.ts` (used by `scripts/record-fixtures.ts`) blanks `CERT#`/`LIC#` numbers and any words signed between "BY" and a
CERT/LIC marker when recording, and `tests/redaction.test.ts` fails if a committed fixture or evidence file has letters next to
REDACTED, words left between BY and CERT/LIC, a certificate number or a non-placeholder respondent value. Names in other positions
cannot be found by a rule: **after re-recording, review new free text by hand** before committing.
`docs/evidence/inspector-*.json` is raw live output of `scripts/inspector-check.sh`: apply the same manual review after regenerating it.
