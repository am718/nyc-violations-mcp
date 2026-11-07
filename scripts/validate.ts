/**
 * 10-building validation. For each building: run building_compliance_summary (the real tool, live),
 * then independently recount with plain Socrata queries written WITHOUT the server's query builder
 * (simple `field=value` filters + count(*)). Prints a markdown table. Needs network.
 * Every independent count is checked (status and shape) and retried with backoff; a failed count makes that building's row
 * ERROR and the process exit code 1 (scripts/independent-count.ts). It never reports NaN as a mismatch.
 * Run: npm run validate > docs/validation-output.md
 */
import { Cache } from "../src/cache.js";
import { loadSettings } from "../src/config.js";
import { HttpClient } from "../src/http.js";
import { SocrataClient } from "../src/socrata.js";
import { buildingComplianceSummary } from "../src/tools/summary.js";
import { independentCount } from "./independent-count.js";

const BUILDINGS = [
  "350 5th Ave, Manhattan", // Empire State Building
  "175 5th Ave, Manhattan", // Flatiron Building
  "405 Lexington Ave, Manhattan", // Chrysler Building
  "285 Fulton St, Manhattan", // One World Trade Center
  "89 E 42nd St, Manhattan", // Grand Central Terminal
  "233 Broadway, Manhattan", // Woolworth Building
  "1 W 72nd St, Manhattan", // The Dakota
  "209 Joralemon St, Brooklyn", // Brooklyn Borough Hall
  "1 E 161st St, Bronx", // Yankee Stadium
  "1 Stuyvesant Oval, Manhattan", // Stuyvesant Town
];

const settings = { ...loadSettings({}), appToken: undefined };
const http = new HttpClient({ fetch: (u, i) => fetch(u, i), cache: new Cache(":memory:", 600_000), settings });
const r = { http, socrata: new SocrataClient(http) };
const B = "https://data.cityofnewyork.us/resource";
const sleep = (ms: number) => new Promise<void>((x) => setTimeout(x, ms));

/** Independent count: plain URL, no server code. */
async function indep(dataset: string, filter: string, distinct = false): Promise<number> {
  await sleep(1100);
  const sel = filter.startsWith("$select=") ? "" : "$select=count(*)&";
  const url = distinct && !filter.startsWith("$select=")
    ? `${B}/${dataset}.json?$select=${encodeURIComponent("count(distinct bin) as n")}&${filter}`
    : `${B}/${dataset}.json?${sel}${filter}`;
  return independentCount(url, { fetch: (u) => fetch(u), sleep }, dataset);
}

const rows: string[] = [];
const detail: string[] = [];
let allMatch = true;
for (const address of BUILDINGS) {
  try {
    const s = await buildingComplianceSummary(r, { address });
    const { bin, bbl } = s.property;
    const a = s.agencies as Record<string, Record<string, unknown>>;
    const q = (x: string) => encodeURIComponent(x);
    const D = "3h2n-5cm9";
    const E = "6bgk-3dad";
    const H = "wvxf-dwi5";
    const dobTotal = await indep(D, `bin=${bin}`);
    const dobOpen = await indep(D, `$where=${q(`bin='${bin}' AND violation_category like '%ACTIVE%'`)}`);
    const dobDeleted = await indep(D, `$where=${q(`bin='${bin}' AND violation_category like '%ACTIVE%' AND upper(disposition_comments) like '%DELETED%'`)}`);
    const ecbTotal = await indep(E, `bin=${bin}`);
    const ecbOpen = await indep(E, `bin=${bin}&ecb_violation_status=ACTIVE`);
    const ecbWritten = await indep(E, `bin=${bin}&ecb_violation_status=ACTIVE&hearing_status=${q("WRITTEN OFF")}`);
    const hpdTotal = await indep(H, `bin=${bin}`);
    const hpdOpen = await indep(H, `bin=${bin}&violationstatus=Open`);
    const lotDob = await indep(D, `$select=${q("count(distinct bin) as n")}&$where=${q(`boro='${bbl.slice(0, 1)}' AND block='${bbl.slice(1, 6)}' AND lot='0${bbl.slice(6)}'`)}`.replace("$select=count(*)&", ""), true);
    const lotHpd = await indep(H, `$where=${q(`bbl='${bbl}'`)}`, true);
    const sum = (x: Record<string, unknown>) => (Number(x.open ?? 0) || 0) + (Number(x.closed ?? 0) || 0) + (Number(x.unknown ?? 0) || 0);
    const hpdNull = a.HPD!.open === null;
    const fp = (s.footprint as { other_bins_on_lot: number }).other_bins_on_lot;
    const checks: [string, boolean][] = [
      ["DOB open", Number(a.DOB!.open) === dobOpen],
      ["DOB total", sum(a.DOB!) === dobTotal],
      ["DOB deleted-flag", (dobOpen === 0 && a.DOB!.open_flagged_deleted === undefined) || Number(a.DOB!.open_flagged_deleted) === dobDeleted],
      ["ECB open", Number(a.ECB!.open) === ecbOpen],
      ["ECB total", sum(a.ECB!) === ecbTotal],
      ["ECB written-off-flag", (ecbOpen === 0 && a.ECB!.open_flagged_written_off === undefined) || Number(a.ECB!.open_flagged_written_off) === ecbWritten],
      ["HPD (by BIN)", hpdNull ? hpdTotal === 0 : Number(a.HPD!.open) === hpdOpen && sum(a.HPD!) === hpdTotal],
    ];
    const bad = checks.filter(([, ok]) => !ok).map(([n]) => n);
    // other_bins_on_lot is approximate by design: expected = max(distinct DOB bins, distinct HPD bins on lot) - 1 (HPD distinct computed below)
    const ok = bad.length === 0;
    allMatch &&= ok;
    const cell = (mine: string, ind: string) => (mine === ind ? mine : `${mine} / **${ind}**`);
    const dobEx = a.DOB!.open_excluding_deleted === undefined ? `${a.DOB!.open}` : `${a.DOB!.open_excluding_deleted}`;
    const ecbEx = a.ECB!.open_excluding_written_off === undefined ? `${a.ECB!.open}` : `${a.ECB!.open_excluding_written_off}`;
    rows.push(
      `| ${address} | ${bin} | ${cell(`${a.DOB!.open}/${sum(a.DOB!)}`, `${dobOpen}/${dobTotal}`)} (excl. deleted ${cell(dobEx, `${dobOpen - dobDeleted}`)}) | ${cell(`${a.ECB!.open}/${sum(a.ECB!)}`, `${ecbOpen}/${ecbTotal}`)} (excl. written off ${cell(ecbEx, `${ecbOpen - ecbWritten}`)}) | ${hpdNull ? cell("none (coverage note)", hpdTotal === 0 ? "none (coverage note)" : `${hpdOpen}/${hpdTotal}`) : cell(`${a.HPD!.open}/${sum(a.HPD!)}`, `${hpdOpen}/${hpdTotal}`)} | ${fp} (DOB bins on lot ${lotDob}; HPD bins ${lotHpd}) | ${ok ? "match" : `**MISMATCH: ${bad.join(", ")}**`} |`,
    );
    detail.push(`${address}: lot-bin approx check: other_bins_on_lot=${fp}, max(DOB,HPD distinct bins)-1=${Math.max(0, Math.max(lotDob, lotHpd) - 1)}`);
    if (fp !== Math.max(0, Math.max(lotDob, lotHpd) - 1)) {
      allMatch = false;
      rows[rows.length - 1] += " (other_bins_on_lot MISMATCH)";
    }
    console.error("done", address, ok ? "match" : "MISMATCH " + bad.join(","));
  } catch (e) {
    allMatch = false;
    console.error("FAILED", address, e instanceof Error ? e.message : "unknown error");
    rows.push(`| ${address} | - | - | - | - | - | ERROR: ${e instanceof Error ? e.message.slice(0, 160) : "unknown"} |`);
  }
}
console.log(`Run at ${new Date().toISOString()}\n`);
console.log("| Address | BIN | DOB open/total (tool / independent) | ECB open/total | HPD open/total (by BIN) | other_bins_on_lot | Result |");
console.log("|---|---|---|---|---|---|---|");
console.log(rows.join("\n"));
console.log(`\nAll rows match: ${allMatch}`);
console.log("\n" + detail.join("\n"));
if (!allMatch) process.exitCode = 1;
