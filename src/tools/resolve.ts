import { envelope } from "../format.js";
import { resolveProperty, type Resolver } from "../resolve.js";

export async function resolvePropertyTool(r: Resolver, a: { address?: string; bin?: string; bbl?: string }) {
  const p = await resolveProperty(r, a);
  const { sources, ...rest } = p;
  return envelope(sources, rest);
}
