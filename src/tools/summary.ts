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
  return `${v.issue_date ?? "date unknown"} · ${LABEL[v.agency]} ${v.id} · ${what.length > 110 ? `${what.slice(0, 109)}…` : what}`;
}

async function agencySummary(r: Resolver, agency: DatasetKey, loc: Locator) {
  const [grouped, openRows] = await Promise.all([
    r.socrata.query(queries.statusCounts(agency, loc)),
    r.socrata.query(queries.list(agency, loc, "open", 5)),
  ]);
  const counts = { open: 0, closed: 0, unknown: 0 };
  const srcsExtra: SourceRef[] = [];
  let latest: string | null = null;
  for (const row of grouped.rows) {
    if (!isRow(row)) continue;
    const n = Number(row.n);
    if (!Number.isFinite(n) || n < 0) continue;
    const field = Object.keys(row).find((k) => k !== "n" && k !== "latest");
    counts[STATUS_MAPPER[agency](field ? row[field] : undefined)] += Math.trunc(n);
    const d = normalizeDate(row.latest);
    if (d && (!latest || d > latest)) latest = d;
  }
  const total = counts.open + counts.closed + counts.unknown;
  let openWithNotes: number | null = null;
  if (agency === "dob" && counts.open > 0) {
    const c = await r.socrata.count(queries.dobOpenWithNotes(loc));
    openWithNotes = c.n;
    srcsExtra.push(src("dob", c.fetchedAt));
  }
  const { items } = mapRows(agency, openRows.rows);
  const link = (extra = "") => `${SOCRATA_BASE}/${DATASETS[agency].id}.json?${LOC_FIELD[agency]}=${loc.by === "bin" ? loc.bin : loc.bbl}${extra}`;
  const srcs: SourceRef[] = [src(agency, grouped.fetchedAt), src(agency, openRows.fetchedAt), ...srcsExtra];
  return {
    items,
    srcs,
    section:
      agency === "hpd" && total === 0
        ? { coverage: "no HPD coverage expected or none found", open: null, closed: null, most_recent_issue_date: null, note: HPD_COVERAGE_NOTE }
        : {
            open: counts.open,
            closed: counts.closed,
            ...(counts.unknown ? { unknown: counts.unknown } : {}),
            most_recent_issue_date: latest,
            ...(total === 0 ? { note: "No records found in this dataset for this property; not proof of compliance." } : {}),
            ...(agency === "dob" ? { status_rule: 'open = "ACTIVE" in violation_category (heuristic)' } : {}),
            ...(openWithNotes
              ? {
                  open_with_disposition_notes: openWithNotes,
                  open_caveat: `${openWithNotes} of the ${counts.open} "open" DOB records carry a disposition date/comment (often "DELETED … BECAUSE DUPLICATE/WRONG ADDRESS") and may not be genuinely open; check the source records.`,
                }
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
  const notes = [
    ...(lot.count > 0
      ? [`This lot (BBL ${p.bbl}) holds about ${lot.count} other building(s) (other BINs); none of their records are included in these counts.`]
      : []),
    ...(p.match?.note ? [p.match.note] : []),
  ];
  return envelope([...p.sources, ...dob.srcs, ...ecb.srcs, ...hpd.srcs, ...lot.sources], {
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
    ...(notes.length ? { notes } : {}),
  });
}
