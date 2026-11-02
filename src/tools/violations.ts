import { DATASETS, LIMITS, SOURCE_NAME, type DatasetKey } from "../config.js";
import { ToolError } from "../errors.js";
import { capList, envelope, type SourceRef } from "../format.js";
import { byDateDesc, mapRows } from "../normalize.js";
import { resolveProperty, type Resolver } from "../resolve.js";
import { queries, type Locator } from "../socrata.js";

export const HPD_COVERAGE_NOTE =
  "No HPD violation records found. HPD covers residential housing maintenance only, so no HPD coverage may be " +
  "expected for this property (e.g. commercial/office buildings) or there may simply be none on record. " +
  "This is NOT evidence the property is compliant.";

const AGENCY_LABEL: Record<DatasetKey, string> = { dob: "DOB", ecb: "ECB", hpd: "HPD" };

export const src = (key: DatasetKey, fetchedAt: string): SourceRef => ({
  source: SOURCE_NAME,
  dataset_id: DATASETS[key].id,
  dataset_name: DATASETS[key].name,
  fetched_at: fetchedAt,
});

export interface ListArgs {
  status?: "open" | "closed";
  limit: number;
}

async function listViolations(r: Resolver, agency: DatasetKey, loc: Locator, args: ListArgs, extraSources: SourceRef[] = []) {
  const total = await r.socrata.count(queries.count(agency, loc, args.status));
  const dated = await r.socrata.count(queries.count(agency, loc, args.status, true));
  const page = await r.socrata.query(queries.list(agency, loc, args.status, args.limit));
  const mapped = mapRows(agency, page.rows);
  const skipped = mapped.skipped;
  // Rows the SoQL filter counted as dated but whose date is not a real calendar date (e.g. Feb 29 in a non-leap year) are
  // treated as invalid: removed from the recency list and added to the undated/invalid count.
  const invalidInPage = mapped.items.filter((v) => v.issue_date === null).length;
  const items = mapped.items.filter((v) => v.issue_date !== null);
  items.sort(byDateDesc);
  const undated = Math.max(0, total.n - dated.n) + invalidInPage;
  const notes: string[] = [];
  if (skipped > 0) notes.push(`${skipped} malformed row(s) without an identifier were skipped.`);
  if (agency === "dob") notes.push('DOB status is derived from violation_category ("ACTIVE" = open); this is a heuristic.');
  if (undated > 0) {
    notes.push(
      `${undated} matching record(s) have a missing or invalid issue date and are left out of this newest-first list (they are still counted in total_matching).`,
    );
  }
  if (total.n === 0) {
    notes.push(
      agency === "hpd"
        ? HPD_COVERAGE_NOTE
        : `No ${AGENCY_LABEL[agency]} violation records found${args.status ? ` with status "${args.status}"` : ""} for this property. ` +
            "Verify the identifier with resolve_property; absence in open data is not proof of compliance.",
    );
  }
  const body = {
    agency: AGENCY_LABEL[agency],
    query: { ...(loc.by === "bin" ? { bin: loc.bin } : { bbl: loc.bbl }), status: args.status ?? "any", limit: args.limit },
    total_matching: total.n,
    returned: items.length,
    ...(dated.n - invalidInPage > items.length ? { more_available: true } : {}),
    undated_excluded: undated,
    ...(agency === "hpd" && total.n === 0 ? { coverage: "no HPD coverage expected or none found" } : {}),
    violations: items,
    ...(notes.length ? { notes } : {}),
  };
  return capList(
    envelope(
      [src(agency, page.fetchedAt), src(agency, total.fetchedAt), src(agency, dated.fetchedAt), ...extraSources],
      body,
      ["violations[].description", "violations[].type", "violations[].status_raw", "violations[].caveat", "violations[].details.*"],
    ),
    "violations",
    LIMITS.maxResponseChars,
  );
}

export const getDobViolations = (r: Resolver, a: ListArgs & { bin: string }) =>
  listViolations(r, "dob", { by: "bin", bin: a.bin }, a);
export const getEcbViolations = (r: Resolver, a: ListArgs & { bin: string }) =>
  listViolations(r, "ecb", { by: "bin", bin: a.bin }, a);

export async function getHpdViolations(r: Resolver, a: ListArgs & { bin?: string; bbl?: string }) {
  let loc: Locator;
  let extra: SourceRef[] = [];
  if (a.bin !== undefined && a.bbl !== undefined) {
    const p = await resolveProperty(r, { bin: a.bin, bbl: a.bbl }); // throws a fix-it error if they disagree
    extra = p.sources;
    loc = { by: "bbl", bbl: p.bbl };
  } else if (a.bbl !== undefined) {
    loc = { by: "bbl", bbl: a.bbl };
  } else if (a.bin !== undefined) {
    loc = { by: "bin", bin: a.bin };
  } else {
    throw new ToolError(
      'Provide bbl (e.g. "2046540021") or bin (e.g. "2099579"). Use resolve_property first if you only have an address.',
    );
  }
  return listViolations(r, "hpd", loc, a, extra);
}
