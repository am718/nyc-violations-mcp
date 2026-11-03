/**
 * Compare what the caller typed with the address GeoSearch returned.
 *
 * GeoSearch always returns its best candidate, and reports confidence 0.8 / match_type "fallback" for correct and wrong
 * matches alike (see docs/DATA.md), so those two fields cannot tell a wrong building from the right one. This check
 * compares the fields that can: house number, street name, borough and zip.
 */

export interface Candidate {
  housenumber?: string | null;
  street?: string | null;
  borough?: string | null;
  postalcode?: string | null;
}

export interface AddressCheck {
  ok: boolean;
  /** Why the candidate was rejected (empty when ok). Short, no user text echoed. */
  reasons: string[];
  /** True when the caller named a borough or a zip code, so the borough/zip comparison above was meaningful. */
  placeGiven: boolean;
}

const BOROUGH_WORDS: Record<string, string> = {
  manhattan: "Manhattan",
  brooklyn: "Brooklyn",
  bklyn: "Brooklyn",
  bronx: "Bronx",
  queens: "Queens",
  statenisland: "Staten Island",
};
/** Words that carry no street information and may appear in the place part of an address. */
const PLACE_NOISE = new Set(["ny", "nyc", "usa", "us", "new", "york", "united", "states", "city", "the", "of", "county", "kings", "richmond", "ny.", "n.y."]);

const ORDINAL_WORDS: Record<string, string> = {
  first: "1", second: "2", third: "3", fourth: "4", fifth: "5", sixth: "6", seventh: "7", eighth: "8", ninth: "9", tenth: "10",
};
/** Abbreviation -> canonical token. "st" can mean street or saint, so it expands to both (see equivalent()). */
const CANON: Record<string, string> = {
  ave: "avenue", av: "avenue", aven: "avenue",
  blvd: "boulevard", boul: "boulevard",
  pl: "place", rd: "road", dr: "drive", ct: "court", ln: "lane", ter: "terrace", terr: "terrace",
  pkwy: "parkway", pky: "parkway", hwy: "highway", sq: "square", expy: "expressway", expwy: "expressway",
  cir: "circle", plz: "plaza", pk: "park", hts: "heights", brg: "bridge", aly: "alley",
  n: "north", s: "south", e: "east", w: "west",
  mt: "mount", ft: "fort", centre: "center",
};
const STREET_TYPES = new Set([
  "avenue", "street", "boulevard", "place", "road", "drive", "court", "lane", "terrace", "parkway", "highway", "square",
  "expressway", "circle", "plaza", "park", "heights", "bridge", "alley", "way", "walk", "path", "loop", "oval", "row", "slip",
]);

const norm = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "") // MARK'S -> marks
    .replace(/[^a-z0-9\-\s#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Street tokens: lowercase, ordinal suffix removed ("72nd" -> "72"), ordinal words to digits, abbreviations spelled out. */
export function streetTokens(s: string): string[] {
  return norm(s)
    .split(" ")
    .filter(Boolean)
    .map((t) => {
      const ord = /^(\d+)(st|nd|rd|th)$/.exec(t);
      if (ord) return ord[1]!;
      if (t in ORDINAL_WORDS) return ORDINAL_WORDS[t]!;
      return CANON[t] ?? t;
    });
}

/** True when an input token and a returned token name the same thing. "st" matches street and saint. */
function equivalent(a: string, b: string): boolean {
  if (a === b) return true;
  const pair = (x: string, y: string) => (a === x && b === y) || (a === y && b === x);
  return pair("st", "street") || pair("st", "saint");
}

const houseKey = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/\s+/g, "");
const isHouseNumber = (t: string) => /^\d+(-\d+)?[a-z]?$/i.test(t);

/** Split typed text into house number, street text, an optional borough claim and an optional zip. */
export function parseInput(raw: string): { house: string; street: string; borough: string | null; zip: string | null } {
  const text = raw.replace(/staten\s+island/gi, "statenisland");
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  let first = parts[0] ?? "";
  const rest = parts.slice(1).join(" ");
  let place = rest;
  if (parts.length === 1) {
    // No commas ("209 joralemon street brooklyn"): peel place words off the end, keeping at least one street word.
    const words = first.split(/\s+/);
    const peeled: string[] = [];
    while (words.length > 2) {
      const w = norm(words[words.length - 1]!);
      if (w in BOROUGH_WORDS || PLACE_NOISE.has(w) || /^\d{5}(-\d{4})?$/.test(w)) peeled.unshift(words.pop()!);
      else break;
    }
    first = words.join(" ");
    place = peeled.join(" ");
  }
  const placeNorm = norm(place);
  let borough: string | null = null;
  for (const [k, v] of Object.entries(BOROUGH_WORDS)) if (new RegExp(`(^| )${k}( |$)`).test(placeNorm)) borough = v;
  const zip = /(^| )(\d{5})(-\d{4})?( |$)/.exec(place)?.[2] ?? null;
  const toks = first.trim().split(/\s+/);
  const house = toks[0] && isHouseNumber(toks[0]) ? toks.shift()! : "";
  return { house, street: toks.join(" "), borough, zip };
}

export function checkAddress(input: string, cand: Candidate): AddressCheck {
  const reasons: string[] = [];
  const typed = parseInput(input);

  if (houseKey(typed.house) !== houseKey(cand.housenumber)) {
    reasons.push(
      typed.house === "" ? "no house number was given" : cand.housenumber ? "the house number differs" : "the match has no house number",
    );
  }

  const want = streetTokens(typed.street);
  const got = streetTokens(cand.street ?? "");
  const missing = want.filter((w) => !got.some((g) => equivalent(w, g)));
  const extra = got.filter((g) => !want.some((w) => equivalent(w, g)) && !STREET_TYPES.has(g));
  if (want.length === 0) reasons.push("no street name was given");
  else if (missing.length > 0 || extra.length > 0) reasons.push("the street name differs");

  if (typed.borough && cand.borough && typed.borough !== cand.borough) reasons.push("the borough differs");
  if (typed.zip && cand.postalcode && typed.zip !== cand.postalcode) reasons.push("the zip code differs");

  return { ok: reasons.length === 0, reasons, placeGiven: typed.borough !== null || typed.zip !== null };
}
