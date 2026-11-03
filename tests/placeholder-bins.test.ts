import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { isPlaceholderBbl, isPlaceholderBin, isRealBin, joinBbl } from "../src/ids.js";
import { createServer } from "../src/server.js";
import { locatorClause } from "../src/socrata.js";
import { resolvePropertyTool } from "../src/tools/resolve.js";
import { otherBinsOnLot } from "../src/resolve.js";
import { fixtureFetch, makeResolver, stubFetch } from "./helpers.js";

const PLACEHOLDERS = ["1000000", "2000000", "3000000", "4000000", "5000000"];

async function connect(fetchImpl = stubFetch([[]])) {
  const server = createServer(makeResolver(fetchImpl));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, fetchImpl };
}
const text = (res: unknown) => JSON.stringify((res as { content: unknown }).content);

describe("fix 1: borough placeholder BINs (X000000) are rejected everywhere", () => {
  it("helpers classify placeholders vs real BINs", () => {
    for (const b of PLACEHOLDERS) {
      expect(isPlaceholderBin(b)).toBe(true);
      expect(isRealBin(b)).toBe(false);
    }
    for (const b of ["1015862", "1000001", "1100000", "5099999"]) expect(isRealBin(b)).toBe(true);
    expect(isRealBin(1000001 as unknown)).toBe(false); // must be a string
  });

  const CASES: [string, (bin: string) => Record<string, unknown>][] = [
    ["resolve_property", (bin) => ({ bin })],
    ["get_dob_violations", (bin) => ({ bin })],
    ["get_ecb_violations", (bin) => ({ bin })],
    ["get_hpd_violations", (bin) => ({ bin })],
    ["get_hpd_violations", (bin) => ({ bin, bbl: "1008350041" })],
    ["building_compliance_summary", (bin) => ({ bin })],
    ["building_compliance_summary", (bin) => ({ bin, bbl: "1008350041" })],
  ];
  for (const [tool, mk] of CASES) {
    it(`${tool}${mk("X").bbl ? " (bin+bbl)" : ""} rejects every placeholder BIN with an actionable message and sends no request`, async () => {
      const { client, fetchImpl } = await connect();
      for (const bin of PLACEHOLDERS) {
        const res = await client.callTool({ name: tool, arguments: mk(bin) }).catch((e: Error) => ({ isError: true, content: [{ type: "text", text: e.message }] }));
        expect(res.isError).toBe(true);
        const t = text(res);
        expect(t).toMatch(/borough-level placeholder/);
        expect(t).toMatch(/resolve_property/);
        expect(t).toMatch(/street address/);
      }
      expect(fetchImpl.calls).toHaveLength(0);
    });
  }

  it("numeric placeholder (1000000 as a JSON number) is rejected too", async () => {
    const { client, fetchImpl } = await connect();
    const res = await client.callTool({ name: "get_dob_violations", arguments: { bin: 1000000 } });
    expect(res.isError).toBe(true);
    expect(fetchImpl.calls).toHaveLength(0);
  });

  it("the query builder refuses a placeholder BIN even if validation were bypassed", () => {
    for (const bin of PLACEHOLDERS) {
      expect(() => locatorClause("dob", { by: "bin", bin })).toThrow(/placeholder/);
      expect(() => locatorClause("hpd", { by: "bin", bin })).toThrow(/placeholder/);
    }
    expect(locatorClause("dob", { by: "bin", bin: "1000001" })).toBe("bin = '1000001'");
  });

  it("GeoSearch result with a placeholder BIN is refused with a clear message (synthetic response)", async () => {
    const geo = { features: [{ properties: { label: "1 EXAMPLE STREET, New York, NY", housenumber: "1", street: "EXAMPLE STREET", borough: "Manhattan", confidence: 1, match_type: "exact", addendum: { pad: { bin: "1000000", bbl: "1017450016" } } } }] };
    await expect(resolvePropertyTool(makeResolver(stubFetch([geo])), { address: "1 Example St, Manhattan" })).rejects.toThrow(/borough-level placeholder/);
  });

  it("a BBL whose only records carry a placeholder BIN is not resolved to a building (synthetic response)", async () => {
    const rows = [{ bin: "1000000", house_number: "1", street: "EXAMPLE ST", n: "5" }];
    await expect(resolvePropertyTool(makeResolver(stubFetch([rows])), { bbl: "1017450016" })).rejects.toThrow(/placeholder BIN/);
  });

  it("a BBL with a placeholder AND a real BIN resolves to the real one and never lists the placeholder", async () => {
    const rows = [
      { bin: "1000000", house_number: "1", street: "A ST", n: "50" },
      { bin: "1015862", house_number: "350", street: "5 AVENUE", n: "5" },
    ];
    const out = await resolvePropertyTool(makeResolver(stubFetch([rows])), { bbl: "1008350041" });
    expect(out.bin).toBe("1015862");
    expect(out.other_bins_on_lot).toBeUndefined();
  });
});

const PLACEHOLDER_BBLS = ["1000000000", "1008350000", "1999990001", "2000000000", "5-0-0", "3-00000-0001", "4-99999-0001"];

describe("fix 1 (BBL): placeholder BBLs (block 00000/99999 or lot 0000) are rejected the same way", () => {
  it("classifies placeholder vs real BBLs", () => {
    for (const b of ["1000000000", "1008350000", "1999990001", "5000000000"]) expect(isPlaceholderBbl(b)).toBe(true);
    for (const b of ["1008350041", "1000010001", "5099990001"]) expect(isPlaceholderBbl(b)).toBe(false);
    expect(joinBbl("1", "00000", "00000")).toBeNull(); // DOB rows with unknown block/lot
    expect(joinBbl("1", "00835", "00041")).toBe("1008350041");
  });
  for (const [tool, mk] of [
    ["resolve_property", (bbl: string) => ({ bbl })],
    ["get_hpd_violations", (bbl: string) => ({ bbl })],
    ["get_hpd_violations", (bbl: string) => ({ bbl, bin: "1015862" })],
    ["building_compliance_summary", (bbl: string) => ({ bbl })],
  ] as [string, (b: string) => Record<string, unknown>][]) {
    it(`${tool}${mk("X").bin ? " (bin+bbl)" : ""} rejects placeholder BBLs with an actionable message and sends no request`, async () => {
      const { client, fetchImpl } = await connect();
      for (const bbl of PLACEHOLDER_BBLS) {
        const res = await client.callTool({ name: tool, arguments: mk(bbl) }).catch((e: Error) => ({ isError: true, content: [{ type: "text", text: e.message }] }));
        expect(res.isError).toBe(true);
        const t = text(res);
        expect(t).toMatch(/placeholder/);
        expect(t).toMatch(/resolve_property/);
      }
      expect(fetchImpl.calls).toHaveLength(0);
    });
  }
  it("the query builder refuses a placeholder BBL even if validation were bypassed", () => {
    for (const bbl of ["1000000000", "1008350000", "1999990001"]) {
      expect(() => locatorClause("dob", { by: "bbl", bbl })).toThrow(/placeholder BBL/);
      expect(() => locatorClause("hpd", { by: "bbl", bbl })).toThrow(/placeholder BBL/);
    }
  });
  it("a real BIN whose DOB records only have unknown block/lot cannot produce a BBL; the error says what still works (synthetic)", async () => {
    const dob = [{ boro: "1", block: "00000", lot: "00000", house_number: "1", street: "X ST", n: "3" }];
    await expect(resolvePropertyTool(makeResolver(stubFetch([dob, []])), { bin: "1015862" })).rejects.toThrow(/unknown block\/lot/);
  });
  it("GeoSearch result with a placeholder BBL but a real BIN is refused as 'not a specific building' (synthetic)", async () => {
    const geo = { features: [{ properties: { label: "1 EXAMPLE STREET, New York, NY", housenumber: "1", street: "EXAMPLE STREET", borough: "Manhattan", confidence: 1, match_type: "exact", addendum: { pad: { bin: "1015862", bbl: "1000000000" } } } }] };
    await expect(resolvePropertyTool(makeResolver(stubFetch([geo])), { address: "1 Example St, Manhattan" })).rejects.toThrow(/not a specific building/);
  });
});

describe("other_bins_on_lot does not count borough placeholder BINs as buildings", () => {
  // Recorded live 2026-11-02: lot 2048530011 has HPD rows for the real BIN 2130638 (13) and for placeholder BIN 2000000 (120); no DOB rows.
  it("BIN 2130638 / lot 2048530011 has 0 other buildings (recorded)", async () => {
    const calls: string[] = [];
    const out = await otherBinsOnLot(makeResolver(fixtureFetch(calls)), "2048530011");
    expect(out.count).toBe(0);
    expect(calls).toHaveLength(2);
    for (const u of calls) expect(decodeURIComponent(u.replace(/\+/g, " "))).toContain("bin NOT LIKE '_000000'");
  });
  it("the count query keeps a real second building (synthetic count of 2 distinct real BINs -> 1 other)", async () => {
    const out = await otherBinsOnLot(makeResolver(stubFetch([[{ n: "2" }], [{ n: "1" }]])), "1009720001");
    expect(out.count).toBe(1);
  });
});
