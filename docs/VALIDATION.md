# Validation: summary counts vs. NYC Open Data

## What was actually compared (read this first)

For 10 well-known buildings, `building_compliance_summary` was run live through the real tool code (`npm run validate`,
`scripts/validate.ts`). Its numbers were then recounted with **plain Socrata queries written independently of the server's
query builder** (simple `field=value` filters, `count(*)`, `count(distinct bin)`). All three datasets are compared **by BIN**
(the same footprint the tool now uses), including:

- raw DOB / ECB / HPD open and total counts,
- the second counts excluding annotated records (DOB `DELETED`, ECB `WRITTEN OFF`),
- `other_bins_on_lot` (approximate: max of distinct BINs seen on the lot in DOB and HPD, minus 1).

**Limitation, stated plainly:** the Open Data web UI (data.cityofnewyork.us dataset pages) is a JavaScript app that could not be
driven from this environment, and it reads from the same Socrata backend as the API. So this is an API-to-API cross-check, **not**
a comparison against the web UI. **The web-UI comparison is UNVERIFIED** (manual steps at the bottom). It also does not validate
against DOB BIS / DOB NOW / HPD Online / OATH, and it cannot detect problems in the upstream data.

## Results (Run at 2026-11-02T01:14:05.826Z)

Cell format `open/total`; `tool / **independent**` is shown only where they differ (none did). "excl. deleted" and "excl. written off"
are the second open counts (open minus annotated records); they are heuristics, not reclassifications.

| Address | BIN | DOB open/total (tool / independent) | ECB open/total | HPD open/total (by BIN) | other_bins_on_lot | Result |
|---|---|---|---|---|---|---|
| 350 5th Ave, Manhattan | 1015862 | 7/691 (excl. deleted 0) | 0/241 (excl. written off 0) | none (coverage note) | 0 (DOB bins on lot 1; HPD bins 0) | match |
| 175 5th Ave, Manhattan | 1016278 | 5/131 (excl. deleted 5) | 0/96 (excl. written off 0) | none (coverage note) | 0 (DOB bins on lot 1; HPD bins 0) | match |
| 405 Lexington Ave, Manhattan | 1036156 | 2/469 (excl. deleted 1) | 0/53 (excl. written off 0) | none (coverage note) | 0 (DOB bins on lot 1; HPD bins 0) | match |
| 285 Fulton St, Manhattan | 1088469 | 1/1 (excl. deleted 1) | 1/1 (excl. written off 1) | none (coverage note) | 3 (DOB bins on lot 4; HPD bins 0) | match |
| 89 E 42nd St, Manhattan | 1035381 | 154/157 (excl. deleted 154) | 6/26 (excl. written off 0) | none (coverage note) | 0 (DOB bins on lot 1; HPD bins 0) | match |
| 233 Broadway, Manhattan | 1087167 | 11/244 (excl. deleted 4) | 1/66 (excl. written off 1) | none (coverage note) | 0 (DOB bins on lot 1; HPD bins 0) | match |
| 1 W 72nd St, Manhattan | 1028637 | 1/109 (excl. deleted 0) | 0/10 (excl. written off 0) | 0/1 | 1 (DOB bins on lot 2; HPD bins 1) | match |
| 209 Joralemon St, Brooklyn | 3000256 | 6/54 (excl. deleted 5) | 1/3 (excl. written off 1) | none (coverage note) | 0 (DOB bins on lot 1; HPD bins 0) | match |
| 1 E 161st St, Bronx | 2114490 | 8/123 (excl. deleted 8) | 0/29 (excl. written off 0) | none (coverage note) | 0 (DOB bins on lot 1; HPD bins 0) | match |
| 1 Stuyvesant Oval, Manhattan | 1082881 | 0/33 (excl. deleted 0) | 0/1 (excl. written off 0) | 1/63 | 34 (DOB bins on lot 35; HPD bins 35) | match |

All 10 buildings matched on every check (10 of 10). The previous validation (before the fix pass) compared HPD by whole lot; this
run compares HPD by BIN, which is what the tool now returns.

## Notes on the results

- Commercial/civic buildings have no HPD rows: the tool says "no HPD coverage expected or none found" rather than 0.
- Stuyvesant Town: the summary covers BIN 1082881 only (DOB 33 records, HPD 63 records) and reports `other_bins_on_lot: 34`; the whole lot has
  35 BINs and 626 HPD records. One WTC's lot has 3 other BINs; The Dakota's lot has 1.
- Annotated "open" DOB records vary a lot: all 7 at the Empire State Building are `DELETED` (0 left), while Grand Central's 154
  "open" DOB records have none flagged. The flagged counts are a heuristic, not a verdict; verify in DOB's own system.
- ECB "open" at Grand Central (6) is all `WRITTEN OFF`; at One WTC, Woolworth and Borough Hall the 1 open ECB record is not written off.
- Addresses resolved on the first try with GeoSearch confidence 0.8 (`match_type: fallback`) for the three checked by hand;
  BINs were not verified against another authoritative source.

## Official systems (not compared)

Open data lags DOB BIS/DOB NOW, HPD Online and OATH. No comparison to those systems was made. UNVERIFIED.

## How to do the web-UI comparison manually

1. Open `https://data.cityofnewyork.us/d/3h2n-5cm9` (DOB Violations), add a filter `BIN = <bin>`, note the row count.
   Repeat for ECB (`6bgk-3dad`, filter `BIN`) and HPD (`wvxf-dwi5`, filter `BIN`).
2. Add a status filter (DOB: Violation Category contains ACTIVE; ECB: ECB Violation Status = ACTIVE; HPD: Violation Status = Open)
   and compare with the table above.
3. Raw API links: `https://data.cityofnewyork.us/resource/3h2n-5cm9.json?bin=<bin>&$select=count(*)`.
