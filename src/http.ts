import { Cache } from "./cache.js";
import { Settings, SOCRATA_HOST } from "./config.js";
import { ToolError } from "./errors.js";

export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  headers?: { get(name: string): string | null };
}>;

export interface HttpDeps {
  fetch: FetchLike;
  cache: Cache;
  settings: Settings;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/** Retry-After in seconds (HTTP-date form is ignored), capped at 10 s so a bad header cannot stall the server. */
export function parseRetryAfter(v: string | null): number {
  if (v === null || !/^\d{1,4}$/.test(v.trim())) return 0;
  return Math.min(Number(v.trim()), 10) * 1000;
}

export interface JsonResult {
  json: unknown;
  fetchedAt: string;
  fromCache: boolean;
}

/** GET JSON with a TTL cache, 1 req/sec spacing, timeout, and retry with exponential backoff. */
export class HttpClient {
  private lastRequestAt = 0;
  private gate: Promise<void> = Promise.resolve();
  private sleep: (ms: number) => Promise<void>;
  private now: () => number;

  constructor(private deps: HttpDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = deps.now ?? Date.now;
  }

  async getJson(url: string): Promise<JsonResult> {
    const hit = this.deps.cache.get<unknown>(url);
    if (hit) return { json: hit.value, fetchedAt: hit.fetchedAt, fromCache: true };

    const { settings } = this.deps;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (settings.appToken && new URL(url).hostname === SOCRATA_HOST) headers["X-App-Token"] = settings.appToken;

    let lastErr = "unknown error";
    for (let attempt = 1; attempt <= settings.maxAttempts; attempt++) {
      let retryAfterMs = 0;
      await this.throttle();
      try {
        const res = await this.deps.fetch(url, { headers, signal: AbortSignal.timeout(settings.timeoutMs) });
        const body = await res.text();
        if (res.ok) {
          let json: unknown;
          try {
            json = JSON.parse(body);
          } catch {
            throw new ToolError("The upstream service returned a response that is not valid JSON. Try again later.");
          }
          const fetchedAt = this.deps.cache.set(url, json);
          return { json, fetchedAt, fromCache: false };
        }
        lastErr = `HTTP ${res.status}`;
        retryAfterMs = parseRetryAfter(res.headers?.get("retry-after") ?? null);
        if (res.status !== 429 && res.status < 500) {
          throw new ToolError(
            `The upstream service rejected the request (HTTP ${res.status}). Check the input values and try again.`,
          );
        }
      } catch (e) {
        if (e instanceof ToolError) throw e;
        lastErr = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError") ? "timeout" : "network error";
      }
      if (attempt < settings.maxAttempts) await this.sleep(Math.max(settings.backoffBaseMs * 2 ** (attempt - 1), retryAfterMs));
    }
    throw new ToolError(
      `NYC Open Data did not respond after ${settings.maxAttempts} attempts (${lastErr}). ` +
        "This is usually temporary: retry in a minute. Setting SOCRATA_APP_TOKEN can help if you are being rate limited.",
    );
  }

  /**
   * Reserve the next request slot. Callers are chained one behind the other, so concurrent calls (parallel tool calls, retries
   * after a backoff) are spaced at least minIntervalMs apart. Reading lastRequestAt, sleeping and writing it back as three
   * separate steps would let callers that start together compute the same wait and all send at once.
   */
  private async throttle(): Promise<void> {
    const previous = this.gate;
    let release!: () => void;
    this.gate = new Promise<void>((resolve) => (release = resolve));
    try {
      await previous;
      const wait = this.lastRequestAt + this.deps.settings.minIntervalMs - this.now();
      if (wait > 0) await this.sleep(wait);
      this.lastRequestAt = this.now();
    } finally {
      release();
    }
  }
}
