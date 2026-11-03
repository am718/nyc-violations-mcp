import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { redact, redactText } from "../scripts/redact.js";

// Every recorded fixture and every evidence file: the redaction must hold in what is committed, not only in the recorder.
const root = join(__dirname, "..");
const files = [
  ...readdirSync(join(root, "tests", "fixtures", "http")).map((f) => join(root, "tests", "fixtures", "http", f)),
  ...readdirSync(join(root, "tests", "fixtures")).filter((f) => f.endsWith(".json")).map((f) => join(root, "tests", "fixtures", f)),
  ...readdirSync(join(root, "docs", "evidence")).map((f) => join(root, "docs", "evidence", f)),
];
const text = (f: string) => readFileSync(f, "utf8");

describe("redaction rule (synthetic strings)", () => {
  it("removes a name signed before a certificate marker, and the number", () => {
    const out = redactText("PPN203 AOC SUB 012822 BY XX YYYY               ZZZZ WWWW CERT#1234567");
    expect(out).toBe("PPN203 AOC SUB 012822 BY REDACTED CERT#REDACTED");
  });
  it("also for LIC and 'CERT #' spacing; leaves text without a marker alone", () => {
    expect(redactText("FILED BY QQ RRRR LIC 123456")).toBe("FILED BY REDACTED LIC REDACTED");
    expect(redactText("SIGNED BY AB CDE CERT # 98765")).toBe("SIGNED BY REDACTED CERT # REDACTED");
    expect(redactText("DELETED BY ABC ON 03/16/2011 BECAUSE WRONG ADDR")).toBe("DELETED BY ABC ON 03/16/2011 BECAUSE WRONG ADDR");
  });
  it("redact() applies it to every string field and placeholders respondent fields", () => {
    const body = JSON.stringify([{ disposition_comments: "BY XX YYYY CERT#1234567", respondent_name: "SOMEONE", respondent_house_number: "1" }]);
    expect(JSON.parse(redact(body))).toEqual([
      { disposition_comments: "BY REDACTED CERT#REDACTED", respondent_name: "RESPONDENT NAME REDACTED", respondent_house_number: "REDACTED" },
    ]);
  });
});

describe("committed fixtures and evidence", () => {
  it("covers a real number of files", () => expect(files.length).toBeGreaterThan(100));
  for (const [what, re] of [
    ["letters directly adjacent to REDACTED", /[A-Za-z]REDACTED|REDACTED[A-Za-z]/],
    ["words left between BY and a CERT/LIC marker", /\bBY\s+(?!REDACTED\b)[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,5}\s+(?:REDACTED\s+)*(?:CERT|LIC)(?:\b|\s*#)/],
    ["certificate or licence numbers", /\b(CERT|LIC)\s*#?\s*\d{4,}/i],
    ["respondent values other than the placeholders", /\\?"respondent_[a-z_]+\\?":\s*\\?"(?!REDACTED\\?"|RESPONDENT NAME REDACTED\\?")/],
  ] as [string, RegExp][]) {
    it(`no ${what}`, () => {
      const hits = files.filter((f) => re.test(text(f))).map((f) => f.slice(root.length + 1));
      expect(hits).toEqual([]);
    });
  }
});
