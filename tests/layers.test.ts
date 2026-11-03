import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { locatorClause } from "../src/socrata.js";
import { getHpdViolations } from "../src/tools/violations.js";
import { makeResolver, stubFetch } from "./helpers.js";

// Each guard below has a second layer behind it (defense in depth). These tests exercise each layer ALONE, so removing
// one of them fails a test even though the other would still catch the input (found by mutation testing in the final review).
describe("each validation layer is tested on its own", () => {
  it("HPD schema layer: the published input schema rejects {} before the handler runs (no request, SDK validation error)", async () => {
    const f = stubFetch([[]]);
    const server = createServer(makeResolver(f));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "t", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    const res = (await client.callTool({ name: "get_hpd_violations", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/Input validation error/); // produced by the schema refine, not by the handler
    expect(res.content[0]!.text).toMatch(/Provide bbl/);
    expect(f.calls).toHaveLength(0);
  });

  it("HPD handler layer: getHpdViolations called directly (schema bypassed) still refuses a call with neither bbl nor bin", async () => {
    const f = stubFetch([[]]);
    await expect(getHpdViolations(makeResolver(f), { limit: 5 })).rejects.toThrow(/Provide bbl/);
    expect(f.calls).toHaveLength(0);
  });

  it("query builder layer: malformed BBLs are refused by locatorClause for every dataset (schema bypassed)", () => {
    for (const bbl of ["123", "10083500411", "1008350041x", "0008350041", "6008350041", "1008350041'", "", "1008350041 OR 1=1"]) {
      for (const ds of ["dob", "ecb", "hpd"] as const) {
        expect(() => locatorClause(ds, { by: "bbl", bbl }), `${ds} ${JSON.stringify(bbl)}`).toThrow();
      }
    }
    // control: a valid BBL builds
    expect(locatorClause("hpd", { by: "bbl", bbl: "1008350041" })).toBe("bbl = '1008350041'");
    expect(locatorClause("dob", { by: "bbl", bbl: "1008350041" })).toBe("boro = '1' AND block = '00835' AND lot = '00041'");
  });
});
