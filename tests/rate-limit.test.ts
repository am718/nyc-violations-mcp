import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Cache } from "../src/cache.js";
import { HttpClient, type FetchLike } from "../src/http.js";
import { fastSettings } from "./helpers.js";

// Fake timers: the client uses its real setTimeout/Date.now defaults, which vitest replaces, so no real waiting happens.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const settings = { ...fastSettings, minIntervalMs: 1000, backoffBaseMs: 200, maxAttempts: 3 };

function client(statuses: Record<string, number[]> = {}) {
  const starts: { url: string; t: number }[] = [];
  const left = Object.fromEntries(Object.entries(statuses).map(([k, v]) => [k, [...v]]));
  const t0 = Date.now();
  const fetch: FetchLike = async (url) => {
    starts.push({ url, t: Date.now() - t0 });
    const status = left[url]?.shift() ?? 200;
    return { ok: status === 200, status, text: async () => "[]" };
  };
  const http = new HttpClient({ fetch, cache: new Cache(":memory:", 60_000), settings });
  return { http, starts };
}
const gaps = (starts: { t: number }[]) => starts.slice(1).map((s, i) => s.t - starts[i]!.t);

describe("1 request/second limiter under concurrency (fake timers)", () => {
  it("5 concurrent calls start at least 1000 ms apart", async () => {
    const { http, starts } = client();
    const calls = Promise.all([1, 2, 3, 4, 5].map((i) => http.getJson(`https://data.cityofnewyork.us/x?i=${i}`)));
    await vi.advanceTimersByTimeAsync(10_000);
    await calls;
    expect(starts).toHaveLength(5);
    for (const g of gaps(starts)) expect(g).toBeGreaterThanOrEqual(1000);
  });

  it("retries and backoff go through the same limiter, interleaved with other callers", async () => {
    const a = "https://data.cityofnewyork.us/a";
    const b = "https://data.cityofnewyork.us/b";
    const { http, starts } = client({ [a]: [500, 500, 200] });
    const calls = Promise.all([http.getJson(a), http.getJson(b), http.getJson("https://data.cityofnewyork.us/c")]);
    await vi.advanceTimersByTimeAsync(30_000);
    await calls;
    expect(starts.filter((s) => s.url === a)).toHaveLength(3); // two failures + the success
    expect(starts).toHaveLength(5);
    for (const g of gaps(starts)) expect(g).toBeGreaterThanOrEqual(1000);
  });

  it("a failed call does not block the ones queued behind it", async () => {
    const bad = "https://data.cityofnewyork.us/bad";
    const { http, starts } = client({ [bad]: [400] });
    const first = http.getJson(bad).catch((e: Error) => e);
    const second = http.getJson("https://data.cityofnewyork.us/ok");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await first).toBeInstanceOf(Error);
    await second;
    expect(starts).toHaveLength(2);
    expect(gaps(starts)[0]).toBeGreaterThanOrEqual(1000);
  });

  it("a cache hit is not delayed and does not use a slot", async () => {
    const { http, starts } = client();
    const url = "https://data.cityofnewyork.us/cached";
    const p = http.getJson(url);
    await vi.advanceTimersByTimeAsync(100);
    await p;
    const again = await http.getJson(url);
    expect(again.fromCache).toBe(true);
    expect(starts).toHaveLength(1);
  });
});
