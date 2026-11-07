import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redactEvidence } from "../scripts/redact-evidence.js";
import { REDACTED_WORD_HASHES, redactText, wordHash } from "../scripts/redact.js";

// scripts/inspector-check.sh regenerates docs/evidence from live data. On 2026-11-03 that brought back two words that had been
// redacted by hand in the fixtures. The script now redacts its output with the recorder's rules and word list.
const root = join(__dirname, "..");
const read = (...p: string[]) => readFileSync(join(root, ...p), "utf8");
const evidenceDir = join(root, "docs", "evidence");
const evidence = readdirSync(evidenceDir)
  .filter((f) => f.startsWith("inspector-") && f.endsWith(".json"))
  .map((f) => ({ f, raw: readFileSync(join(evidenceDir, f), "utf8") }));
const fixtureFiles = [
  ...readdirSync(join(root, "tests", "fixtures", "http")).map((f) => join(root, "tests", "fixtures", "http", f)),
  ...readdirSync(join(root, "tests", "fixtures")).filter((f) => f.endsWith(".json")).map((f) => join(root, "tests", "fixtures", f)),
];
const SYNTHETIC = new Set([wordHash("ZQXWORD"), wordHash("FOO-BARQ")]);

describe("hand-redacted word list (scripts/redact.ts)", () => {
  it("holds hashes, never the words", () => {
    expect(REDACTED_WORD_HASHES.size).toBeGreaterThanOrEqual(9);
    for (const h of REDACTED_WORD_HASHES) expect(h).toMatch(/^[0-9a-f]{16}$/);
  });

  it("redacts a listed word in any case, a listed hyphenated word whole, and a listed part of a compound; nothing else", () => {
    expect(redactText("A zqxword TO WORK ON THE ZQXWORD.", SYNTHETIC)).toBe("A REDACTED TO WORK ON THE REDACTED.");
    expect(redactText("USING A FOO-BARQ HOIST", SYNTHETIC)).toBe("USING A REDACTED HOIST");
    expect(redactText("SELF-ZQXWORD DOOR", SYNTHETIC)).toBe("SELF-REDACTED DOOR");
    expect(redactText("ZQXWORDS ZQX WORD FOO-BAR", SYNTHETIC)).toBe("ZQXWORDS ZQX WORD FOO-BAR");
    expect(redactText("BY AB CDE CERT#123456 A ZQXWORD", SYNTHETIC)).toBe("BY REDACTED CERT#REDACTED A REDACTED");
  });

  it("no tracked file contains a listed word (fixtures, evidence, docs, code, tests)", () => {
    const hits: string[] = [];
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
        [".git", "node_modules", "dist"].includes(d.name) ? [] : d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)],
      );
    const all = walk(root);
    expect(all.length).toBeGreaterThan(fixtureFiles.length + evidence.length);
    for (const f of all) {
      const text = readFileSync(f, "utf8");
      for (const w of text.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g) ?? []) {
        if (REDACTED_WORD_HASHES.has(wordHash(w)) || w.split(/['-]/).some((p) => REDACTED_WORD_HASHES.has(wordHash(p)))) {
          hits.push(f.slice(root.length + 1));
        }
      }
    }
    expect(hits).toEqual([]);
  });
});

describe("evidence redaction (scripts/redact-evidence.ts)", () => {
  it("redacts inside tool results exactly like the recorder: signed names, certificate numbers, listed words, respondent fields", () => {
    const tool = { violations: [{ description: "INSP BY AB CDE CERT#123456 USING A ZQXWORD", respondent_name: "SOMEONE", respondent_house_number: "1" }] };
    const raw = JSON.stringify({ content: [{ type: "text", text: JSON.stringify(tool) }] }, null, 2) + "\n";
    const out = JSON.parse(redactEvidence(raw, SYNTHETIC)) as { content: { text: string }[] };
    expect(JSON.parse(out.content[0]!.text)).toEqual({
      violations: [{ description: "INSP BY REDACTED CERT#REDACTED USING A REDACTED", respondent_name: "RESPONDENT NAME REDACTED", respondent_house_number: "REDACTED" }],
    });
  });

  it("redacts plain-text tool errors and non-JSON files as text", () => {
    const raw = JSON.stringify({ content: [{ type: "text", text: "Error: FILED BY QQ RRRR LIC 123456" }], isError: true }, null, 2) + "\n";
    expect(JSON.parse(redactEvidence(raw)).content[0].text).toBe("Error: FILED BY REDACTED LIC REDACTED");
    expect(redactEvidence("not json BY XX YYYY CERT#1234567")).toBe("not json BY REDACTED CERT#REDACTED");
  });

  it("leaves every committed evidence file byte-for-byte unchanged (already clean, and no reformatting)", () => {
    expect(evidence.length).toBeGreaterThanOrEqual(12);
    expect(evidence.filter((e) => redactEvidence(e.raw) !== e.raw).map((e) => e.f)).toEqual([]);
  });

  it("repairs the 2026-11-03 regression: a hand-redacted word put back into the ECB evidence is removed again", () => {
    const e = evidence.find((x) => x.f === "inspector-get_ecb_violations.json")!;
    const doc = JSON.parse(e.raw) as { content: { text: string }[] };
    const tool = JSON.parse(doc.content[0]!.text) as { violations: { description?: string }[] };
    const v = tool.violations.find((x) => typeof x.description === "string" && x.description.includes(" A REDACTED "));
    expect(v).toBeDefined();
    v!.description = v!.description!.replace(" A REDACTED ", " A ZQXWORD ");
    doc.content[0]!.text = JSON.stringify(tool);
    const leaked = JSON.stringify(doc, null, 2) + "\n";
    expect(leaked).not.toBe(e.raw);
    expect(redactEvidence(leaked, new Set([...REDACTED_WORD_HASHES, wordHash("ZQXWORD")]))).toBe(e.raw);
  });
});

describe("one rule set for fixtures and evidence", () => {
  it("the recorder and the evidence redactor both use scripts/redact.ts", () => {
    expect(read("scripts", "record-fixtures.ts")).toMatch(/import \{ redact \} from "\.\/redact\.js";/);
    expect(read("scripts", "redact.ts")).toMatch(/else if \(typeof r\[k\] === "string"\) r\[k\] = redactText\(r\[k\] as string\);/);
    expect(read("scripts", "redact-evidence.ts")).toMatch(/from "\.\/redact\.js";/);
  });

  it("scripts/inspector-check.sh redacts every file it writes and then runs the redaction checks, failing if they fail", () => {
    const sh = read("scripts", "inspector-check.sh");
    expect(sh).toMatch(/insp "\$@" 2>\/dev\/null > "docs\/evidence\/\$out\.json"; local code=\$\?\n\s+local red; red=\$\(node dist\/scripts\/redact-evidence\.js "docs\/evidence\/\$out\.json"/);
    // every output goes through run(): no other line writes into docs/evidence
    expect(sh.split("\n").filter((l) => /> "?docs\/evidence/.test(l))).toHaveLength(1);
    expect(sh).toMatch(/if npx vitest run tests\/redaction\.test\.ts tests\/evidence-redaction\.test\.ts[^\n]*; then\n[\s\S]*?else\n[\s\S]*?exit 1\nfi\n$/);
  });
});
