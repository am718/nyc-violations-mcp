/**
 * Redaction applied to every response body before scripts/record-fixtures.ts saves it as a test fixture, and (through
 * scripts/redact-evidence.ts) to every file scripts/inspector-check.sh writes to docs/evidence/. One module, so fixtures and
 * evidence are redacted the same way. Kept separate so tests can check it without running the recorder.
 */
import { createHash } from "node:crypto";

/**
 * A name typed before a certificate or licence marker ("... BY <NAME> CERT#1234567"): staff and professionals sign
 * disposition comments this way. Up to six capitalised words between "BY" and CERT/LIC are replaced by one REDACTED.
 */
const SIGNED_BY = /\bBY\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,5}\s+(?=(?:CERT|LIC)(?:\b|\s*#))/g;
/** A certificate or licence number. */
const CERT_NUMBER = /\b(CERT|LIC)(\s*#?\s*)\d{4,}/gi;

/**
 * Words removed by hand in the 2026-11-02 review of fixture free text (unusual words in free-form fields; see docs/DATA.md),
 * stored as the first 16 hex digits of sha256(WORD IN UPPER CASE) so the repository never contains the words themselves.
 * Recovered on 2026-11-07 by aligning the live records behind the committed fixtures with the redacted fixtures.
 */
export const REDACTED_WORD_HASHES: ReadonlySet<string> = new Set([
  "853f25206bbfc847", "14224fb8aaf2cee7", "3b4c07f7257ebd21", "80e3872b2073cc36", "e8d7ebb732ef1550",
  "caeb862beb132e89", "b4a44443cd9b6f5e", "f1b1d88c724a1c75", "bf6fa53aac12a401",
]);
const hashes = new Map<string, string>();
/** First 16 hex digits of sha256 of the upper-cased word (memoised). */
export function wordHash(word: string): string {
  const w = word.toUpperCase();
  let h = hashes.get(w);
  if (h === undefined) {
    h = createHash("sha256").update(w).digest("hex").slice(0, 16);
    hashes.set(w, h);
  }
  return h;
}

/** A word: letter/digit runs, optionally joined by hyphens or apostrophes ("FIRE-RETARDANT", "OWNER'S"). */
const WORD = /[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g;
const RUN = /[A-Za-z0-9]+/g;

/**
 * Redact one free-text value: names signed before CERT/LIC, certificate numbers, and any listed word. A joined word is
 * redacted whole if its hash is listed (two of the hand-redacted words are hyphenated); otherwise each listed part is.
 */
export function redactText(s: string, words: ReadonlySet<string> = REDACTED_WORD_HASHES): string {
  const ruled = s.replace(SIGNED_BY, "BY REDACTED ").replace(CERT_NUMBER, "$1$2REDACTED");
  if (words.size === 0) return ruled;
  return ruled.replace(WORD, (w) => (words.has(wordHash(w)) ? "REDACTED" : w.replace(RUN, (part) => (words.has(wordHash(part)) ? "REDACTED" : part))));
}

/** Placeholder for a respondent identity field (ECB: names/addresses of people and businesses). */
export const respondentPlaceholder = (key: string): string => (key === "respondent_name" ? "RESPONDENT NAME REDACTED" : "REDACTED");

/** Replace respondent identity fields (ECB: names/addresses of people and businesses) with placeholders, and redact free text. */
export function redact(body: string): string {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return body;
  }
  if (!Array.isArray(json)) return body;
  for (const row of json) {
    if (typeof row !== "object" || row === null) continue;
    for (const k of Object.keys(row)) {
      const r = row as Record<string, unknown>;
      if (k.startsWith("respondent_")) r[k] = respondentPlaceholder(k);
      // Names in other positions cannot be found by a rule: review newly recorded descriptions by hand (see docs/DATA.md)
      // and add any word removed by hand to REDACTED_WORD_HASHES.
      else if (typeof r[k] === "string") r[k] = redactText(r[k] as string);
    }
  }
  return JSON.stringify(json);
}
