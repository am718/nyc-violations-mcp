import { GEOSEARCH_SOURCE_NAME, GEOSEARCH_URL, SOURCE_NAME, DATASETS } from "./config.js";
import { ToolError } from "./errors.js";
import type { HttpClient } from "./http.js";
import { BOROUGHS, isPlaceholderBbl, isPlaceholderBin, isRealBin, joinBbl } from "./ids.js";
import { cleanText, isRow } from "./normalize.js";
import { queries, type SocrataClient } from "./socrata.js";
import type { SourceRef } from "./format.js";

export interface Property {
  address: string | null;
  bin: string;
  bbl: string;
  borough: string | null;
  other_bins_on_lot?: string[];
  match?: { confidence: number | null; match_type: string | null; note?: string };
  sources: SourceRef[];
}

export interface Resolver {
  http: HttpClient;
  socrata: SocrataClient;
}

const gs = (fetchedAt: string): SourceRef => ({
  source: GEOSEARCH_SOURCE_NAME,
  dataset_id: null,
  dataset_name: "Geocoder (Pelias over NYC PAD)",
  fetched_at: fetchedAt,
});
const ds = (key: "dob" | "hpd", fetchedAt: string): SourceRef => ({
  source: SOURCE_NAME,
  dataset_id: DATASETS[key].id,
  dataset_name: DATASETS[key].name,
  fetched_at: fetchedAt,
});

export async function resolveAddress(r: Resolver, address: string): Promise<Property> {
  const url = `${GEOSEARCH_URL}?${new URLSearchParams({ text: address, size: "1" }).toString()}`;
  const { json, fetchedAt } = await r.http.getJson(url);
  const features = isRow(json) && Array.isArray(json.features) ? json.features : [];
  const props = isRow(features[0]) && isRow((features[0] as Record<string, unknown>).properties)
    ? ((features[0] as Record<string, unknown>).properties as Record<string, unknown>)
    : undefined;
  if (!props) {
    throw new ToolError(
      `No NYC address match for "${cleanText(address, 80)}". Use the form "<house number> <street>, <borough>", ` +
        'e.g. "350 5th Ave, Manhattan", or pass a bin/bbl instead.',
    );
  }
  const pad = isRow(props.addendum) && isRow((props.addendum as Record<string, unknown>).pad)
    ? ((props.addendum as Record<string, unknown>).pad as Record<string, unknown>)
    : undefined;
  if (typeof pad?.bin === "string" && isPlaceholderBin(pad.bin)) {
    throw new ToolError(
      `"${cleanText(address, 80)}" matched "${cleanText(props.label, 80)}", but the city lists no real building there (its BIN is a borough-level placeholder, ${pad.bin}). ` +
        "Check the address, or pass a bbl if you know the tax lot.",
    );
  }
  const bin = isRealBin(pad?.bin) ? pad.bin : null;
  const bbl = typeof pad?.bbl === "string" && /^[1-5]\d{9}$/.test(pad.bbl) && !isPlaceholderBbl(pad.bbl) ? pad.bbl : null;
  if (!bin || !bbl) {
    throw new ToolError(
      `"${cleanText(address, 80)}" matched "${cleanText(props.label, 80)}" but not a specific building (no BIN/BBL). ` +
        'Add the house number and borough, e.g. "350 5th Ave, Manhattan".',
    );
  }
  const confidence = typeof props.confidence === "number" ? props.confidence : null;
  return {
    address: cleanText(props.label, 120),
    bin,
    bbl,
    borough: cleanText(props.borough, 30) ?? BOROUGHS[bin[0]!] ?? null,
    match: {
      confidence,
      match_type: cleanText(props.match_type, 30),
      ...(confidence !== null && confidence < 0.8
        ? { note: "Low-confidence geocode: verify the matched address before relying on the results." }
        : {}),
    },
    sources: [gs(fetchedAt)],
  };
}

const fmt = (n: unknown, s: unknown) => cleanText([n, s].filter((x) => typeof x === "string").join(" "), 120);

export async function resolveBin(r: Resolver, bin: string): Promise<Property> {
  const dob = await r.socrata.query(queries.dobLotForBin(bin));
  const top = dob.rows.find(isRow) as Record<string, unknown> | undefined;
  const bbl = top ? joinBbl(top.boro, top.block, top.lot) : null;
  if (top && bbl) {
    return {
      address: fmt(top.house_number, top.street),
      bin,
      bbl,
      borough: BOROUGHS[bin[0]!] ?? null,
      sources: [ds("dob", dob.fetchedAt)],
    };
  }
  const hpd = await r.socrata.query(queries.hpdForBin(bin));
  const h = hpd.rows.find(isRow) as Record<string, unknown> | undefined;
  const hb = typeof h?.bbl === "string" && /^[1-5]\d{9}$/.test(h.bbl) && !isPlaceholderBbl(h.bbl) ? h.bbl : null;
  if (h && hb) {
    return {
      address: fmt(h.housenumber, h.streetname),
      bin,
      bbl: hb,
      borough: BOROUGHS[bin[0]!] ?? null,
      sources: [ds("dob", dob.fetchedAt), ds("hpd", hpd.fetchedAt)],
    };
  }
  if (top) {
    throw new ToolError(
      `BIN ${bin} appears in DOB records, but only with an unknown block/lot (placeholder), so its BBL could not be derived. ` +
        "The get_dob_violations and get_ecb_violations tools still work with this BIN; for a summary use the street address.",
    );
  }
  throw new ToolError(
    `BIN ${bin} has no records in the DOB or HPD violation datasets, so its BBL could not be derived. ` +
      "Check the BIN, or call resolve_property with the street address instead.",
  );
}

export async function resolveBbl(r: Resolver, bbl: string): Promise<Property> {
  const dob = await r.socrata.query(queries.dobBinsForBbl(bbl));
  let rows = dob.rows.filter(isRow) as Record<string, unknown>[];
  const sources = [ds("dob", dob.fetchedAt)];
  let key: "house_number" | "housenumber" = "house_number";
  let street: "street" | "streetname" = "street";
  if (rows.length === 0) {
    const hpd = await r.socrata.query(queries.hpdBinsForBbl(bbl));
    sources.push(ds("hpd", hpd.fetchedAt));
    rows = hpd.rows.filter(isRow) as Record<string, unknown>[];
    key = "housenumber";
    street = "streetname";
  }
  const first = rows.find((x) => isRealBin(x.bin));
  if (!first && rows.some((x) => typeof x.bin === "string" && isPlaceholderBin(x.bin))) {
    throw new ToolError(
      `BBL ${bbl} only appears in the data with a borough-level placeholder BIN (building unknown), so no real building could be identified. ` +
        "Use resolve_property with the street address instead.",
    );
  }
  if (!first) {
    throw new ToolError(
      `BBL ${bbl} has no records in the DOB or HPD violation datasets, so its BIN could not be derived. ` +
        "Check the BBL, or call resolve_property with the street address instead.",
    );
  }
  const bins = [...new Set(rows.map((x) => x.bin).filter(isRealBin))];
  const primary = first.bin as string;
  return {
    address: fmt(first[key], first[street]),
    bin: primary,
    bbl,
    borough: BOROUGHS[bbl[0]!] ?? null,
    ...(bins.length > 1 ? { other_bins_on_lot: bins.filter((b) => b !== primary) } : {}),
    sources,
  };
}

/**
 * How many OTHER buildings (BINs) share this lot, as seen in DOB and HPD records.
 * Approximate: it is max(distinct BINs in DOB, distinct BINs in HPD) - 1, so it can undercount
 * buildings that have no records in either dataset.
 */
export async function otherBinsOnLot(r: Resolver, bbl: string): Promise<{ count: number; sources: SourceRef[] }> {
  const dob = await r.socrata.count(queries.distinctBinsOnLot("dob", bbl));
  const hpd = await r.socrata.count(queries.distinctBinsOnLot("hpd", bbl));
  return { count: Math.max(0, Math.max(dob.n, hpd.n) - 1), sources: [ds("dob", dob.fetchedAt), ds("hpd", hpd.fetchedAt)] };
}

/** Resolve exactly what the caller gave; if both bin and bbl are given they must agree. */
export async function resolveProperty(
  r: Resolver,
  args: { address?: string; bin?: string; bbl?: string },
): Promise<Property> {
  const { address, bin, bbl } = args;
  if (address !== undefined && (bin !== undefined || bbl !== undefined)) {
    throw new ToolError("Pass either address OR bin/bbl, not both. To use an address, omit bin and bbl.");
  }
  if (address !== undefined) return resolveAddress(r, address);
  if (bin === undefined && bbl === undefined) {
    throw new ToolError(
      'Provide one of: address (e.g. "350 5th Ave, Manhattan"), bin (e.g. "1015862") or bbl (e.g. "1008350041").',
    );
  }
  if (bin !== undefined && bbl !== undefined) {
    if (bin[0] !== bbl[0]) {
      throw new ToolError(
        `bin ${bin} is in ${BOROUGHS[bin[0]!]} but bbl ${bbl} is in ${BOROUGHS[bbl[0]!]}. They cannot be the same property. ` +
          "Pass only one of them, or use resolve_property with the address to get the matching pair.",
      );
    }
    const fromBin = await resolveBin(r, bin);
    const lotBins = await resolveBbl(r, bbl).catch(() => null);
    const binOnLot = lotBins && (lotBins.bin === bin || lotBins.other_bins_on_lot?.includes(bin));
    if (fromBin.bbl !== bbl || (lotBins && !binOnLot)) {
      throw new ToolError(
        `bin ${bin} belongs to bbl ${fromBin.bbl}, not ${bbl}. Pass only one of bin or bbl, ` +
          `or use the matching pair (bin ${bin}, bbl ${fromBin.bbl}).`,
      );
    }
    return fromBin;
  }
  return bin !== undefined ? resolveBin(r, bin) : resolveBbl(r, bbl!);
}
