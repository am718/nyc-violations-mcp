import { LIMITS, NOTICE } from "./config.js";

export interface SourceRef {
  source: string;
  dataset_id: string | null;
  dataset_name: string;
  fetched_at: string;
}

/** Every tool response is wrapped with source, dataset id(s), fetched_at and the data caveat. */
export function envelope<T extends object>(sources: SourceRef[], body: T) {
  const seen = new Set<string>();
  const uniq = sources.filter((s) => {
    const k = `${s.dataset_id}|${s.source}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const fetched = uniq.map((s) => s.fetched_at).sort()[0] ?? new Date().toISOString();
  return { ...body, sources: uniq, fetched_at: fetched, notice: NOTICE };
}

/**
 * Enforce the response size cap by dropping trailing list items (they are sorted newest-first,
 * so the oldest go first) and saying so. Summaries are first-class; details are paged by `limit`.
 */
export function capList<T extends { [k: string]: unknown }>(
  result: T,
  listKey: string,
  max: number = LIMITS.maxResponseChars,
): T & { truncated?: true; truncation_note?: string } {
  const list = result[listKey];
  if (!Array.isArray(list)) return result;
  let items = list.slice();
  const original = items.length;
  const build = () => JSON.stringify({ ...result, [listKey]: items });
  while (items.length > 0 && build().length > max) items = items.slice(0, Math.max(0, items.length - Math.max(1, Math.ceil(items.length * 0.1))));
  if (items.length === original) return result;
  return {
    ...result,
    [listKey]: items,
    returned: items.length,
    truncated: true,
    truncation_note: `Response was capped at ~${max} characters: showing ${items.length} of ${original} requested items (newest first). Use status or a smaller limit to narrow, or building_compliance_summary for an overview.`,
  };
}

export function toText(obj: unknown): string {
  return JSON.stringify(obj);
}
