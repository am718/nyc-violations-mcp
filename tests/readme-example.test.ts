import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The README's first-screen example must be a real excerpt of recorded tool output, not invented numbers.
const root = join(__dirname, "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const block = readme.match(/<!-- example-source: (\S+)[^>]*-->\s*```json\n([\s\S]*?)\n```/);

/** Paths in `excerpt` whose value is not in `actual` (objects: same keys; arrays: each element equals one of actual's). */
function notIn(excerpt: unknown, actual: unknown, path = "$"): string[] {
  if (Array.isArray(excerpt)) {
    if (!Array.isArray(actual)) return [path];
    return excerpt.flatMap((e, i) => (actual.some((a) => notIn(e, a).length === 0) ? [] : [`${path}[${i}]`]));
  }
  if (excerpt !== null && typeof excerpt === "object") {
    if (actual === null || typeof actual !== "object" || Array.isArray(actual)) return [path];
    return Object.entries(excerpt).flatMap(([k, v]) => (k in actual ? notIn(v, (actual as Record<string, unknown>)[k], `${path}.${k}`) : [`${path}.${k}`]));
  }
  return excerpt === actual ? [] : [path];
}

describe("README example", () => {
  it("names its source and is valid JSON", () => {
    expect(block).not.toBeNull();
    expect(() => JSON.parse(block![2]!)).not.toThrow();
  });

  it("every value in it is in the recorded tool output it names", () => {
    const evidence = JSON.parse(readFileSync(join(root, block![1]!), "utf8")) as { content: { text: string }[] };
    const actual = JSON.parse(evidence.content[0]!.text);
    const excerpt = JSON.parse(block![2]!);
    expect(Object.keys(excerpt).length).toBeGreaterThan(0);
    expect(notIn(excerpt, actual)).toEqual([]);
  });

  it("the checker rejects a changed number (so the test above can fail)", () => {
    expect(notIn({ agencies: { DOB: { open: 8 } } }, { agencies: { DOB: { open: 7 } } })).toEqual(["$.agencies.DOB.open"]);
    expect(notIn({ notes: ["invented"] }, { notes: ["real"] })).toEqual(["$.notes[0]"]);
  });

  it("is on the first screen, before the long explanation", () => {
    const line = readme.slice(0, readme.indexOf("<!-- example-source:")).split("\n").length;
    expect(line).toBeLessThan(20);
    expect(readme.indexOf("<!-- example-source:")).toBeLessThan(readme.indexOf("## Tools"));
    expect(readme.indexOf("<!-- example-source:")).toBeLessThan(readme.indexOf("## Install and run"));
  });
});
