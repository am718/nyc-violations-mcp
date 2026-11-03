import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, it } from "vitest";
import { boroughOf, checkAddress, parseInput, placeOnlyReason, splitStreet, streetTokens } from "../src/address.js";
import { GEOSEARCH_CANDIDATES } from "../src/config.js";
import { createServer } from "../src/server.js";
import { fixtureFetch, makeResolver } from "./helpers.js";

// The GeoSearch responses used here were recorded from the live service (tests/fixtures/http, see scripts/record-fixtures.ts).
const geoUrl = (text: string) => "https://geosearch.planninglabs.nyc/v2/search?" + new URLSearchParams({ text, size: String(GEOSEARCH_CANDIDATES) }).toString();
const recorded = (text: string) => {
  const name = createHash("sha1").update(geoUrl(text)).digest("hex").slice(0, 16) + ".json";
  const f = JSON.parse(readFileSync(join(__dirname, "fixtures", "http", name), "utf8")) as { body: string };
  return (JSON.parse(f.body) as { features: { properties: Record<string, string> }[] }).features[0]!.properties;
};
const candidate = (text: string) => {
  const p = recorded(text);
  return { housenumber: p.housenumber, street: p.street, borough: p.borough, postalcode: p.postalcode };
};

async function connect() {
  const server = createServer(makeResolver(fixtureFetch()));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}
const call = (client: Client, name: string, args: Record<string, unknown>) =>
  client.callTool({ name, arguments: args }) as Promise<{ isError?: boolean; content: { type: string; text: string }[] }>;

describe("wrong addresses are refused, not silently matched (recorded GeoSearch responses)", () => {
  it("the recorded wrong matches really carry confidence 0.8 / fallback, which is why confidence cannot be the check", () => {
    for (const a of ["123 Fake Street, Queens", "Lot 1 Block 1, Manhattan", "350 5th Ave, Manhattan"]) {
      expect(recorded(a).confidence).toBe(0.8);
      expect(recorded(a).match_type).toBe("fallback");
    }
  });

  for (const [input, candBin, label] of [
    ["123 Fake Street, Queens", "1087830", "123 WEST 123 STREET"],
    ["Lot 1 Block 1, Manhattan", "1088918", "1 LT HALLORAN STREET"],
    ["9999 5th Ave, Manhattan", "1008850", "5 AVENUE"],
  ] as const) {
    for (const tool of ["resolve_property", "building_compliance_summary"]) {
      it(`${tool}: "${input}" fails with an error that shows the best candidate and says what to do`, async () => {
        const client = await connect();
        const res = await call(client, tool, { address: input });
        expect(res.isError).toBe(true);
        const t = res.content.map((c) => c.text).join(" ");
        expect(t).toMatch(/does not match the closest NYC address found/);
        expect(t).toContain(label);
        expect(t).toMatch(/NOT used/);
        expect(t).toContain(`bin "${candBin}"`); // the caller can confirm the candidate by passing its BIN
        expect(t).not.toMatch(/"bin":/); // no building data returned as a success
      });
    }
  }

  it("the reason names what differs (house number / street / borough)", async () => {
    const client = await connect();
    const t = (await call(client, "resolve_property", { address: "123 Fake Street, Queens" })).content[0]!.text;
    expect(t).toMatch(/street name differs/);
    expect(t).toMatch(/borough differs/);
    const t2 = (await call(client, "resolve_property", { address: "9999 5th Ave, Manhattan" })).content[0]!.text;
    expect(t2).toMatch(/house number differs/);
  });

  it("correct addresses, abbreviations and case variants still resolve (recorded)", async () => {
    const client = await connect();
    for (const input of ["350 5th Ave, Manhattan", "2 St Marks Pl, Manhattan", "1 Centre St, Manhattan", "1 Stuyvesant Oval, Manhattan"]) {
      const res = await call(client, "resolve_property", { address: input });
      expect(res.isError, input).toBeFalsy();
    }
  });

  it("a unique match with no borough or zip given carries a note saying which borough it is in", async () => {
    const client = await connect();
    const withBorough = JSON.parse((await call(client, "resolve_property", { address: "350 5th Ave, Manhattan" })).content[0]!.text);
    expect(JSON.stringify(withBorough)).not.toMatch(/No borough or zip code was given/);
    const without = JSON.parse((await call(client, "resolve_property", { address: "209 Joralemon St" })).content[0]!.text);
    expect(JSON.stringify(without)).toMatch(/No borough or zip code was given\. This was the only matching building.*Brooklyn/);
  });

  it("the same address in two boroughs with no borough given is an error listing both, not a guess (recorded)", async () => {
    const client = await connect();
    const res = await call(client, "resolve_property", { address: "350 FIFTH AVE" });
    expect(res.isError).toBe(true);
    const t = res.content[0]!.text;
    expect(t).toMatch(/matches 2 different places/);
    expect(t).toContain('bin "1015862"'); // Empire State Building, Manhattan
    expect(t).toContain('bin "3021057"'); // 350 5th Avenue, Brooklyn
  });

  it("borough-only input is refused before any request, in both tools", async () => {
    for (const tool of ["resolve_property", "building_compliance_summary"]) {
      const calls: string[] = [];
      const server = createServer(makeResolver(fixtureFetch(calls)));
      const [a, b] = InMemoryTransport.createLinkedPair();
      const client = new Client({ name: "t", version: "0" });
      await Promise.all([server.connect(a), client.connect(b)]);
      const res = await call(client, tool, { address: "Queens, NY" });
      expect(res.isError).toBe(true);
      expect(res.content[0]!.text).toMatch(/names only a borough, city or zip code.*a BIN.*a BBL/);
      expect(calls).toEqual([]);
    }
  });
});

describe("checkAddress on recorded candidates: abbreviations and case", () => {
  const esb = candidate("350 5th Ave, Manhattan"); // 350 / "5 AVENUE" / Manhattan / 10118
  for (const ok of [
    "350 5th Ave, Manhattan",
    "350 5TH AVE, MANHATTAN",
    "350 5th avenue, manhattan",
    "350   5th   Ave ,  Manhattan ",
    "350 Fifth Avenue, Manhattan",
    "350 5 Ave Manhattan",
    "350 5th Ave Manhattan NY 10118",
    "350 5th Ave, New York, NY",
    "350 5th Ave",
  ]) {
    it(`accepts ${JSON.stringify(ok)}`, () => expect(checkAddress(ok, esb)).toMatchObject({ ok: true }));
  }
  for (const [bad, why] of [
    ["351 5th Ave, Manhattan", /house number/],
    ["350 6th Ave, Manhattan", /street name/],
    ["350 5th Ave, Brooklyn", /borough/],
    ["350 5th Ave, Manhattan, NY 11111", /zip/],
    ["5th Ave, Manhattan", /no house number/],
    ["350, Manhattan", /only a borough/],
    ["350 5th, Manhattan", /no street type/],
    ["350 5th St, Manhattan", /street type differs/],
    ["350 5th Ave, Brooklyn, Manhattan", /more than one borough/],
    ["350 5th Ave, Quens", /borough differs/],
  ] as [string, RegExp][]) {
    it(`rejects ${JSON.stringify(bad)}`, () => {
      const r = checkAddress(bad, esb);
      expect(r.ok).toBe(false);
      expect(r.reasons.join(" ")).toMatch(why);
    });
  }

  it("directions, ordinals, Saint and hyphenated Queens numbers", () => {
    const w72 = { housenumber: "1", street: "WEST 72 STREET", borough: "Manhattan", postalcode: "10023" };
    for (const i of ["1 W 72nd St, Manhattan", "1 West 72nd Street, Manhattan", "1 w 72 st manhattan"]) expect(checkAddress(i, w72).ok, i).toBe(true);
    expect(checkAddress("1 72nd St, Manhattan", w72).ok).toBe(false); // direction missing: ambiguous, not silently East/West
    expect(checkAddress("1 E 72nd St, Manhattan", w72).ok).toBe(false);
    const saint = { housenumber: "2", street: "SAINT MARK'S PLACE", borough: "Manhattan", postalcode: "10003" };
    for (const i of ["2 St Marks Pl, Manhattan", "2 Saint Marks Place, Manhattan", "2 St. Mark's Pl, Manhattan"]) expect(checkAddress(i, saint).ok, i).toBe(true);
    const q = { housenumber: "37-02", street: "MAIN STREET", borough: "Queens", postalcode: "11354" };
    expect(checkAddress("37-02 Main St, Queens", q).ok).toBe(true);
    expect(checkAddress("02 Main St, Queens", q).ok).toBe(false);
    expect(checkAddress("37-12 Main St, Queens", q).ok).toBe(false);
  });

  it("a street that is also a borough name is not mistaken for a borough claim", () => {
    const qb = { housenumber: "30-100", street: "QUEENS BOULEVARD", borough: "Queens", postalcode: "11374" };
    expect(checkAddress("30-100 Queens Blvd, Queens", qb).ok).toBe(true);
    expect(checkAddress("30-100 Queens Blvd", qb).ok).toBe(true);
    expect(checkAddress("100 Queens Blvd, Queens", qb).ok).toBe(false);
    const bk = { housenumber: "1", street: "BROOKLYN AVENUE", borough: "Brooklyn", postalcode: "11216" };
    expect(checkAddress("1 Brooklyn Ave Brooklyn", bk).ok).toBe(true);
  });

  it("parseInput and streetTokens", () => {
    expect(parseInput("209 joralemon street brooklyn")).toMatchObject({ house: "209", street: "joralemon street", borough: "Brooklyn" });
    expect(parseInput("1 Bay St, Staten Island")).toMatchObject({ house: "1", borough: "Staten Island" });
    expect(parseInput("5th Ave")).toMatchObject({ house: "", street: "5th Ave" });
    expect(streetTokens("W 72nd St")).toEqual(["west", "72", "st"]);
  });

  it("place-only detection: boroughs, misspellings, city, zip, house number + borough; not real streets or names", () => {
    for (const p of ["Queens", "Queens, NY", "Bronx", "Brooklyn", "Manhattan", "Staten Island", "New York", "Brooklyn, NY", "Quens", "Brookyln", "Manhatan", "Staten Iland", "The Bronx", "NYC, NY", "New York City", "10001", "NY 10118", "50 Queens", "Bronx 10451"]) {
      expect(placeOnlyReason(p), p).not.toBeNull();
    }
    for (const p of ["Queens Blvd", "1 Brooklyn Ave, Brooklyn", "Empire State Building", "Borough Hall", "4 New York Plaza", "Staten Island Mall", "350 5th Ave", "\u2603\u2603\u2603"]) {
      expect(placeOnlyReason(p), p).toBeNull();
    }
  });

  it("boroughOf allows small misspellings only, never short or unrelated words", () => {
    expect(["quens", "queen", "brookyln", "brooklin", "manhatan", "manhatten", "brnx", "statenisland", "statenisand"].map(boroughOf)).toEqual(["Queens", "Queens", "Brooklyn", "Brooklyn", "Manhattan", "Manhattan", "Bronx", "Staten Island", "Staten Island"]);
    for (const w of ["bk", "que", "brook", "bronze", "manhasset", "astoria", "flushing", "court"]) expect(boroughOf(w), w).toBeNull();
  });

  it("street type is only the last token, and a type word never matches by itself", () => {
    expect(splitStreet(streetTokens("Queen's Court"))).toEqual({ core: ["queens"], type: "court" });
    expect(splitStreet(streetTokens("Court St"))).toEqual({ core: ["court"], type: "street" });
    expect(splitStreet(streetTokens("St Marks Pl"))).toEqual({ core: ["saint", "marks"], type: "place" });
    expect(splitStreet(streetTokens("Avenue A"))).toEqual({ core: ["avenue", "a"], type: null });
    expect(splitStreet(streetTokens("Street"))).toEqual({ core: [], type: "street" });
    // synthetic candidates (labeled): a house-less name must equal the candidate exactly, type included
    expect(checkAddress("Rockefeller", { housenumber: null, street: "ROCKEFELLER PLAZA", borough: "Manhattan" }).reasons).toEqual(["no street type was given (the match is a plaza)"]);
    expect(checkAddress("Rockefeller Plaza", { housenumber: null, street: "ROCKEFELLER PLAZA", borough: "Manhattan" }).ok).toBe(true);
    expect(checkAddress("100 Street, Brooklyn", { housenumber: "100", street: "COURT STREET", borough: "Brooklyn" }).reasons).toEqual(["no street name was given"]);
    // the name must match in order: West 72 Street is not 72 West Street
    expect(checkAddress("72 W 72nd St, Manhattan", { housenumber: "72", street: "72 WEST STREET", borough: "Manhattan" }).ok).toBe(false);
  });

  it("a candidate that is literally named after a borough is still refused (synthetic; the place-only rule inside the matcher)", () => {
    const r = checkAddress("Brooklyn", { housenumber: null, street: "BROOKLYN", borough: "Brooklyn", postalcode: "11201" });
    expect(r).toMatchObject({ ok: false, reasons: ["only a borough, city or zip code was given, not a street"] });
  });

  it("recorded: '350 5th, Brooklyn' (no type) is refused because 350 5th Avenue and 350 5th Street both exist there", () => {
    const r = checkAddress("350 5th, Brooklyn", candidate("350 5th, Brooklyn"));
    expect(r.ok).toBe(false);
    expect(r.reasons.join()).toMatch(/no street type/);
  });

  it("invisible and compatibility characters are normalized (recorded: fullwidth digits and a zero-width space)", async () => {
    const client = await connect();
    for (const input of ["\uff13\uff15\uff10 \uff15th Ave, Manhattan", "350\u200b 5th Ave, Manhattan"]) {
      const res = await call(client, "resolve_property", { address: input });
      expect(res.isError, input).toBeFalsy();
      expect(JSON.parse(res.content[0]!.text).bin).toBe("1015862");
    }
  });

  it("a typed borough or zip must be confirmed: a candidate without one is refused (synthetic)", () => {
    const noPlace = { housenumber: "350", street: "5 AVENUE", borough: null, postalcode: null };
    expect(checkAddress("350 5th Ave, Manhattan", noPlace).reasons).toEqual(["the match has no borough to compare"]);
    expect(checkAddress("350 5th Ave, 10118", noPlace).reasons).toEqual(["the match has no zip code to compare"]);
    expect(checkAddress("350 5th Ave", noPlace).ok).toBe(true); // nothing typed to confirm
  });
});
