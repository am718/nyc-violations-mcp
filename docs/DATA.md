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
Example: "350 5th Ave Manhattan" -> BIN 1015862, BBL 1008350041 (confidence 0.8, match_type fallback; check confidence).

## Verified field names

**DOB (`3h2n-5cm9`)**: isn_dob_bis_viol, boro, bin, block, lot, issue_date, violation_type_code, violation_number,
house_number, street, disposition_date, disposition_comments, device_number, description, ecb_number, number,
violation_category, violation_type.
- Dates are text `YYYYMMDD` (e.g. `19880802`). No explicit status column: status is encoded in `violation_category`
  (values seen: `V-DOB VIOLATION - ACTIVE`, `V*-DOB VIOLATION - Resolved`, `V*-DOB VIOLATION - DISMISSED`, and
  W/O-permit / unserved-ECB variants with `ACTIVE` or `DISMISSED`). Rule to decide: ACTIVE in category = open.
  UNVERIFIED mapping edge case: 13 ACTIVE rows carry a disposition_date.
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

## Caveats
- Open data lags official systems (DOB BIS/DOB NOW, HPD, OATH). Counts can differ from the city's live property pages.
- Dataset IDs and fields can change; re-verify before relying on them.
