/**
 * Redacts files written by scripts/inspector-check.sh (MCP Inspector CLI output) with the recorder's rules from
 * scripts/redact.ts: respondent_* placeholders, names signed before CERT/LIC, certificate numbers and the hand-redacted word
 * list. Tool results arrive as compact JSON text in `content[].text`; that text is parsed, redacted and re-serialised the
 * way the server wrote it, so an already clean file comes out byte-for-byte unchanged.
 * Run: node dist/scripts/redact-evidence.js <file>...   (rewrites each file in place; prints only "redacted"/"unchanged")
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { REDACTED_WORD_HASHES, redactText, respondentPlaceholder } from "./redact.js";

/** Redact any JSON value from Inspector output. `key` is the property name the value sits under. */
export function redactEvidenceValue(v: unknown, key = "", words: ReadonlySet<string> = REDACTED_WORD_HASHES): unknown {
  if (key.startsWith("respondent_")) return respondentPlaceholder(key);
  if (typeof v === "string") {
    // MCP tool results: content[].text holds the tool's JSON response as a string.
    if (key === "text" && /^\s*[[{]/.test(v)) {
      try {
        return JSON.stringify(redactEvidenceValue(JSON.parse(v), "", words));
      } catch {
        // not JSON (an error message): plain text below
      }
    }
    return redactText(v, words);
  }
  if (Array.isArray(v)) return v.map((x) => redactEvidenceValue(x, "", words));
  if (v !== null && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, redactEvidenceValue(x, k, words)]));
  }
  return v;
}

/** Redact one Inspector output file's contents (2-space JSON, as the Inspector CLI writes it). Non-JSON is redacted as text. */
export function redactEvidence(raw: string, words: ReadonlySet<string> = REDACTED_WORD_HASHES): string {
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return redactText(raw, words);
  }
  return JSON.stringify(redactEvidenceValue(doc, "", words), null, 2) + (raw.endsWith("\n") ? "\n" : "");
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const file of process.argv.slice(2)) {
    const raw = readFileSync(file, "utf8");
    const out = redactEvidence(raw);
    if (out !== raw) writeFileSync(file, out);
    console.error(`${file}: ${out === raw ? "unchanged" : "redacted"}`);
  }
}
