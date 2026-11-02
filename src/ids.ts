import { z } from "zod";

export const BOROUGHS: Record<string, string> = {
  "1": "Manhattan",
  "2": "Bronx",
  "3": "Brooklyn",
  "4": "Queens",
  "5": "Staten Island",
};

/**
 * Borough-level placeholder BINs (1000000, 2000000, ...) mean "building unknown" in the city data. Thousands of unrelated records
 * share them (verified live: HPD has 7,441 rows for 1000000), so they must never be treated as a building.
 */
export const isPlaceholderBin = (bin: string): boolean => /^[1-5]000000$/.test(bin);
export const isRealBin = (bin: unknown): bin is string => typeof bin === "string" && /^[1-5]\d{6}$/.test(bin) && !isPlaceholderBin(bin);
export const PLACEHOLDER_BIN_MESSAGE =
  'bin ends in 000000: that is a borough-level placeholder meaning "building unknown", not a real building, and thousands of unrelated records share it. ' +
  'Use resolve_property with the street address (e.g. "350 5th Ave, Manhattan") to get the building\'s real BIN.';

/**
 * Placeholder BBLs: block 00000 or 99999, or lot 0000, mean "block/lot unknown". Verified live 2026-11-02: DOB has 5,842 rows
 * (811 different BINs) with block 00000 and lot 00000, ECB 178 rows, and a few rows with block 99999. Thousands of unrelated
 * records share them, so they must never be treated as a tax lot.
 */
export const isPlaceholderBbl = (bbl: string): boolean => /^[1-5](00000|99999)\d{4}$/.test(bbl) || /^[1-5]\d{5}0000$/.test(bbl);
export const PLACEHOLDER_BBL_MESSAGE =
  'bbl has block 00000 or 99999, or lot 0000: those are placeholders meaning "block/lot unknown", not a real tax lot, and thousands of unrelated records share them. ' +
  'Use resolve_property with the street address (e.g. "350 5th Ave, Manhattan") to get the real BBL.';

/** BIN: 7 digits, first digit is the borough (1-5). Example: 1015862 (Empire State Building). */
export const binSchema = z.coerce // coerce: some clients send identifiers as JSON numbers
  .string({ error: "bin must be a 7-digit NYC Building Identification Number given as text, e.g. \"1015862\"." })
  .trim()
  .regex(/^[1-5]\d{6}$/, "bin must be exactly 7 digits starting with 1-5 (the borough), e.g. \"1015862\".")
  .refine((v) => !isPlaceholderBin(v), { error: PLACEHOLDER_BIN_MESSAGE })
  .describe("7-digit NYC Building Identification Number (BIN), e.g. \"1015862\". First digit is the borough (1-5).");

/** BBL: 10 digits = borough(1) + block(5) + lot(4). Hyphenated form 1-00835-0041 is also accepted. */
export const bblSchema = z.coerce
  .string({ error: "bbl must be a 10-digit Borough-Block-Lot number given as text, e.g. \"1008350041\"." })
  .trim()
  .regex(
    /^([1-5]\d{9}|[1-5]-\d{1,5}-\d{1,4})$/,
    "bbl must be exactly 10 digits (borough 1-5, block 5 digits, lot 4 digits), e.g. \"1008350041\" or \"1-00835-0041\".",
  )
  .refine((v) => !isPlaceholderBbl(normalizeBbl(v)), { error: PLACEHOLDER_BBL_MESSAGE })
  .describe("10-digit Borough-Block-Lot (BBL), e.g. \"1008350041\" (also accepts \"1-00835-0041\").");

/** Normalizes the hyphenated BBL form to 10 digits. Input must already have passed bblSchema. */
export function normalizeBbl(v: string): string {
  const m = /^([1-5])-(\d{1,5})-(\d{1,4})$/.exec(v);
  return m ? `${m[1]}${m[2]!.padStart(5, "0")}${m[3]!.padStart(4, "0")}` : v;
}

export const addressSchema = z
  .string({ error: "address must be text, e.g. \"350 5th Ave, Manhattan\"." })
  .trim()
  .min(5, "address is too short. Include house number, street and borough, e.g. \"350 5th Ave, Manhattan\".")
  .max(200, "address is too long (max 200 characters). Use the form \"350 5th Ave, Manhattan\".")
  // eslint-disable-next-line no-control-regex
  .refine((s) => !/[\u0000-\u001f\u007f]/.test(s), "address contains control characters. Use plain text such as \"350 5th Ave, Manhattan\".")
  .describe("NYC street address including borough, e.g. \"350 5th Ave, Manhattan\".");

export const statusSchema = z
  .enum(["open", "closed"], { error: "status must be \"open\" or \"closed\". Omit it to include both." })
  .optional()
  .describe("Filter by status: \"open\" or \"closed\". Omit for both.");

export function limitSchema(def: number, max: number) {
  return z.coerce
    .number({ error: `limit must be a whole number from 1 to ${max} (default ${def}).` })
    .int(`limit must be a whole number from 1 to ${max} (default ${def}).`)
    .min(1, `limit must be at least 1 (max ${max}).`)
    .max(max, `limit cannot exceed ${max}. Use status filters or ask for a summary instead of larger pages.`)
    .default(def)
    .describe(`Max records to return (1-${max}, default ${def}).`);
}

export interface BblParts {
  boro: string;
  block: string;
  lot: string;
}
export function splitBbl(bbl: string): BblParts {
  return { boro: bbl.slice(0, 1), block: bbl.slice(1, 6), lot: bbl.slice(6, 10) };
}
export function joinBbl(boro: unknown, block: unknown, lot: unknown): string | null {
  const b = String(boro ?? "").trim();
  const bl = String(block ?? "").trim();
  const l = String(lot ?? "").trim();
  // DOB/ECB store block and lot as 5-digit zero-padded text (lot "00041"); a BBL lot is 4 digits ("0041").
  if (!/^[1-5]$/.test(b) || !/^\d{1,5}$/.test(bl) || !/^\d{1,5}$/.test(l) || Number(l) > 9999) return null;
  const bbl = `${b}${bl.padStart(5, "0")}${String(Number(l)).padStart(4, "0")}`;
  return isPlaceholderBbl(bbl) ? null : bbl;
}
