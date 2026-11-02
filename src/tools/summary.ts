import { DATASETS, SOCRATA_BASE, type DatasetKey } from "../config.js";
import { envelope, type SourceRef } from "../format.js";
import { byDateDesc, cleanText, mapRows, normalizeDate, isRow, type Violation } from "../normalize.js";
import { otherBinsOnLot, resolveProperty, type Resolver } from "../resolve.js";
import { queries, type Locator } from "../socrata.js";
import { STATUS_MAPPER } from "../status.js";
import { HPD_COVERAGE_NOTE, src } from "./violations.js";

const LABEL: Record<DatasetKey, string> = { dob: "DOB", ecb: "ECB", hpd: "HPD" };
const ID_FIELD: Record<DatasetKey, string> = { dob: "isn_dob_bis_viol", ecb: "ecb_violation_number", hpd: "violationid" };
const LOC_FIELD: Record<DatasetKey, string> = { dob: "bin", ecb: "bin", hpd: "bin" };

function oneLine(v: Violation): string {
  const what = v.description ?? v.type ?? "(no description)";
  const mark = v.flag === "annotated_deleted" ? " [annotated DELETED]" : v.flag === "written_off" ? " [WRITTEN OFF]" : "";
  return `${v.issue_date ?? "date unknown"} · ${LABEL[v.agency]} ${v.id} · ${what.length > 110 ? `${what.slice(0, 109)}…` : what}${mark}`;
}

async function agencySummary(r: Resolver, agency: DatasetKey, loc: Locator) {
  const grouped = await r.socrata.query(queries.statusCounts(agency, loc));
  const dated = await r.socrata.query(queries.datedStatusStats(agency, loc));
  const openRows = await r.socrata.query(queries.list(agency, loc, "open", 5));
  const counts = { open: 0, closed: 0, unknown: 0 };
  const srcsExtra: SourceRef[] = [];
  const statusOf = (row: Record<string, unknown>) => {
    const field = Object.keys(row).find((k) => k !== "n" && k !== "latest");
    return STATUS_MAPPER[agency](field ? row[field] : undefined);
  };
  for (const row of grouped.rows) {
    if (!isRow(row)) continue;
    const n = Number(row.n);
    if (Number.isFinite(n) && n >= 0) counts[statusOf(row)] += Math.trunc(n);
  }
  // Latest date and dated-open count come from rows with a usable date only (junk text dates would win max()).
  let latest: string | null = null;
  let datedOpen = 0;
  for (const row of dated.rows) {
    if (!isRow(row)) continue;
    const n = Number(row.n);
    if (statusOf(row) === "open" && Number.isFinite(n) && n >= 0) datedOpen += Math.trunc(n);
    const d = normalizeDate(row.latest);
    if (d && (!latest || d > latest)) latest = d;
  }
  const undatedOpenBase = Math.max(0, counts.open - datedOpen);
  const total = counts.open + counts.closed + counts.unknown;
  // Second count: open records annotated as deleted (DOB) / written off (ECB). Raw `open` is kept unchanged.
  let flagged: number | null = null;
  if ((agency === "dob" || agency === "ecb") && counts.open > 0) {
    const c = await r.socrata.count(queries.openFlagged(agency, loc));
    flagged = Math.min(c.n, counts.open);
    srcsExtra.push(src(agency, c.fetchedAt));
  }
  const mappedOpen = mapRows(agency, openRows.rows).items;
  // Open rows counted as dated by SoQL but with an impossible calendar date are invalid: left out and counted as undated.
  const invalidOpen = mappedOpen.filter((v) => v.issue_date === null).length;
  const items = mappedOpen.filter((v) => v.issue_date !== null);
  const undatedOpen = undatedOpenBase + invalidOpen;
  const link = () => `${SOCRATA_BASE}/${DATASETS[agency].id}.json?${LOC_FIELD[agency]}=${loc.by === "bin" ? loc.bin : loc.bbl}`;
  const srcs: SourceRef[] = [src(agency, grouped.fetchedAt), src(agency, dated.fetchedAt), src(agency, openRows.fetchedAt), ...srcsExtra];
  return {
    items,
    srcs,
    undatedOpen,
    counts,
    flagged,
    section:
      agency === "hpd" && total === 0
        ? { coverage: "no HPD coverage expected or none found", open: null, closed: null, most_recent_issue_date: null, note: HPD_COVERAGE_NOTE }
        : {
            open: counts.open,
            closed: counts.closed,
            ...(counts.unknown ? { unknown: counts.unknown } : {}),
            most_recent_issue_date: latest,
            open_undated_excluded_from_recent_list: undatedOpen,
            ...(total === 0 ? { note: "No records found in this dataset for this property; not proof of compliance." } : {}),
            ...(agency === "dob" ? { status_rule: 'open = "ACTIVE" in violation_category (heuristic)' } : {}),
            ...(flagged !== null && agency === "dob"
              ? { open_flagged_deleted: flagged, open_excluding_deleted: counts.open - flagged }
              : {}),
            ...(flagged !== null && agency === "ecb"
              ? { open_flagged_written_off: flagged, open_excluding_written_off: counts.open - flagged }
              : {}),
            source_link: link(),
          },
  };
}

export async function buildingComplianceSummary(r: Resolver, a: { address?: string; bin?: string; bbl?: string }) {
  const p = await resolveProperty(r, a);
  // One footprint for all three agencies: the resolved BIN.
  const binLoc: Locator = { by: "bin", bin: p.bin };
  const dob = await agencySummary(r, "dob", binLoc);
  const ecb = await agencySummary(r, "ecb", binLoc);
  const hpd = await agencySummary(r, "hpd", binLoc);
  const lot = await otherBinsOnLot(r, p.bbl);

  const recent = [...dob.items, ...ecb.items, ...hpd.items].sort(byDateDesc).slice(0, 5);
  const itemLink = (v: Violation) =>
    `${SOCRATA_BASE}/${DATASETS[v.agency].id}.json?${ID_FIELD[v.agency]}=${encodeURIComponent(v.id)}`;
  const dq: string[] = [
    'DOB open/closed is a heuristic: "open" means ACTIVE appears in violation_category. Raw open counts are kept; flagged subsets are counted separately, never reclassified.',
  ];
  if (dob.flagged) {
    dq.push(
      `${dob.flagged} of ${dob.counts.open} open DOB record(s) carry a "DELETED ..." disposition comment and are probably not outstanding (open_excluding_deleted = ${dob.counts.open - dob.flagged}). Verify in DOB's own system.`,
    );
  }
  if (ecb.flagged) {
    dq.push(
      `${ecb.flagged} of ${ecb.counts.open} open ECB record(s) have hearing status WRITTEN OFF (open_excluding_written_off = ${ecb.counts.open - ecb.flagged}).`,
    );
  }
  if (hpd.counts.open + hpd.counts.closed + hpd.counts.unknown === 0) {
    dq.push("No HPD records found for this BIN. HPD covers residential buildings only; this is NOT evidence of compliance.");
  }
  if (lot.count > 0) {
    dq.push(`This lot (BBL ${p.bbl}) holds about ${lot.count} other building(s) (other BINs); none of their records are included in these counts.`);
  }
  if (p.match?.note) dq.push(p.match.note);
  for (const [k, n] of [["DOB", dob.undatedOpen], ["ECB", ecb.undatedOpen], ["HPD", hpd.undatedOpen]] as const) {
    if (n > 0) dq.push(`${n} open ${k} record(s) have a missing or invalid issue date and are left out of most_recent_open_items.`);
  }
  return envelope([...p.sources, ...dob.srcs, ...ecb.srcs, ...hpd.srcs, ...lot.sources], {
    data_quality_notes: dq,
    property: { address: p.address, bin: p.bin, bbl: p.bbl, borough: p.borough },
    footprint: {
      counted: `Records matching BIN ${p.bin} only, in all three datasets (DOB, ECB, HPD).`,
      bin: p.bin,
      lot_bbl: p.bbl,
      other_bins_on_lot: lot.count,
      other_bins_note:
        "Approximate number of other buildings on the same lot seen in DOB/HPD records; their violations are NOT counted here.",
    },
    agencies: { DOB: dob.section, ECB: ecb.section, HPD: hpd.section },
    most_recent_open_items: recent.map((v) => ({
      line: oneLine(v),
      ...(v.caveat ? { caveat: cleanText(v.caveat, 200) } : {}),
      source_link: itemLink(v),
    })),
    ...(recent.length === 0 ? { open_items_note: "No open items found in the open data (not proof of compliance)." } : {}),
  }, ["most_recent_open_items[].line", "most_recent_open_items[].caveat"]);
}
