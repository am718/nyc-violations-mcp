import { LIMITS } from "./config.js";
import type { DatasetKey } from "./config.js";
import { STATUS_MAPPER, type Flag, type Status } from "./status.js";

/**
 * Normalize a date to ISO "YYYY-MM-DD" (or null). The ONE place dates are parsed.
 * DOB/ECB use "YYYYMMDD" text; HPD uses ISO timestamps like "2026-10-31T00:00:00.000".
 * Anything else (e.g. the junk value "7" seen in DOB data) becomes null.
 */
export function normalizeDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  let y: number, m: number, d: number;
  let match = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!match) match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s);
  if (!match) return null;
  y = +match[1]!;
  m = +match[2]!;
  d = +match[3]!;
  if (y < 1800 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Newest first; null dates last. */
export function byDateDesc<T extends { issue_date: string | null }>(a: T, b: T): number {
  if (a.issue_date === b.issue_date) return 0;
  if (a.issue_date === null) return 1;
  if (b.issue_date === null) return -1;
  return a.issue_date < b.issue_date ? 1 : -1;
}

/** Coerce to a short, single-line plain string. Text from the data is untrusted and only ever returned as data. */
export function cleanText(v: unknown, max: number = LIMITS.maxTextChars): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string" && typeof v !== "number") return null;
  // eslint-disable-next-line no-control-regex
  const s = String(v).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export interface Violation {
  agency: DatasetKey;
  id: string;
  issue_date: string | null;
  status: Status;
  status_raw: string | null;
  type: string | null;
  description: string | null;
  details: Record<string, string | null>;
  caveat?: string;
  flag?: Flag;
}

type Row = Record<string, unknown>;

export function isRow(v: unknown): v is Row {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Map one raw row to a concise Violation, or null if the row is unusable (no identifier). */
export function mapRow(agency: DatasetKey, row: unknown): Violation | null {
  if (!isRow(row)) return null;
  if (agency === "dob") {
    const id = cleanText(row.isn_dob_bis_viol, 40);
    if (!id) return null;
    const status = STATUS_MAPPER.dob(row.violation_category);
    const v: Violation = {
      agency,
      id,
      issue_date: normalizeDate(row.issue_date),
      status,
      status_raw: cleanText(row.violation_category, 80),
      type: cleanText(row.violation_type, 80),
      description: cleanText(row.description),
      details: {
        violation_number: cleanText(row.violation_number, 40),
        ecb_number: cleanText(row.ecb_number, 40),
        disposition_date: normalizeDate(row.disposition_date),
        disposition_comments: cleanText(row.disposition_comments, 160),
      },
    };
    const comments = cleanText(row.disposition_comments, 160);
    if (status === "open" && /DELETED/i.test(comments ?? "")) {
      v.flag = "annotated_deleted";
      v.caveat = "Category says ACTIVE but the disposition comment says the record was DELETED; it is probably not outstanding. Counted as open by the heuristic.";
    } else if (status === "open" && (cleanText(row.disposition_date, 40) !== null || comments !== null)) {
      v.caveat =
        "Category says ACTIVE but a disposition date/comment is present; this record may not be genuinely open. Open/closed is a heuristic.";
    }
    return v;
  }
  if (agency === "ecb") {
    const id = cleanText(row.ecb_violation_number, 40);
    if (!id) return null;
    const ecbStatus = STATUS_MAPPER.ecb(row.ecb_violation_status);
    const writtenOff = ecbStatus === "open" && String(row.hearing_status ?? "").trim().toUpperCase() === "WRITTEN OFF";
    return {
      agency,
      id,
      issue_date: normalizeDate(row.issue_date),
      status: ecbStatus,
      ...(writtenOff
        ? { flag: "written_off" as const, caveat: "ECB status is ACTIVE but the hearing status is WRITTEN OFF; the penalty was written off. Counted as open by the status field." }
        : {}),
      status_raw: cleanText(row.ecb_violation_status, 40),
      type: cleanText(row.violation_type, 80),
      description: cleanText(row.violation_description),
      details: {
        severity: cleanText(row.severity, 40),
        hearing_status: cleanText(row.hearing_status, 40),
        hearing_date: normalizeDate(row.hearing_date),
        penalty_imposed: cleanText(row.penality_imposed, 20),
        amount_paid: cleanText(row.amount_paid, 20),
        balance_due: cleanText(row.balance_due, 20),
        dob_violation_number: cleanText(row.dob_violation_number, 40),
      },
    };
  }
  const id = cleanText(row.violationid, 40);
  if (!id) return null;
  return {
    agency,
    id,
    issue_date: normalizeDate(row.novissueddate), // NOV issue date; undated rows are excluded from recency lists upstream
    status: STATUS_MAPPER.hpd(row.violationstatus),
    status_raw: cleanText(row.violationstatus, 40),
    type: cleanText(row.class ? `Class ${String(row.class).slice(0, 2)}` : null, 20),
    description: cleanText(row.novdescription),
    details: {
      current_status: cleanText(row.currentstatus, 80),
      inspection_date: normalizeDate(row.inspectiondate),
      apartment: cleanText(row.apartment, 20),
      story: cleanText(row.story, 20),
      rent_impairing: cleanText(row.rentimpairing, 5),
    },
  };
}

export function mapRows(agency: DatasetKey, rows: unknown[]): { items: Violation[]; skipped: number } {
  const items: Violation[] = [];
  let skipped = 0;
  for (const r of rows) {
    const v = mapRow(agency, r);
    if (v) items.push(v);
    else skipped++;
  }
  return { items, skipped };
}
