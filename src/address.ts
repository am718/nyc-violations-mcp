/**
 * Compare what the caller typed with an address GeoSearch returned.
 *
 * GeoSearch always returns candidates, and scores right and wrong ones alike (confidence 0.8 / "fallback" for street
 * addresses; 1 / "exact" even for "Queens" -> a Bronx building named "QUEEN'S COURT"), so the score cannot tell a wrong
 * building from the right one (see docs/DATA.md). This module compares the fields that can: house number, street name,
 * street type, borough and zip. It never accepts a candidate on the strength of a street-type word ("court", "avenue")
 * alone: the street is split into its name ("core") and its type, and both must agree.
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
/** Words that name a place (city, state, county, country) but carry no street information. */
const PLACE_NOISE = new Set([
  "ny", "nyc", "nys", "usa", "us", "new", "york", "united", "states", "state", "city", "the", "of", "county", "kings",
  "richmond", "borough", "boro", "staten", "island", "america",
]);

const ORDINAL_WORDS: Record<string, string> = {
  first: "1", second: "2", third: "3", fourth: "4", fifth: "5", sixth: "6", seventh: "7", eighth: "8", ninth: "9", tenth: "10",
};
/** Abbreviation -> canonical token. "st" is resolved by position in splitStreet (street type at the end, Saint elsewhere). */
const CANON: Record<string, string> = {
  ave: "avenue", av: "avenue", aven: "avenue",
  blvd: "boulevard", boul: "boulevard",
  pl: "place", rd: "road", dr: "drive", ct: "court", ln: "lane", ter: "terrace", terr: "terrace",
  pkwy: "parkway", pky: "parkway", hwy: "highway", sq: "square", expy: "expressway", expwy: "expressway",
  cir: "circle", plz: "plaza", pk: "park", hts: "heights", brg: "bridge", aly: "alley", tpke: "turnpike",
  n: "north", s: "south", e: "east", w: "west",
  mt: "mount", ft: "fort", centre: "center",
};
/** Street-type words. Only the LAST token of a street can be its type; the rest is the street's name. */
const STREET_TYPES = new Set([
  "avenue", "street", "boulevard", "place", "road", "drive", "court", "lane", "terrace", "parkway", "highway", "square",
  "expressway", "circle", "plaza", "park", "heights", "bridge", "alley", "way", "walk", "path", "loop", "oval", "row", "slip",
  "turnpike",
]);

/** Remove invisible format characters (zero-width, bidi marks) and fold compatibility forms (fullwidth digits). */
const clean = (s: string) => s.normalize("NFKC").replace(/\p{Cf}/gu, "");

const norm = (s: string) =>
  clean(s)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’‘`]/g, "") // MARK'S -> marks
    .replace(/[^a-z0-9\-\s#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Optimal string alignment distance (Levenshtein plus adjacent transposition). */
function editDistance(a: string, b: string): number {
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2]![j - 2]! + 1);
      d[i]![j] = v;
    }
  }
  return d[a.length]![b.length]!;
}

/** The borough a normalized word names, allowing small misspellings ("quens", "brooklin", "manhatan"). */
export function boroughOf(word: string): string | null {
  if (word in BOROUGH_WORDS) return BOROUGH_WORDS[word]!;
  if (word.length < 4) return null;
  for (const [k, v] of Object.entries(BOROUGH_WORDS)) {
    if (k.length < 5) continue; // short forms ("bklyn") only exactly
    const max = k.length >= 8 ? 2 : 1;
    if (Math.abs(k.length - word.length) <= max && editDistance(word, k) <= max) return v;
  }
  return null;
}

const isZip = (t: string) => /^\d{5}(-\d{4})?$/.test(t);
const isHouseNumber = (t: string) => /^\d+(-\d+)?[a-z]?$/i.test(t);
const isPlaceWord = (t: string) => boroughOf(t) !== null || PLACE_NOISE.has(t) || isZip(t);

/** The boroughs named in normalized place words, also across two words ("staten iland" -> Staten Island). */
function boroughsIn(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const pair = i + 1 < tokens.length ? boroughOf(tokens[i]! + tokens[i + 1]!) : null;
    if (pair === "Staten Island") {
      out.push(pair);
      i++;
      continue;
    }
    const b = boroughOf(tokens[i]!);
    if (b) out.push(b);
  }
  return out;
}

/**
 * Non-null when the input names only a place (a borough, the city, a zip code, optionally with a house number) and no street:
 * "Queens", "Queens, NY", "Brookyln", "New York", "10001", "50 Queens". Such input never identifies a building.
 */
export function placeOnlyReason(raw: string): string | null {
  const toks = norm(raw).split(" ").filter(Boolean);
  if (toks.length === 0) return null; // nothing readable (e.g. only symbols): checkAddress reports "no street name"
  const rest = toks.length > 1 && isHouseNumber(toks[0]!) && !isZip(toks[0]!) ? toks.slice(1) : toks;
  if (rest.every((t, i) => isPlaceWord(t) || (i + 1 < rest.length && boroughOf(t + rest[i + 1]) !== null) || (i > 0 && boroughOf(rest[i - 1] + t) !== null))) {
    return "only a borough, city or zip code was given, not a street";
  }
  return null;
}

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

/** Split street tokens into the street's name ("core") and its type (the last token, if it is a street-type word). */
export function splitStreet(tokens: string[]): { core: string[]; type: string | null } {
  const last = tokens[tokens.length - 1];
  const hasType = last !== undefined && (STREET_TYPES.has(last) || last === "st");
  const type = hasType ? (last === "st" ? "street" : last) : null;
  const core = (hasType ? tokens.slice(0, -1) : tokens).map((t) => (t === "st" ? "saint" : t));
  return { core, type };
}

const houseKey = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/\s+/g, "");

/** Split typed text into house number, street text, an optional borough claim and an optional zip. */
export function parseInput(raw: string): { house: string; street: string; borough: string | null; boroughs: string[]; zip: string | null } {
  const text = clean(raw);
  const parts = text.split(",").map((p) => p.trim()).filter(Boolean);
  let first = parts[0] ?? "";
  let place = parts.slice(1).join(" ");
  if (parts.length === 1) {
    // No commas ("209 joralemon street brooklyn"): peel place words off the end, keeping at least one street word.
    const words = first.split(/\s+/);
    const peeled: string[] = [];
    while (words.length > 2) {
      const w = norm(words[words.length - 1]!);
      const pairWithPrev = words.length > 3 ? boroughOf(norm(words[words.length - 2]!) + w) : null;
      if (pairWithPrev === "Staten Island") peeled.unshift(...words.splice(-2));
      else if (isPlaceWord(w)) peeled.unshift(words.pop()!);
      else break;
    }
    first = words.join(" ");
    place = peeled.join(" ");
  }
  const placeTokens = norm(place).split(" ").filter(Boolean);
  const boroughs = boroughsIn(placeTokens);
  const borough = boroughs.length > 0 ? boroughs[boroughs.length - 1]! : null;
  const zip = placeTokens.find(isZip)?.slice(0, 5) ?? null;
  const toks = first.trim().split(/\s+/);
  const house = toks[0] && isHouseNumber(toks[0]) ? toks.shift()! : "";
  return { house, street: toks.join(" "), borough, boroughs: [...new Set(boroughs)], zip };
}

export function checkAddress(input: string, cand: Candidate): AddressCheck {
  const reasons: string[] = [];
  const typed = parseInput(input);
  const placeGiven = typed.borough !== null || typed.zip !== null;

  const placeOnly = placeOnlyReason(input);
  if (placeOnly) return { ok: false, reasons: [placeOnly], placeGiven };

  if (houseKey(typed.house) !== houseKey(cand.housenumber)) {
    reasons.push(
      typed.house === "" ? "no house number was given" : cand.housenumber ? "the house number differs" : "the match has no house number",
    );
  }

  // Street: the name tokens must be the same, in order, and the street types must agree. A type word never matches by itself.
  const want = splitStreet(streetTokens(typed.street));
  const got = splitStreet(streetTokens(cand.street ?? ""));
  if (want.core.length === 0) reasons.push("no street name was given");
  else if (want.core.length !== got.core.length || want.core.some((t, i) => t !== got.core[i])) reasons.push("the street name differs");
  else if (want.type !== got.type) {
    reasons.push(want.type === null ? `no street type was given (the match is a ${got.type ?? "street"})` : "the street type differs");
  }

  // A typed borough or zip must be confirmed by the candidate: a candidate without one cannot be checked, so it is refused.
  if (typed.boroughs.length > 1) reasons.push("more than one borough was given");
  else if (typed.borough && !cand.borough) reasons.push("the match has no borough to compare");
  else if (typed.borough && typed.borough !== cand.borough) reasons.push("the borough differs");
  if (typed.zip && !cand.postalcode) reasons.push("the match has no zip code to compare");
  else if (typed.zip && typed.zip !== cand.postalcode) reasons.push("the zip code differs");

  return { ok: reasons.length === 0, reasons, placeGiven };
}
