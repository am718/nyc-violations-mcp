/**
 * The ONE place where each dataset's raw status vocabulary is mapped to open/closed/unknown.
 * Verified values (2026-11-01, see docs/DATA.md):
 *  - DOB  (violation_category): free text; open = contains "ACTIVE" (heuristic), e.g.
 *         "V-DOB VIOLATION - ACTIVE"; closed = "…Resolved" / "…DISMISSED" variants.
 *  - ECB  (ecb_violation_status): ACTIVE | RESOLVE | Unknown
 *  - HPD  (violationstatus): Open | Close
 */
import type { DatasetKey } from "./config.js";

export type Status = "open" | "closed" | "unknown";

export function dobStatus(category: unknown): Status {
  if (typeof category !== "string" || category.trim() === "") return "unknown";
  const c = category.toUpperCase();
  if (c.includes("ACTIVE")) return "open";
  if (c.includes("RESOLVED") || c.includes("DISMISSED")) return "closed";
  return "unknown";
}

export function ecbStatus(status: unknown): Status {
  if (typeof status !== "string") return "unknown";
  switch (status.trim().toUpperCase()) {
    case "ACTIVE":
      return "open";
    case "RESOLVE":
      return "closed";
    default:
      return "unknown";
  }
}

export function hpdStatus(status: unknown): Status {
  if (typeof status !== "string") return "unknown";
  switch (status.trim().toLowerCase()) {
    case "open":
      return "open";
    case "close":
      return "closed";
    default:
      return "unknown";
  }
}

/** Raw status column per dataset (used for counts and filters). */
export const STATUS_FIELD: Record<DatasetKey, string> = {
  dob: "violation_category",
  ecb: "ecb_violation_status",
  hpd: "violationstatus",
};

export const STATUS_MAPPER: Record<DatasetKey, (raw: unknown) => Status> = {
  dob: dobStatus,
  ecb: ecbStatus,
  hpd: hpdStatus,
};

/** Fixed SoQL fragments (no user input) selecting open / closed rows per dataset. */
export const STATUS_CLAUSE: Record<DatasetKey, Record<"open" | "closed", string>> = {
  dob: {
    open: "upper(violation_category) like '%ACTIVE%'",
    closed: "(upper(violation_category) like '%RESOLVED%' OR upper(violation_category) like '%DISMISSED%')",
  },
  ecb: { open: "ecb_violation_status = 'ACTIVE'", closed: "ecb_violation_status = 'RESOLVE'" },
  hpd: { open: "violationstatus = 'Open'", closed: "violationstatus = 'Close'" },
};

/**
 * Annotations that suggest an "open" record is not genuinely outstanding. Verified live 2026-11-01:
 *  - DOB: 31,834 of 573,684 ACTIVE rows have disposition_comments like "DELETED BY <initials> ON <date> BECAUSE ...".
 *  - ECB: ACTIVE rows with hearing_status "WRITTEN OFF" (59,165 citywide).
 * These are reported as a SECOND count; records are never silently reclassified.
 */
export const FLAG_CLAUSE = {
  dob: "upper(disposition_comments) like '%DELETED%'",
  ecb: "hearing_status = 'WRITTEN OFF'",
} as const;

export type Flag = "annotated_deleted" | "written_off";
