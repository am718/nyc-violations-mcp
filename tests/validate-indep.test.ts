import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { IndependentQueryError, independentCount, parseCount, type CountResponse } from "../scripts/independent-count.js";

// scripts/validate.ts recounts with plain Socrata queries. A failed or malformed upstream response used to become NaN and
// was reported as a "MISMATCH". These tests fake the failures.
const reply = (status: number, body: string): CountResponse => ({ ok: status >= 200 && status < 300, status, text: async () => body });
function fake(script: (CountResponse | Error)[]) {
  const delays: number[] = [];
  let calls = 0;
  return {
    deps: {
      fetch: async () => {
        const next = script[Math.min(calls++, script.length - 1)]!;
        if (next instanceof Error) throw next;
        return next;
      },
      sleep: async (ms: number) => void delays.push(ms),
    },
    delays,
    calls: () => calls,
  };
}
const URL_ = "https://data.cityofnewyork.us/resource/3h2n-5cm9.json?$select=count(*)&bin=1015862";

describe("independentCount", () => {
  it("returns the count from a normal response, including 0", async () => {
    expect(await independentCount(URL_, fake([reply(200, '[{"count":"691"}]')]).deps)).toBe(691);
    expect(await independentCount(URL_, fake([reply(200, '[{"n":"0"}]')]).deps)).toBe(0);
  });

  it("retries a 5xx with backoff, then returns the count", async () => {
    const f = fake([reply(503, "upstream unavailable"), reply(200, '[{"count":"7"}]')]);
    expect(await independentCount(URL_, f.deps)).toBe(7);
    expect(f.calls()).toBe(2);
    expect(f.delays).toEqual([2000]);
  });

  it("retries a malformed 200 body (an error object instead of a count), then returns the count", async () => {
    const f = fake([reply(200, '{"error":true,"message":"busy"}'), reply(200, "<html>"), reply(200, '[{"count":"54"}]')]);
    expect(await independentCount(URL_, f.deps)).toBe(54);
    expect(f.delays).toEqual([2000, 4000]);
  });

  it("retries a 429 and a network error", async () => {
    const f = fake([reply(429, "slow down"), new TypeError("fetch failed"), reply(200, '[{"count":"3"}]')]);
    expect(await independentCount(URL_, f.deps)).toBe(3);
    expect(f.calls()).toBe(3);
  });

  it("fails loudly after the last attempt instead of returning NaN", async () => {
    const f = fake([reply(200, '{"error":true}')]);
    const err = await independentCount(URL_, f.deps, "3h2n-5cm9").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IndependentQueryError);
    expect((err as Error).message).toMatch(/^independent 3h2n-5cm9 query failed after 4 attempt\(s\): malformed body/);
    expect(f.calls()).toBe(4);
    expect(f.delays).toEqual([2000, 4000, 8000]);
  });

  it("does not retry other 4xx errors (a bad query will not fix itself)", async () => {
    const f = fake([reply(400, '{"message":"query error"}')]);
    await expect(independentCount(URL_, f.deps)).rejects.toThrow(/after 1 attempt\(s\): HTTP 400/);
    expect(f.delays).toEqual([]);
  });

  it("a persistent 5xx also ends in an error, never a number", async () => {
    const f = fake([reply(503, "")]);
    await expect(independentCount(URL_, { ...f.deps, attempts: 2 })).rejects.toThrow(/after 2 attempt\(s\): HTTP 503/);
  });
});

describe("parseCount accepts exactly one non-negative integer count", () => {
  it.each([
    ['[{"count":"12"}]', 12],
    ['[{"n":5}]', 5],
    ['[{"count":"abc"}]', null],
    ['[{"count":"-1"}]', null],
    ['[{"count":"1.5"}]', null],
    ['[{"count":""}]', null],
    ['[{"count":null}]', null],
    ['[{"count":"1","x":"2"}]', null],
    ['[{"count":"1"},{"count":"2"}]', null],
    ["[]", null],
    ['{"count":"1"}', null],
    ["not json", null],
    ['[{"count":"99999999999999999999"}]', null],
  ])("%s -> %s", (body, expected) => expect(parseCount(body)).toBe(expected));
});

describe("scripts/validate.ts uses the checked count", () => {
  const src = readFileSync(join(__dirname, "..", "scripts", "validate.ts"), "utf8");
  it("calls independentCount and no longer turns a response into a number by itself", () => {
    expect(src).toMatch(/independentCount\(url, \{ fetch: \(u\) => fetch\(u\), sleep \}, dataset\)/);
    expect(src).not.toMatch(/\?\? NaN|res\.json\(\)/);
  });
  it("exits non-zero when any building fails or mismatches", () => expect(src).toMatch(/if \(!allMatch\) process\.exitCode = 1;/));
});
