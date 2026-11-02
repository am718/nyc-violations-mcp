import { describe, expect, it } from "vitest";
import { byDateDesc, cleanText, mapRow, normalizeDate } from "../src/normalize.js";
import { dobStatus, ecbStatus, hpdStatus, STATUS_CLAUSE } from "../src/status.js";
import { loadFixture } from "./helpers.js";

describe("per-dataset status mapping (single source of truth)", () => {
  it("DOB: ACTIVE in violation_category = open (heuristic)", () => {
    expect(dobStatus("V-DOB VIOLATION - ACTIVE")).toBe("open");
    expect(dobStatus("VW-VIOLATION WORK WITHOUT PERMIT - ACTIVE")).toBe("open");
    expect(dobStatus("VP-VIOLATION UNSERVED ECB-ACTIVE")).toBe("open");
    expect(dobStatus("V*-DOB VIOLATION - Resolved")).toBe("closed");
    expect(dobStatus("V*-DOB VIOLATION - DISMISSED")).toBe("closed");
    expect(dobStatus("something new")).toBe("unknown");
    expect(dobStatus(null)).toBe("unknown");
  });
  it("ECB: ACTIVE/RESOLVE", () => {
    expect(ecbStatus("ACTIVE")).toBe("open");
    expect(ecbStatus("RESOLVE")).toBe("closed");
    expect(ecbStatus("Unknown")).toBe("unknown");
    expect(ecbStatus(undefined)).toBe("unknown");
  });
  it("HPD: Open/Close", () => {
    expect(hpdStatus("Open")).toBe("open");
    expect(hpdStatus("Close")).toBe("closed");
    expect(hpdStatus("")).toBe("unknown");
  });
  it("filter clauses are fixed strings", () => {
    expect(STATUS_CLAUSE.hpd.open).toBe("violationstatus = 'Open'");
    expect(STATUS_CLAUSE.ecb.closed).toBe("ecb_violation_status = 'RESOLVE'");
  });
});

describe("the 13 real ACTIVE DOB rows that carry a disposition (recorded fixture)", () => {
  const rows = loadFixture("dob_active_with_disposition.json") as Record<string, unknown>[];
  it("has 13 rows", () => expect(rows).toHaveLength(13));
  it("are all classified open by the rule (not silently reclassified); 10 'DELETED' ones are flagged, the other 3 carry a generic caveat", () => {
    const items = rows.map((r) => mapRow("dob", r)!);
    for (const v of items) {
      expect(v.status).toBe("open");
      expect(v.caveat).toBeTruthy();
    }
    const deleted = items.filter((v) => v.flag === "annotated_deleted");
    expect(deleted).toHaveLength(10);
    for (const v of deleted) expect(v.caveat).toMatch(/DELETED/);
    const others = items.filter((v) => v.flag === undefined);
    expect(others).toHaveLength(3); // 2 x PAID INVOICE + 1 with junk disposition_date "7"
    for (const v of others) expect(v.caveat).toMatch(/may not be genuinely open/);
  });
  it("the row with junk disposition_date '7' yields a null date, not a crash", () => {
    const junk = rows.find((r) => r.disposition_date === "7")!;
    expect(mapRow("dob", junk)!.details.disposition_date).toBeNull();
  });
});

describe("date normalization (one place)", () => {
  it("handles DOB/ECB YYYYMMDD and HPD ISO timestamps", () => {
    expect(normalizeDate("19880802")).toBe("1988-08-02");
    expect(normalizeDate("2026-10-31T00:00:00.000")).toBe("2026-10-31");
  });
  it("rejects junk and impossible dates", () => {
    for (const bad of ["7", "", "20231345", "00000000", "20230230", null, 5, "abc"]) expect(normalizeDate(bad as unknown)).toBeNull();
  });
  it("sorts mixed-format records by normalized date, nulls last", () => {
    const items = [
      { issue_date: normalizeDate("20100101") },
      { issue_date: normalizeDate("2012-05-05T00:00:00.000") },
      { issue_date: normalizeDate("junk") },
      { issue_date: normalizeDate("19991231") },
    ];
    expect(items.sort(byDateDesc).map((i) => i.issue_date)).toEqual(["2012-05-05", "2010-01-01", "1999-12-31", null]);
  });
});

describe("untrusted text handling", () => {
  it("strips control characters, collapses whitespace, truncates", () => {
    expect(cleanText("a\u0000b\n\n  c\u001b[31m")).toBe("a b c [31m");
    expect(cleanText("x".repeat(500), 50)!.length).toBe(50);
    expect(cleanText({ evil: true })).toBeNull();
  });
});
