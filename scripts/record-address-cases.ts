/**
 * Records the adversarial address cases: every GeoSearch response they need, and the live outcome of resolve_property for each
 * (tests/fixtures/address-cases.json). tests/address-cases.test.ts replays them offline and expects the same outcome.
 * Run: npm run build && node dist/scripts/record-address-cases.js   (network; ~1 request per case at 1 request/second)
 * Unlike record-fixtures.ts this does not delete other fixtures; it only adds or overwrites the GeoSearch ones it records.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Cache } from "../src/cache.js";
import { GEOSEARCH_CANDIDATES, GEOSEARCH_URL, loadSettings } from "../src/config.js";
import { HttpClient } from "../src/http.js";
import { SocrataClient } from "../src/socrata.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.js";
import { ADDRESS_CASES } from "./address-cases.js";
import { redact } from "./redact.js";

const dir = join(process.cwd(), "tests", "fixtures", "http");
mkdirSync(dir, { recursive: true });
const fixtureName = (url: string) => createHash("sha1").update(url).digest("hex").slice(0, 16) + ".json";

const http = new HttpClient({
  cache: new Cache(":memory:", 60_000),
  settings: { ...loadSettings({}), appToken: undefined },
  fetch: async (url, init) => {
    const res = await fetch(url, init);
    const body = redact(await res.text());
    writeFileSync(join(dir, fixtureName(url)), JSON.stringify({ url, status: res.status, body }, null, 1));
    return { ok: res.ok, status: res.status, text: async () => body };
  },
});
const r = { http, socrata: new SocrataClient(http) };
// Through the real MCP server, so input validation (zod: trim, length) applies exactly as it does for a client.
const server = createServer(r);
const [a, b] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "recorder", version: "0" });
await Promise.all([server.connect(a), client.connect(b)]);

export type Outcome = "success" | "invalid-input" | "place-only" | "ambiguous" | "mismatch" | "no-match" | "placeholder" | "no-bin";
const kindOf = (m: string): Outcome =>
  /Input validation error/.test(m) ? "invalid-input"
    : /names only a borough/.test(m) ? "place-only"
    : /matches \d+ different places/.test(m) ? "ambiguous"
    : /does not match the closest/.test(m) ? "mismatch"
    : /No NYC address match/.test(m) ? "no-match"
    : /placeholder/.test(m) ? "placeholder"
    : "no-bin";

const out: { input: string; category: string; outcome: Outcome; bin?: string; matched?: string; why: string }[] = [];
for (const { input, category } of ADDRESS_CASES) {
  const res = (await client.callTool({ name: "resolve_property", arguments: { address: input } })) as { isError?: boolean; content: { text: string }[] };
  const m = res.content.map((c) => c.text).join(" ");
  if (!res.isError) {
    const p = JSON.parse(m) as { bin: string; address: string; borough: string };
    out.push({ input, category, outcome: "success", bin: p.bin, matched: `${p.address} (${p.borough})`, why: "house number, street name, street type and any borough/zip agree; the only matching building among the candidates" });
  } else {
    const outcome = kindOf(m);
    // Place-only input is refused before any request. Record GeoSearch's answer anyway, so a test can show the matcher
    // would also refuse its real candidates if the early check were bypassed.
    if (outcome === "place-only") await http.getJson(`${GEOSEARCH_URL}?${new URLSearchParams({ text: input.trim(), size: String(GEOSEARCH_CANDIDATES) })}`);
    const why = outcome === "place-only" ? "names only a borough, city or zip code (refused before any request)"
      : outcome === "invalid-input" ? (m.match(/address[^.]*\./)?.[0] ?? "rejected by input validation")
      : outcome === "ambiguous" ? m.replace(/^".*?" /, "").replace(/\. None was used.*$/, "")
      : outcome === "mismatch" ? ((x) => (x ? `${x[2]}; closest candidate ${x[1]}` : m.slice(0, 160)))(m.match(/closest NYC address found, (".*?"(?: \(.*?\))?): (.*?)\. That building/))
      : m.replace(/^".*?" /, "").slice(0, 160);
    out.push({ input, category, outcome, why });
  }
  console.error(out.at(-1)!.outcome.padEnd(11), JSON.stringify(input).slice(0, 60));
}
writeFileSync(join(process.cwd(), "tests", "fixtures", "address-cases.json"), JSON.stringify(out, null, 1) + "\n");
console.error(`recorded ${out.length} cases`);
