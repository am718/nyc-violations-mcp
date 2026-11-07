/**
 * One independent Socrata count for scripts/validate.ts: a plain URL (no server code) whose response is always checked.
 * Retries with exponential backoff on network errors, HTTP 429, HTTP 5xx and malformed bodies; any other HTTP error, or
 * running out of attempts, throws IndependentQueryError. It never returns NaN.
 * Kept in its own module so tests can exercise it with a fake fetch (validate.ts runs the live validation when imported).
 */
export interface CountResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}
export interface CountDeps {
  fetch: (url: string) => Promise<CountResponse>;
  sleep: (ms: number) => Promise<void>;
  /** Total tries, default 4 (one try plus three retries). */
  attempts?: number;
  /** First backoff delay, default 2000 ms, doubled after each failed try. */
  baseDelayMs?: number;
}

export class IndependentQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IndependentQueryError";
  }
}

/** The single count in a Socrata count response (`[{"count":"7"}]`, `[{"n":"7"}]`), or null if the body is anything else. */
export function parseCount(body: string): number | null {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return null;
  }
  if (!Array.isArray(json) || json.length !== 1) return null;
  const row: unknown = json[0];
  if (row === null || typeof row !== "object" || Array.isArray(row)) return null;
  const values = Object.values(row);
  if (values.length !== 1) return null;
  const v = values[0];
  if ((typeof v !== "string" && typeof v !== "number") || !/^\d+$/.test(String(v))) return null;
  const n = Number(v);
  return Number.isSafeInteger(n) ? n : null;
}

/** Fetch `url` and return its count. `label` names the query in the error message (no URL, no response body). */
export async function independentCount(url: string, deps: CountDeps, label = "count"): Promise<number> {
  const attempts = deps.attempts ?? 4;
  const base = deps.baseDelayMs ?? 2000;
  let reason = "no attempt made";
  let tried = 0;
  for (let i = 1; i <= attempts; i++) {
    tried = i;
    let retryable = true;
    try {
      const res = await deps.fetch(url);
      const body = await res.text();
      if (res.ok) {
        const n = parseCount(body);
        if (n !== null) return n;
        reason = `malformed body (HTTP ${res.status}, ${body.length} bytes, not a single count)`;
      } else {
        reason = `HTTP ${res.status}`;
        retryable = res.status === 429 || res.status >= 500;
      }
    } catch (e) {
      reason = `network error (${e instanceof Error ? e.name : "unknown"})`;
    }
    if (!retryable) break;
    if (i < attempts) await deps.sleep(base * 2 ** (i - 1));
  }
  throw new IndependentQueryError(`independent ${label} query failed after ${tried} attempt(s): ${reason}`);
}
