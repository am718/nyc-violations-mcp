import { DATASETS, SOCRATA_BASE, type DatasetKey } from "./config.js";
import { ToolError } from "./errors.js";
import type { HttpClient } from "./http.js";
import { splitBbl } from "./ids.js";
import { STATUS_CLAUSE, STATUS_FIELD } from "./status.js";

/**
 * Query-safety design: NO user text is ever placed into a SoQL string.
 *  - Dataset ids and column names come from fixed constants.
 *  - The only user-derived values are BIN / BBL parts, which `digits()` forces to be pure digits
 *    before they are quoted. Anything else throws, so a crafted value cannot alter the query.
 *  - Free-text addresses go only to GeoSearch as a URL-encoded parameter, never to Socrata.
 */
export function digits(value: string, pattern: RegExp = /^\d{1,10}$/): string {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new ToolError("Internal safety check: refusing to build a query from a non-numeric identifier.");
  }
  return `'${value}'`;
}

export interface SoqlQuery {
  dataset: DatasetKey;
  select?: string;
  where?: string;
  group?: string;
  order?: string;
  limit: number;
}

export function buildUrl(q: SoqlQuery): string {
  const p = new URLSearchParams();
  if (q.select) p.set("$select", q.select);
  if (q.where) p.set("$where", q.where);
  if (q.group) p.set("$group", q.group);
  if (q.order) p.set("$order", q.order);
  p.set("$limit", String(Math.min(Math.max(Math.trunc(q.limit), 1), 1000)));
  return `${SOCRATA_BASE}/${DATASETS[q.dataset].id}.json?${p.toString()}`;
}

export type Locator = { by: "bin"; bin: string } | { by: "bbl"; bbl: string };

const BIN_RE = /^[1-5]\d{6}$/;
const BBL_RE = /^[1-5]\d{9}$/;

/** WHERE clause locating a property inside a dataset. DOB/ECB have no bbl column: use boro+block+lot. */
export function locatorClause(dataset: DatasetKey, loc: Locator): string {
  if (loc.by === "bin") return `bin = ${digits(loc.bin, BIN_RE)}`;
  digits(loc.bbl, BBL_RE);
  if (dataset === "hpd") return `bbl = ${digits(loc.bbl, BBL_RE)}`;
  const { boro, block, lot } = splitBbl(loc.bbl);
  // DOB/ECB lot is a 5-digit zero-padded text column (verified live), unlike the 4-digit lot in a BBL.
  return `boro = ${digits(boro)} AND block = ${digits(block)} AND lot = ${digits(`0${lot}`)}`;
}

function and(...parts: (string | undefined)[]): string {
  return parts.filter(Boolean).join(" AND ");
}

const DATE_FIELD: Record<DatasetKey, string> = { dob: "issue_date", ecb: "issue_date", hpd: "novissueddate" };

export const queries = {
  list(dataset: DatasetKey, loc: Locator, status: "open" | "closed" | undefined, limit: number): SoqlQuery {
    return {
      dataset,
      where: and(locatorClause(dataset, loc), status ? STATUS_CLAUSE[dataset][status] : undefined),
      order: `${DATE_FIELD[dataset]} DESC`,
      limit,
    };
  },
  count(dataset: DatasetKey, loc: Locator, status?: "open" | "closed"): SoqlQuery {
    return {
      dataset,
      select: "count(*) as n",
      where: and(locatorClause(dataset, loc), status ? STATUS_CLAUSE[dataset][status] : undefined),
      limit: 1,
    };
  },
  statusCounts(dataset: DatasetKey, loc: Locator): SoqlQuery {
    const f = STATUS_FIELD[dataset];
    return {
      dataset,
      select: `${f}, count(*) as n, max(${DATE_FIELD[dataset]}) as latest`,
      where: locatorClause(dataset, loc),
      group: f,
      limit: 50,
    };
  },
  /** DOB rows classed open (ACTIVE) that nevertheless carry a disposition date/comment. */
  dobOpenWithNotes(loc: Locator): SoqlQuery {
    return {
      dataset: "dob",
      select: "count(*) as n",
      where: and(locatorClause("dob", loc), STATUS_CLAUSE.dob.open, "(disposition_date IS NOT NULL OR disposition_comments IS NOT NULL)"),
      limit: 1,
    };
  },
  /** Distinct BINs on a lot, per dataset (used to report other buildings on the same lot). */
  distinctBinsOnLot(dataset: "dob" | "hpd", bbl: string): SoqlQuery {
    return { dataset, select: "count(distinct bin) as n", where: locatorClause(dataset, { by: "bbl", bbl }), limit: 1 };
  },
  /** BIN -> lot (DOB rows carry boro/block/lot and address). */
  dobLotForBin(bin: string): SoqlQuery {
    return {
      dataset: "dob",
      select: "boro, block, lot, house_number, street, count(*) as n",
      where: `bin = ${digits(bin, BIN_RE)}`,
      group: "boro, block, lot, house_number, street",
      order: "n DESC",
      limit: 3,
    };
  },
  hpdForBin(bin: string): SoqlQuery {
    return {
      dataset: "hpd",
      select: "bbl, bin, housenumber, streetname, count(*) as n",
      where: `bin = ${digits(bin, BIN_RE)}`,
      group: "bbl, bin, housenumber, streetname",
      order: "n DESC",
      limit: 3,
    };
  },
  /** BBL -> BINs on the lot (a lot can hold several buildings). */
  dobBinsForBbl(bbl: string): SoqlQuery {
    return {
      dataset: "dob",
      select: "bin, house_number, street, count(*) as n",
      where: locatorClause("dob", { by: "bbl", bbl }),
      group: "bin, house_number, street",
      order: "n DESC",
      limit: 10,
    };
  },
  hpdBinsForBbl(bbl: string): SoqlQuery {
    return {
      dataset: "hpd",
      select: "bin, housenumber, streetname, count(*) as n",
      where: locatorClause("hpd", { by: "bbl", bbl }),
      group: "bin, housenumber, streetname",
      order: "n DESC",
      limit: 10,
    };
  },
};

export interface RowsResult {
  rows: unknown[];
  fetchedAt: string;
  url: string;
}

export class SocrataClient {
  constructor(private http: HttpClient) {}

  async query(q: SoqlQuery): Promise<RowsResult> {
    const url = buildUrl(q);
    const { json, fetchedAt } = await this.http.getJson(url);
    if (!Array.isArray(json)) {
      const msg =
        typeof json === "object" && json !== null && typeof (json as Record<string, unknown>).message === "string"
          ? " (the service reported an error)"
          : "";
      throw new ToolError(
        `NYC Open Data returned an unexpected response shape${msg}. The dataset may have changed; retry later or see docs/DATA.md.`,
      );
    }
    return { rows: json, fetchedAt, url };
  }

  /** Run a count(*) query and return a non-negative integer, tolerating malformed output. */
  async count(q: SoqlQuery): Promise<{ n: number; fetchedAt: string; url: string }> {
    const r = await this.query(q);
    const first = r.rows[0] as Record<string, unknown> | undefined;
    const n = Number(first?.n);
    return { n: Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0, fetchedAt: r.fetchedAt, url: r.url };
  }
}
