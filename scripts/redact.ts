/**
 * Redaction applied to every response body before scripts/record-fixtures.ts saves it as a test fixture.
 * Kept in its own module so tests can check it without running the recorder (which deletes and re-records fixtures).
 */

/**
 * A name typed before a certificate or licence marker ("... BY <NAME> CERT#1234567"): staff and professionals sign
 * disposition comments this way. Up to six capitalised words between "BY" and CERT/LIC are replaced by one REDACTED.
 */
const SIGNED_BY = /\bBY\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,5}\s+(?=(?:CERT|LIC)(?:\b|\s*#))/g;
/** A certificate or licence number. */
const CERT_NUMBER = /\b(CERT|LIC)(\s*#?\s*)\d{4,}/gi;

/** Redact one free-text value. */
export function redactText(s: string): string {
  return s.replace(SIGNED_BY, "BY REDACTED ").replace(CERT_NUMBER, "$1$2REDACTED");
}

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
      if (k.startsWith("respondent_")) r[k] = k === "respondent_name" ? "RESPONDENT NAME REDACTED" : "REDACTED";
      // Names in other positions cannot be found by a rule: review newly recorded descriptions by hand (see docs/DATA.md).
      else if (typeof r[k] === "string") r[k] = redactText(r[k] as string);
    }
  }
  return JSON.stringify(json);
}
