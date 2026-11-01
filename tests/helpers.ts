import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Cache } from "../src/cache.js";
import { loadSettings } from "../src/config.js";
import { HttpClient, type FetchLike } from "../src/http.js";
import type { Resolver } from "../src/resolve.js";
import { SocrataClient } from "../src/socrata.js";

const fixtureName = (url: string) => createHash("sha1").update(url).digest("hex").slice(0, 16) + ".json";
export const loadFixture = (name: string) => JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"));

/** Replays responses recorded from the live APIs (scripts/record-fixtures.ts). Never touches the network. */
export function fixtureFetch(calls: string[] = []): FetchLike {
  return async (url) => {
    calls.push(url);
    const p = join(__dirname, "fixtures", "http", fixtureName(url));
    if (!existsSync(p)) throw new Error(`No recorded fixture for ${url}`);
    const f = JSON.parse(readFileSync(p, "utf8")) as { status: number; body: string };
    return { ok: f.status >= 200 && f.status < 300, status: f.status, text: async () => f.body };
  };
}

export const fastSettings = { ...loadSettings({}), minIntervalMs: 0, backoffBaseMs: 1, appToken: undefined };

export function makeResolver(fetchImpl: FetchLike, opts: { settings?: Partial<typeof fastSettings>; cache?: Cache; sleep?: (ms: number) => Promise<void>; now?: () => number } = {}): Resolver {
  const http = new HttpClient({
    fetch: fetchImpl,
    cache: opts.cache ?? new Cache(":memory:", 60_000),
    settings: { ...fastSettings, ...opts.settings },
    sleep: opts.sleep ?? (async () => {}),
    now: opts.now,
  });
  return { http, socrata: new SocrataClient(http) };
}

/** Build a fetch that returns the given JSON bodies in order (synthetic data; labeled as such in tests). */
export function stubFetch(responses: (unknown | Error | { status: number })[]): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const fn = (async (url: string) => {
    calls.push(url);
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    if (r && typeof r === "object" && "status" in (r as object) && Object.keys(r as object).length === 1) {
      const status = (r as { status: number }).status;
      return { ok: false, status, text: async () => "{}" };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(r) };
  }) as FetchLike & { calls: string[] };
  fn.calls = calls;
  return fn;
}
