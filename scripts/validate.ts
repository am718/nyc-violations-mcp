/**
 * 10-building validation. For each building: run building_compliance_summary (the real tool, live),
 * then independently recount with plain Socrata queries written WITHOUT the server's query builder
 * (simple `field=value` filters + count(*)). Prints a markdown table. Needs network.
 * Run: npm run validate > docs/validation-output.md
 */
import { Cache } from "../src/cache.js";
import { loadSettings } from "../src/config.js";
import { HttpClient } from "../src/http.js";
import { SocrataClient } from "../src/socrata.js";
import { buildingComplianceSummary } from "../src/tools/summary.js";

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
const sleep = (ms: number) => new Promise((x) => setTimeout(x, ms));

/** Independent count: plain URL, no server code. */
async function indep(dataset: string, filter: string): Promise<number> {
  await sleep(1100);
  const res = await fetch(`${B}/${dataset}.json?$select=count(*)&${filter}`);
  const j = (await res.json()) as { n?: string; count?: string }[];
  return Number(j[0]?.count ?? j[0]?.n ?? NaN);
}

const rows: string[] = [];
let allMatch = true;
for (const address of BUILDINGS) {
  try {
    const s = await buildingComplianceSummary(r, { address });
    const { bin, bbl } = s.property;
    const a = s.agencies as Record<string, Record<string, unknown>>;
    const q = (x: string) => encodeURIComponent(x);
    const dobTotal = await indep("3h2n-5cm9", `bin=${bin}`);
    const dobOpen = await indep("3h2n-5cm9", `$where=${q(`bin='${bin}' AND violation_category like '%ACTIVE%'`)}`);
    const ecbTotal = await indep("6bgk-3dad", `bin=${bin}`);
    const ecbOpen = await indep("6bgk-3dad", `bin=${bin}&ecb_violation_status=ACTIVE`);
    const hpdTotal = await indep("wvxf-dwi5", `bbl=${bbl}`);
    const hpdOpen = await indep("wvxf-dwi5", `bbl=${bbl}&violationstatus=Open`);
    const sum = (x: Record<string, unknown>) => (Number(x.open ?? 0) || 0) + (Number(x.closed ?? 0) || 0) + (Number(x.unknown ?? 0) || 0);
    const hpdNull = a.HPD!.open === null;
    const ok =
      Number(a.DOB!.open) === dobOpen && sum(a.DOB!) === dobTotal &&
      Number(a.ECB!.open) === ecbOpen && sum(a.ECB!) === ecbTotal &&
      (hpdNull ? hpdTotal === 0 : Number(a.HPD!.open) === hpdOpen && sum(a.HPD!) === hpdTotal);
    allMatch &&= ok;
    const cell = (mine: string, ind: string) => (mine === ind ? mine : `${mine} / **${ind}**`);
    rows.push(
      `| ${address} | ${bin} | ${bbl} | ${cell(`${a.DOB!.open}/${sum(a.DOB!)}`, `${dobOpen}/${dobTotal}`)} | ${cell(`${a.ECB!.open}/${sum(a.ECB!)}`, `${ecbOpen}/${ecbTotal}`)} | ${hpdNull ? cell("none (coverage note)", hpdTotal === 0 ? "none (coverage note)" : `${hpdOpen}/${hpdTotal}`) : cell(`${a.HPD!.open}/${sum(a.HPD!)}`, `${hpdOpen}/${hpdTotal}`)} | ${ok ? "match" : "**MISMATCH**"} |`,
    );
    console.error("done", address, ok ? "match" : "MISMATCH");
  } catch (e) {
    allMatch = false;
    rows.push(`| ${address} | - | - | - | - | - | ERROR: ${e instanceof Error ? e.message.slice(0, 80) : "unknown"} |`);
  }
}
console.log(`Run at ${new Date().toISOString()}\n`);
console.log("| Address | BIN | BBL | DOB open/total (tool / independent) | ECB open/total | HPD open/total | Result |");
console.log("|---|---|---|---|---|---|---|");
console.log(rows.join("\n"));
console.log(`\nAll rows match: ${allMatch}`);
