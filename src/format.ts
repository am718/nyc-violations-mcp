import { LIMITS, NOTICE } from "./config.js";

export interface SourceRef {
  source: string;
  dataset_id: string | null;
  dataset_name: string;
  fetched_at: string;
}

/** Every tool response is wrapped with source, dataset id(s), fetched_at and the data caveat. */
export function envelope<T extends object>(sources: SourceRef[], body: T, untrustedTextFields: string[] = []) {
  const seen = new Set<string>();
  const uniq = sources.filter((s) => {
    const k = `${s.dataset_id}|${s.source}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const fetched = uniq.map((s) => s.fetched_at).sort()[0] ?? new Date().toISOString();
  // Key order matters to a reader: data quality notes and the untrusted-text notice come BEFORE the data.
  const { data_quality_notes, ...rest } = body as { data_quality_notes?: string[] } & Record<string, unknown>;
  return {
    ...(data_quality_notes ? { data_quality_notes } : {}),
    notice: NOTICE,
    ...(untrustedTextFields.length ? { untrusted_text_fields: untrustedTextFields } : {}),
    ...(rest as Omit<T, "data_quality_notes">),
    sources: uniq,
    fetched_at: fetched,
  };
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
  const withNote = (n: number) => ({
    ...result,
    [listKey]: items,
    returned: n,
    truncated: true as const,
    truncation_note: `Response was capped at ~${max} characters: showing ${n} of ${original} requested items (newest first). Use status or a smaller limit to narrow, or building_compliance_summary for an overview.`,
  });
  // Measure WITH the truncation fields included, so the final serialized response respects the cap.
  const size = () => JSON.stringify(withNote(items.length)).length;
  if (JSON.stringify({ ...result, [listKey]: items }).length <= max) return result;
  while (items.length > 0 && size() > max) items = items.slice(0, Math.max(0, items.length - Math.max(1, Math.ceil(items.length * 0.1))));
  return withNote(items.length) as T & { truncated?: true; truncation_note?: string };
}

export function toText(obj: unknown): string {
  return JSON.stringify(obj);
}
