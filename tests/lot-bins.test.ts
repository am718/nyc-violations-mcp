import { describe, expect, it } from "vitest";
import { resolvePropertyTool } from "../src/tools/resolve.js";
import { fixtureFetch, makeResolver, stubFetch } from "./helpers.js";

// resolvePropertyTool returns the response envelope; the property fields sit next to the notice/sources keys.
const parse = async (p: Promise<unknown>) => (await p) as Record<string, unknown>;
const field = (o: Record<string, unknown>, k: string) => o[k];

describe("resolve_property with a bbl: a partial list of other BINs says so", () => {
  it("Stuyvesant Town (recorded live): lists some other BINs, reports the total and that the list is truncated", async () => {
    const out = await parse(resolvePropertyTool(makeResolver(fixtureFetch()), { bbl: "1009720001" }));
    const listed = field(out, "other_bins_on_lot") as string[];
    expect(listed.length).toBeGreaterThan(0);
    expect(field(out, "other_bins_total")).toBe(34); // 35 BINs on the lot on 2026-11-02, minus the primary
    expect(listed.length).toBeLessThan(34);
    expect(field(out, "other_bins_truncated")).toBe(true);
  });

  it("a single-building lot (recorded live) has no list and no truncation fields", async () => {
    const out = await parse(resolvePropertyTool(makeResolver(fixtureFetch()), { bbl: "1008350041" }));
    expect(field(out, "other_bins_on_lot")).toBeUndefined();
    expect(field(out, "other_bins_total")).toBeUndefined();
    expect(field(out, "other_bins_truncated")).toBeUndefined();
  });

  it("a short, complete list (synthetic) is not flagged and costs no extra requests", async () => {
    const rows = [
      { bin: "1000001", house_number: "1", street: "A ST", n: "9" },
      { bin: "1000002", house_number: "2", street: "A ST", n: "3" },
    ];
    const f = stubFetch([rows]);
    const out = await parse(resolvePropertyTool(makeResolver(f), { bbl: "1000010001" }));
    expect(field(out, "other_bins_on_lot")).toEqual(["1000002"]);
    expect(field(out, "other_bins_truncated")).toBeUndefined();
    expect(f.calls).toHaveLength(1);
  });

  it("a full page (10 groups) that is really all the lot's buildings is not flagged as truncated (synthetic)", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ bin: i < 5 ? "1000001" : "1000002", house_number: String(i), street: "A ST", n: "1" }));
    // total distinct real BINs = 2 in both datasets -> 1 other, and it is already listed
    const out = await parse(resolvePropertyTool(makeResolver(stubFetch([rows, [{ n: "2" }], [{ n: "2" }]])), { bbl: "1000010001" }));
    expect(field(out, "other_bins_on_lot")).toEqual(["1000002"]);
    expect(field(out, "other_bins_truncated")).toBeUndefined();
  });
});
