/**
 * Records live HTTP responses (URL -> body) used by the offline tests.
 * Run: npm run build && node dist/scripts/record-fixtures.js
 * Only public NYC data is recorded. No tokens are sent (SOCRATA_APP_TOKEN is ignored here).
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Cache } from "../src/cache.js";
import { loadSettings } from "../src/config.js";
import { HttpClient } from "../src/http.js";
import { SocrataClient } from "../src/socrata.js";
import { resolvePropertyTool } from "../src/tools/resolve.js";
import { buildingComplianceSummary } from "../src/tools/summary.js";
import { getDobViolations, getEcbViolations, getHpdViolations } from "../src/tools/violations.js";

const dir = join(process.cwd(), "tests", "fixtures", "http");
mkdirSync(dir, { recursive: true });
export const fixtureName = (url: string) => createHash("sha1").update(url).digest("hex").slice(0, 16) + ".json";

const settings = { ...loadSettings({}), appToken: undefined };
const http = new HttpClient({
  cache: new Cache(":memory:", 60_000),
  settings,
  fetch: async (url, init) => {
    const res = await fetch(url, init);
    const body = await res.text();
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
await attempt("no match", () => resolvePropertyTool(r, { address: "zzzz nowhere qq" }));
await attempt("injection address", () => resolvePropertyTool(r, { address: "1 Main St'; DROP TABLE x; -- $where=1=1" }));
// Residential building with HPD coverage
await attempt("res summary", () => buildingComplianceSummary(r, { bin: "2099579" }));
await attempt("res hpd", () => getHpdViolations(r, { bbl: "2046540021", status: "closed", limit: 3 }));
await attempt("res hpd by bin", () => getHpdViolations(r, { bin: "2099579", limit: 3 }));
