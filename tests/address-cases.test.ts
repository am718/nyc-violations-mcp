import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { checkAddress } from "../src/address.js";
import { GEOSEARCH_CANDIDATES, GEOSEARCH_URL } from "../src/config.js";
import { createServer } from "../src/server.js";
import { ADDRESS_CASES } from "../scripts/address-cases.js";
import { renderAddressCases } from "../scripts/address-cases-doc.js";
import { fixtureFetch, makeResolver } from "./helpers.js";

/**
 * Adversarial address cases (scripts/address-cases.ts), recorded live by scripts/record-address-cases.ts on 2026-11-03.
 * Each case replays the recorded GeoSearch response and must give the outcome (and BIN) seen live.
 * The rule under test: a wrong building must never come back as a success.
 */
interface Recorded { input: string; category: string; outcome: string; bin?: string; matched?: string; why: string }
const recorded = JSON.parse(readFileSync(join(__dirname, "fixtures", "address-cases.json"), "utf8")) as Recorded[];

const geoUrl = (text: string) => `${GEOSEARCH_URL}?${new URLSearchParams({ text, size: String(GEOSEARCH_CANDIDATES) })}`;
const candidatesFor = (text: string) => {
  const name = createHash("sha1").update(geoUrl(text)).digest("hex").slice(0, 16) + ".json";
  const f = JSON.parse(readFileSync(join(__dirname, "fixtures", "http", name), "utf8")) as { body: string };
  return (JSON.parse(f.body) as { features: { properties: Record<string, string> }[] }).features.map((x) => x.properties);
};

async function call(input: string) {
  const calls: string[] = [];
  const server = createServer(makeResolver(fixtureFetch(calls)));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  const res = (await client.callTool({ name: "resolve_property", arguments: { address: input } })) as { isError?: boolean; content: { text: string }[] };
  return { isError: !!res.isError, text: res.content.map((c) => c.text).join(" "), calls };
}
const outcomeOf = (r: { isError: boolean; text: string }) =>
  !r.isError ? "success"
    : /Input validation error/.test(r.text) ? "invalid-input"
    : /names only a borough/.test(r.text) ? "place-only"
    : /matches \d+ different places/.test(r.text) ? "ambiguous"
    : /does not match the closest/.test(r.text) ? "mismatch"
    : /No NYC address match/.test(r.text) ? "no-match"
    : /placeholder/.test(r.text) ? "placeholder"
    : "no-bin";

describe("adversarial address cases (recorded live)", () => {
  it("the table covers every input in scripts/address-cases.ts and has at least 50 adversarial inputs", () => {
    expect(recorded.map((c) => c.input)).toEqual(ADDRESS_CASES.map((c) => c.input));
    expect(recorded.filter((c) => !c.category.startsWith("gate-review") && c.category !== "existing-test").length).toBeGreaterThanOrEqual(50);
  });

  for (const c of recorded) {
    it(`[${c.category}] ${JSON.stringify(c.input).slice(0, 60)} -> ${c.outcome}${c.bin ? ` ${c.bin}` : ""}`, async () => {
      const r = await call(c.input);
      expect(outcomeOf(r), r.text.slice(0, 200)).toBe(c.outcome);
      if (c.outcome === "success") expect(JSON.parse(r.text).bin).toBe(c.bin);
      if (c.outcome === "place-only" || c.outcome === "invalid-input") expect(r.calls).toEqual([]); // refused before any request
      else expect(r.calls).toHaveLength(1); // one GeoSearch request, nothing else
    });
  }

  it("every borough/city/zip-only input is also refused by the matcher for EVERY recorded GeoSearch candidate (second layer)", () => {
    const placeOnly = recorded.filter((c) => c.outcome === "place-only");
    expect(placeOnly.length).toBeGreaterThanOrEqual(20);
    for (const c of placeOnly) {
      const cands = candidatesFor(c.input.trim()); // the server trims input before use
      for (const p of cands) expect(checkAddress(c.input, p).ok, `${c.input} vs ${p.label}`).toBe(false);
    }
    // The gate-review bug, as recorded: GeoSearch calls "Queens" an exact, confidence-1 match on a Bronx building.
    const q = candidatesFor("Queens")[0]!;
    expect([q.borough, q.street, String(q.confidence), q.match_type]).toEqual(["Bronx", "QUEEN'S COURT", "1", "exact"]);
  });

  it("the inputs that exposed weaknesses in the previous matcher are refused (recorded)", async () => {
    // Before Fixes 4 each of these came back as a success for one building; the right answer is an error.
    const expected: Record<string, string> = {
      "Queens": "place-only", "Queens, NY": "place-only", // Bronx "QUEEN'S COURT"
      "Borough Hall": "ambiguous", // 4 boroughs, previously the Brooklyn one
      "350 Fifth Ave": "ambiguous", "350 5th Ave": "ambiguous", "1 Main St": "ambiguous", // same address in 2+ boroughs
      "1 Wall St, Quens": "mismatch", // misspelt borough was ignored; the match is in Manhattan
      "350 5th, Brooklyn": "mismatch", // no street type: 350 5th Avenue and 350 5th Street both exist in Brooklyn
    };
    for (const [input, outcome] of Object.entries(expected)) expect(outcomeOf(await call(input)), input).toBe(outcome);
  });

  it("an ambiguous input names every matching building and its BIN, and uses none of them", async () => {
    const r = await call("Borough Hall");
    for (const bin of ["3000256", "2002869", "4052812"]) expect(r.text).toContain(`bin "${bin}"`);
    expect(r.text).toMatch(/None was used/);
    expect(r.text).not.toMatch(/"bbl":/);
  });

  it("no success matched a building in a borough other than the one typed", () => {
    const words: Record<string, RegExp> = { Manhattan: /manhat/i, Brooklyn: /brook|bklyn/i, Bronx: /bronx/i, Queens: /quee/i, "Staten Island": /staten/i };
    for (const c of recorded.filter((x) => x.outcome === "success")) {
      const place = c.input.split(",").slice(1).join(" ") || c.input;
      for (const [b, re] of Object.entries(words)) if (re.test(place)) expect(c.matched, c.input).toContain(`(${b})`);
    }
  });

  it("docs/ADDRESS_CASES.md is generated from the recorded cases and is up to date", () => {
    expect(readFileSync(join(__dirname, "..", "docs", "ADDRESS_CASES.md"), "utf8")).toBe(renderAddressCases(recorded));
  });
});
