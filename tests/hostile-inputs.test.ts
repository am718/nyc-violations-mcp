/**
 * Permanent hostile-input suite (from the independent review's 127 cases, updated for the fixes).
 * Every case has an expected outcome. For every case, EVERY URL the server would send must match a strict allowlist:
 * only the three datasets or GeoSearch, only the params $select/$where/$group/$order/$limit, and $where built only from
 * validated digit literals and fixed fragments. Any input that changed query structure would fail the allowlist check.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { createServer } from "../src/server.js";
import { fixtureFetch, makeResolver } from "./helpers.js";

type Outcome = "reject" | "accept";
interface Case {
  tool: string;
  args: Record<string, unknown>;
  label: string;
  expect: Outcome;
  /** For rejected address cases that legitimately reach GeoSearch (and nothing else). */
  geoOnly?: boolean;
}

// ---------- strict allowlist ----------
const SOCRATA = /^https:\/\/data\.cityofnewyork\.us\/resource\/(3h2n-5cm9|6bgk-3dad|wvxf-dwi5)\.json\?/;
const GEO = /^https:\/\/geosearch\.planninglabs\.nyc\/v2\/search\?text=[^&]*&size=1$/;
const LOC = [/^bin = '[1-5]\d{6}'$/, /^bbl = '[1-5]\d{9}'$/, /^boro = '[1-5]' AND block = '\d{5}' AND lot = '\d{5}'$/];
const TEXT_DATE =
  "(issue_date between '18000101' and '22001231' AND issue_date like '________' AND substring(issue_date,5,2) between '01' and '12' AND substring(issue_date,7,2) between '01' and '31' AND NOT (substring(issue_date,5,2) = '02' AND substring(issue_date,7,2) > '29') AND NOT (substring(issue_date,5,2) in ('04','06','09','11') AND substring(issue_date,7,2) = '31'))";
const FIXED = [
  "upper(violation_category) like '%ACTIVE%'",
  "(upper(violation_category) like '%RESOLVED%' OR upper(violation_category) like '%DISMISSED%')",
  "ecb_violation_status = 'ACTIVE'",
  "ecb_violation_status = 'RESOLVE'",
  "violationstatus = 'Open'",
  "violationstatus = 'Close'",
  "bin NOT LIKE '_000000'",
  "upper(disposition_comments) like '%DELETED%'",
  "hearing_status = 'WRITTEN OFF'",
  "novissueddate IS NOT NULL",
  TEXT_DATE,
];
const SELECT_OK = /^(count\(\*\) as n|count\(distinct bin\) as n|[a-z_]+, count\(\*\) as n(, max\([a-z_]+\) as latest)?|boro, block, lot, house_number, street, count\(\*\) as n|bbl, bin, housenumber, streetname, count\(\*\) as n|bin, (house_number, street|housenumber, streetname), count\(\*\) as n)$/;
function checkUrl(u: string): string {
  if (GEO.test(u)) return [...new URL(u).searchParams.keys()].join() === "text,size" ? "ok" : "geosearch params changed";
  if (!SOCRATA.test(u)) return `bad host/path ${u.slice(0, 60)}`;
  const p = new URL(u).searchParams;
  for (const k of p.keys()) if (!["$select", "$where", "$group", "$order", "$limit"].includes(k)) return `bad param ${k}`;
  if (!/^\d{1,4}$/.test(p.get("$limit") ?? "") || Number(p.get("$limit")) > 1000) return "bad limit";
  const sel = p.get("$select");
  if (sel && !SELECT_OK.test(sel)) return `bad select ${sel}`;
  const grp = p.get("$group");
  if (grp && !/^[a-z_]+(, [a-z_]+)*$/.test(grp)) return "bad group";
  const ord = p.get("$order");
  if (ord && !/^((issue_date|novissueddate) DESC|n DESC)$/.test(ord)) return "bad order";
  const w = p.get("$where");
  if (w) {
    let rest = w;
    for (const f of FIXED) rest = rest.split(f).join("§");
    const parts = rest.split(" AND ").map((x) => x.trim());
    for (let i = 0; i < parts.length; i++) {
      if (parts[i] === "§") continue;
      if (parts[i]!.startsWith("boro")) {
        if (!LOC[2]!.test(parts.slice(i, i + 3).join(" AND "))) return `bad loc ${parts.slice(i, i + 3).join(" AND ")}`;
        i += 2;
        continue;
      }
      if (!(LOC[0]!.test(parts[i]!) || LOC[1]!.test(parts[i]!))) return `bad where part ${parts[i]!.slice(0, 60)}`;
    }
  }
  return "ok";
}

// ---------- the cases ----------
const cases: Case[] = [];
const add = (tool: string, args: Record<string, unknown>, label: string, exp: Outcome, geoOnly = false) => cases.push({ tool, args, label, expect: exp, geoOnly });

const BIN_REJECT = [
  "'", '"', "''", "' OR '1'='1", '" OR "1"="1', "'; DROP TABLE x; --", "1' UNION SELECT * FROM x--", "1015862' /* c */ OR 1=1", "1015862 AND 1=1",
  "1015862) OR (1=1", "$where=1=1", "1015862&$limit=100000", "1015862%27%20OR%201=1", "1015862\u0000", "1015862\u0000' OR 1=1", "1015862 LIKE '%'",
  "1015862 IS NOT NULL", "1015862 UNION ALL SELECT", "1015862;SELECT 1", "1015862--", "1015862#", "1015862‮", "1015862​", "１０１５８６２",
  "١٠١٥٨٦٢", "1015862.0", "0x1015862", "-1015862", "+1015862", "1015862e0", " ", "", "null", "undefined", "NaN", "Infinity", "1".repeat(50000), "'".repeat(5000),
  "1000000", "2000000", "3000000", "4000000", "5000000", "0000000", "6015862",
];
for (const q of BIN_REJECT) add("get_dob_violations", { bin: q }, `dob bin=${JSON.stringify(q).slice(0, 36)}`, "reject");
add("get_dob_violations", { bin: "1015862\n" }, "dob bin with trailing newline (trimmed)", "accept");

const BBL_REJECT = [
  "'", "1008350041' OR 1=1 --", "1008350041 UNION SELECT", "1008350041\u0000", "1-00835-0041' OR 1=1", "1-00835-0041 /*", "１００８３５００４１", "1008350041.0",
  "10083500411", "100835004", "0008350041", "6008350041", "1-0-0", "1-123456-1", "1--1", "bbl", "1008350041,1008350042",
  "1000000000", "1008350000", "1999990001", "5-0-0", "3-00000-0001",
];
for (const q of BBL_REJECT) add("get_hpd_violations", { bbl: q }, `hpd bbl=${JSON.stringify(q).slice(0, 36)}`, "reject");
add("get_hpd_violations", { bbl: "1-00835-0041\n" }, "hpd bbl hyphen form with trailing newline (trimmed, normalized)", "accept");

for (const q of ["open' OR 1=1", "open;", "closed\u0000", "both", "", "open,closed", "*", 1, true]) add("get_ecb_violations", { bin: "1015862", status: q }, `ecb status=${JSON.stringify(q)}`, "reject");
for (const q of ["OPEN", "Open", "oPeN", "CLOSED"]) add("get_ecb_violations", { bin: "1015862", status: q }, `ecb status=${JSON.stringify(q)} (any case)`, "accept");

for (const q of [1e9, -1, 0, 101, 2.5, "5; DROP", "1e2", "NaN", null, "", "10 OR 1=1", [5], { a: 1 }, true, false, 1e308, "0x10", "007", " 5", "5 ", "+5", "5.0", "-5", "０５", "٥"]) add("get_dob_violations", { bin: "1015862", limit: q }, `limit=${JSON.stringify(q)}`, "reject");
for (const q of ["5", "25", 25, 100, 1]) add("get_dob_violations", { bin: "1015862", limit: q }, `limit=${JSON.stringify(q)}`, "accept");

for (const v of [[], { toString: "x" }, { $where: "1=1" }, { bin: "1015862" }, null, true, false, 1015862.5, "constructor", "__proto__", ["1015862' OR 1=1"]]) add("get_ecb_violations", { bin: v }, `bin type/value=${JSON.stringify(v)}`, "reject");
for (const v of [["1015862"], [["1015862"]], 1015862]) add("get_ecb_violations", { bin: v }, `bin coerced from ${JSON.stringify(v)}`, "accept");

for (const a of ["", "   ", "x".repeat(100000), "350 5th Ave\u0000", "350 5th Ave\u001b[2J", "350 5th Ave\r\nHost: evil", "\\"]) add("resolve_property", { address: a }, `address(schema)=${JSON.stringify(a).slice(0, 30)}`, "reject");
for (const a of [
  "350 5th Ave' OR 1=1 --", '350 5th Ave"; DROP', "350 5th Ave&$where=1=1&$limit=1000000#f", "350 5th Ave%26$where%3D1", "350 5th Ave/../../etc/passwd",
  "http://evil.example/$where=1", "٣٥٠ 5th Ave 🏢 ‮", "𝟑𝟓𝟎 5th Ave", "{{7*7}}", "${7*7}", "<script>alert(1)</script>", "350 5th Ave\ud800",
]) add("resolve_property", { address: a }, `address(geosearch only)=${JSON.stringify(a).slice(0, 30)}`, "reject", true);

add("resolve_property", { address: "350 5th Ave", bin: "1015862" }, "address + bin", "reject");
add("resolve_property", { address: "350 5th Ave", bbl: "1008350041" }, "address + bbl", "reject");
add("resolve_property", {}, "no identifier", "reject");
add("get_hpd_violations", {}, "hpd: neither bin nor bbl", "reject");
add("get_hpd_violations", { bin: "1015862", bbl: "2046540021" }, "MISMATCH borough (Manhattan bin / Bronx bbl)", "reject");
add("resolve_property", { bin: "3000256", bbl: "1008350041" }, "MISMATCH borough (Brooklyn bin / Manhattan bbl)", "reject");
add("building_compliance_summary", { bin: "1015862", bbl: "5000000001" }, "summary: bin + placeholder-ish bbl", "reject");
add("building_compliance_summary", { bbl: "5-00001-0001' OR 1=1" }, "summary: injected hyphen bbl", "reject");
add("get_hpd_violations", { bbl: "1-1-1", bin: "1000001" }, "tiny hyphen bbl + bin (not found upstream)", "reject");
add("get_dob_violations", { bin: "1015862", __proto__: { limit: 1 }, constructor: { prototype: { limit: 1 } }, $where: "1=1", $select: "*", $limit: 99999, $order: "x", $group: "x" }, "extra $-keys and prototype keys are ignored", "accept");
add("get_dob_violations", { bin: "1015862", status: "open", limit: 3 }, "control: plain valid DOB call", "accept");

// Cases that need real data shapes use recorded fixtures instead of the empty stub.
const FIXTURE_CASES: Case[] = [
  { tool: "resolve_property", args: { bin: "1015862", bbl: "1008350042" }, label: "same-borough wrong lot (recorded)", expect: "reject" },
  { tool: "resolve_property", args: { bin: "1015862", bbl: "1012970023" }, label: "same-borough different building (recorded)", expect: "reject" },
  { tool: "resolve_property", args: { bin: "1015862", bbl: "1008350041" }, label: "matching pair (recorded)", expect: "accept" },
  { tool: "resolve_property", args: { bin: "1015862" }, label: "control: valid resolve by bin (recorded)", expect: "accept" },
];

async function run(c: Case, fixture: boolean) {
  const urls: string[] = [];
  const stub = async (url: string) => {
    urls.push(url);
    return { ok: true, status: 200, text: async () => JSON.stringify(url.includes("geosearch") ? { features: [] } : [{ n: "0" }]) };
  };
  const server = createServer(makeResolver(fixture ? fixtureFetch(urls) : stub));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "hostile", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const res = await client.callTool({ name: c.tool, arguments: c.args }).catch((e: Error) => ({ isError: true, content: [{ type: "text", text: e.message }] }));
  const text = JSON.stringify(res.content);
  return { isError: !!res.isError, urls, text };
}

describe("hostile inputs: expected outcomes and URL allowlist", () => {
  it("has at least 127 cases", () => {
    expect(cases.length + FIXTURE_CASES.length).toBeGreaterThanOrEqual(127);
  });

  for (const [i, c] of [...cases.map((x) => [x, false] as const), ...FIXTURE_CASES.map((x) => [x, true] as const)].map(([x, f], idx) => [idx, { c: x, fixture: f }] as const)) {
    it(`#${i} ${c.c.tool}: ${c.c.label} -> ${c.c.expect}`, async () => {
      const r = await run(c.c, c.fixture);
      expect(r.isError, `expected ${c.c.expect}; got: ${r.text.slice(0, 160)}`).toBe(c.c.expect === "reject");
      for (const u of r.urls) expect(checkUrl(u), u.slice(0, 120)).toBe("ok");
      expect(r.text).not.toMatch(/Unexpected internal error/);
      if (c.c.geoOnly) {
        expect(r.urls).toHaveLength(1);
        expect(r.urls[0]).toMatch(/^https:\/\/geosearch\.planninglabs\.nyc\//);
      }
      if (c.c.expect === "reject" && !c.fixture && !c.c.geoOnly && c.c.tool !== "get_hpd_violations") {
        // Schema-level rejections must not touch the network at all (the pair/lookup cases above are the exception).
        if (/must|cannot exceed|too short|too long|control characters|placeholder/.test(r.text)) expect(r.urls).toHaveLength(0);
      }
    });
  }

  it("rejections carry an actionable message (valid-value example or next step)", async () => {
    for (const c of cases.filter((x) => x.expect === "reject" && !x.geoOnly).slice(0, 40)) {
      const r = await run(c, false);
      expect(r.text, c.label).toMatch(/e\.g\.|must|cannot|Provide|Pass|placeholder|not both|Use /);
    }
  });
});
