/**
 * Records live HTTP responses (URL -> body) used by the offline tests.
 * Run: npm run build && node dist/scripts/record-fixtures.js   (also re-records the address cases: scripts/record-address-cases.ts)
 * Only public NYC data is recorded. No tokens are sent (SOCRATA_APP_TOKEN is ignored here).
 */
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Cache } from "../src/cache.js";
import { loadSettings } from "../src/config.js";
import { HttpClient } from "../src/http.js";
import { SocrataClient } from "../src/socrata.js";
import { otherBinsOnLot } from "../src/resolve.js";
import { resolvePropertyTool } from "../src/tools/resolve.js";
import { buildingComplianceSummary } from "../src/tools/summary.js";
import { getDobViolations, getEcbViolations, getHpdViolations } from "../src/tools/violations.js";
import { redact } from "./redact.js";

const dir = join(process.cwd(), "tests", "fixtures", "http");
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (f.endsWith(".json")) unlinkSync(join(dir, f)); // start clean: stale fixtures must not linger

export const fixtureName = (url: string) => createHash("sha1").update(url).digest("hex").slice(0, 16) + ".json";

const settings = { ...loadSettings({}), appToken: undefined };
const http = new HttpClient({
  cache: new Cache(":memory:", 60_000),
  settings,
  fetch: async (url, init) => {
    const res = await fetch(url, init);
    const body = redact(await res.text());
    writeFileSync(join(dir, fixtureName(url)), JSON.stringify({ url, status: res.status, body }, null, 1));
    console.error("recorded", res.status, url.slice(0, 110));
    return { ok: res.ok, status: res.status, text: async () => body };
  },
});
const r = { http, socrata: new SocrataClient(http) };
const attempt = async (label: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
  } catch (e) {
    console.error(label, "->", e instanceof Error ? e.message.slice(0, 100) : e);
  }
};

const ESB = { address: "350 5th Ave, Manhattan", bin: "1015862", bbl: "1008350041" };
await attempt("esb summary", () => buildingComplianceSummary(r, { address: ESB.address }));
await attempt("esb dob", () => getDobViolations(r, { bin: ESB.bin, status: "open", limit: 5 }));
await attempt("esb ecb", () => getEcbViolations(r, { bin: ESB.bin, limit: 5 }));
await attempt("esb hpd", () => getHpdViolations(r, { bbl: ESB.bbl, limit: 5 }));
await attempt("resolve bin", () => resolvePropertyTool(r, { bin: ESB.bin }));
await attempt("resolve bbl", () => resolvePropertyTool(r, { bbl: ESB.bbl }));
await attempt("mismatch", () => resolvePropertyTool(r, { bin: ESB.bin, bbl: "1008350042" }));
await attempt("mismatch chrysler lot", () => resolvePropertyTool(r, { bin: ESB.bin, bbl: "1012970023" }));
await attempt("matching pair", () => resolvePropertyTool(r, { bin: ESB.bin, bbl: ESB.bbl }));
// Wrong addresses: GeoSearch still returns a candidate (confidence 0.8), which the tool must refuse. Also valid variants.
for (const a of ["123 Fake Street, Queens", "Lot 1 Block 1, Manhattan", "9999 5th Ave, Manhattan", "350 FIFTH AVE", "2 St Marks Pl, Manhattan", "1 Centre St, Manhattan"]) {
  await attempt(`address ${a}`, () => resolvePropertyTool(r, { address: a }));
}
// Lot with one real building plus borough placeholder BIN 2000000 (120 HPD rows): the placeholder must not count as a building
await attempt("lot with placeholder bin", () => otherBinsOnLot(r, "2048530011"));
await attempt("no match", () => resolvePropertyTool(r, { address: "zzzz nowhere qq" }));
await attempt("injection address", () => resolvePropertyTool(r, { address: "1 Main St'; DROP TABLE x; -- $where=1=1" }));
// Multi-building lot (Stuyvesant Town: ~35 BINs on one lot)
await attempt("stuy summary", () => buildingComplianceSummary(r, { address: "1 Stuyvesant Oval, Manhattan" }));
await attempt("stuy summary by bin", () => buildingComplianceSummary(r, { bin: "1082881" }));
await attempt("stuy summary by bbl", () => buildingComplianceSummary(r, { bbl: "1009720001" }));
await attempt("stuy hpd by bin", () => getHpdViolations(r, { bin: "1082881", limit: 5 }));
// HPD building with a mix of dated and undated (no NOV date) open rows
await attempt("hpd mixed dates", () => getHpdViolations(r, { bin: "2096753", status: "open", limit: 5 }));
// DOB building with a junk issue_date ("Y30819") that sorts above real dates as text
await attempt("dob junk date", () => getDobViolations(r, { bin: "1085463", limit: 5 }));
await attempt("dob junk date summary", () => buildingComplianceSummary(r, { bin: "1085463" }));
// ECB building with WRITTEN OFF active records (Grand Central Terminal)
await attempt("gct summary", () => buildingComplianceSummary(r, { bin: "1035381" }));
await attempt("gct ecb open", () => getEcbViolations(r, { bin: "1035381", status: "open", limit: 3 }));
// Residential building with HPD coverage
await attempt("res summary", () => buildingComplianceSummary(r, { bin: "2099579" }));
await attempt("res hpd", () => getHpdViolations(r, { bbl: "2046540021", status: "closed", limit: 3 }));
await attempt("res hpd by bin", () => getHpdViolations(r, { bin: "2099579", limit: 3 }));
// The adversarial address cases (GeoSearch responses + expected outcomes); this run deleted their fixtures above.
await import("./record-address-cases.js");
