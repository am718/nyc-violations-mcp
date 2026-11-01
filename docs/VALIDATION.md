# Validation: summary counts vs. NYC Open Data

## What was actually compared (read this first)

For 10 well-known buildings, `building_compliance_summary` was run live through the real tool code
(`npm run validate`, script: `scripts/validate.ts`). Its per-agency counts were then recounted with **plain Socrata
queries written independently of the server's query builder** (simple `field=value` filters + `count(*)`).

**Limitation, stated plainly:** the Open Data web UI (data.cityofnewyork.us dataset pages) is a JavaScript app that I
could not drive from this environment, and it reads from the same Socrata backend as the API. So this is an
API-to-API cross-check, **not** a visual comparison against the web UI. The UI comparison is **UNVERIFIED**;
the manual steps to do it are at the bottom. It also does not validate against DOB BIS / DOB NOW / HPD Online
(see "Official systems" below).

Format of each cell: `open/total`. A cell shows `tool / **independent**` only when they differ.
For HPD, "none (coverage note)" means the tool returned null counts plus the coverage note, and the
independent recount also found 0 rows.

## Results (Run at 2026-11-01T22:02:33.974Z)

| Address | BIN | BBL | DOB open/total (tool / independent) | ECB open/total | HPD open/total | Result |
|---|---|---|---|---|---|---|
| 350 5th Ave, Manhattan | 1015862 | 1008350041 | 7/691 | 0/241 | none (coverage note) | match |
| 175 5th Ave, Manhattan | 1016278 | 1008510001 | 5/131 | 0/96 | none (coverage note) | match |
| 405 Lexington Ave, Manhattan | 1036156 | 1012970023 | 2/469 | 0/53 | none (coverage note) | match |
| 285 Fulton St, Manhattan | 1088469 | 1000580001 | 1/1 | 1/1 | none (coverage note) | match |
| 89 E 42nd St, Manhattan | 1035381 | 1012800001 | 154/157 | 6/26 | none (coverage note) | match |
| 233 Broadway, Manhattan | 1087167 | 1001237501 | 11/244 | 1/66 | none (coverage note) | match |
| 1 W 72nd St, Manhattan | 1028637 | 1011250025 | 1/109 | 0/10 | 0/1 | match |
| 209 Joralemon St, Brooklyn | 3000256 | 3001390001 | 6/54 | 1/3 | none (coverage note) | match |
| 1 E 161st St, Bronx | 2114490 | 2024930001 | 8/123 | 0/29 | none (coverage note) | match |
| 1 Stuyvesant Oval, Manhattan | 1082881 | 1009720001 | 0/33 | 0/1 | 15/626 | match |

All rows match: true

## Notes on the results

- Counts match for all 10 buildings, so the tool's aggregation, status mapping and BIN/BBL handling agree with a
  direct query of the same data. Because both paths use the same dataset, this cannot detect problems in the data itself.
- Commercial/civic buildings (Empire State, Flatiron, Chrysler, One WTC, Grand Central, Woolworth, Borough Hall,
  Yankee Stadium) have no HPD rows, as expected: the tool says "no HPD coverage expected or none found" rather than 0.
  The Dakota has a single closed HPD record. Stuyvesant Town (residential) has 626 HPD records, 15 open.
- DOB "open" is the `ACTIVE`-in-`violation_category` heuristic. Many "open" DOB records are old and carry
  disposition notes such as "DELETED BY ... BECAUSE DUPLICATE" (all 7 "open" records at the Empire State Building do).
  The tool flags these (`open_with_disposition_notes`, per-item `caveat`). So **do not read the DOB open count as the
  number of genuinely outstanding violations**; compare with DOB's own system before relying on it.
- Address matching used GeoSearch; every address resolved to a BIN/BBL on the first try, but only the match
  *confidence/type* is reported, not manually checked for all 10. BINs were spot-checked as plausible
  (e.g., Empire State = 1015862) but not verified against another source.

## Official systems (not compared)

Open data lags DOB BIS/DOB NOW, HPD Online and OATH. No comparison to those systems was made. UNVERIFIED.

## How to do the UI comparison manually

1. Open `https://data.cityofnewyork.us/d/3h2n-5cm9` (DOB Violations), add a filter `BIN = <bin>`, note the row count.
   Repeat for ECB (`6bgk-3dad`, filter `BIN`) and HPD (`wvxf-dwi5`, filter `BBL`).
2. Add a second filter for status (DOB: Violation Category contains ACTIVE; ECB: ECB Violation Status = ACTIVE;
   HPD: Violation Status = Open) and compare with the table above.
3. Raw API links for any building: `https://data.cityofnewyork.us/resource/3h2n-5cm9.json?bin=<bin>&$select=count(*)`.
