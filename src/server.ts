import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { LIMITS } from "./config.js";
import { ToolError } from "./errors.js";
import { toText } from "./format.js";
import { addressSchema, bblSchema, binSchema, limitSchema, normalizeBbl, statusSchema } from "./ids.js";
import type { Resolver } from "./resolve.js";
import { resolvePropertyTool } from "./tools/resolve.js";
import { buildingComplianceSummary } from "./tools/summary.js";
import { getDobViolations, getEcbViolations, getHpdViolations } from "./tools/violations.js";

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

async function run(fn: () => Promise<unknown>): Promise<Result> {
  try {
    return { content: [{ type: "text", text: toText(await fn()) }] };
  } catch (e) {
    const msg =
      e instanceof ToolError
        ? e.message
        : "Unexpected internal error. Retry once; if it persists, check the server's stderr log.";
    if (!(e instanceof ToolError)) console.error("[nyc-violations-mcp] internal error:", e instanceof Error ? e.message : "unknown");
    return { isError: true, content: [{ type: "text", text: msg }] };
  }
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true } as const;
const limit = limitSchema(LIMITS.defaultLimit, LIMITS.maxLimit);

export function createServer(r: Resolver): McpServer {
  const server = new McpServer({ name: "nyc-violations-mcp", version: "0.1.0" });

  server.registerTool(
    "resolve_property",
    {
      title: "Resolve NYC property",
      description:
        "Normalize a NYC property to {address, bin, bbl, borough}. Give ONE of address, bin or bbl (bin and bbl may be given together " +
        "to verify they match). Use this FIRST when you only have a street address, or to check that a BIN/BBL pair refers to the " +
        "same property. Not for fetching violations: use the get_*_violations tools or building_compliance_summary after resolving.",
      inputSchema: { address: addressSchema.optional(), bin: binSchema.optional(), bbl: bblSchema.optional() },
      annotations: READ_ONLY,
    },
    (a) => run(() => resolvePropertyTool(r, { address: a.address, bin: a.bin, bbl: a.bbl !== undefined ? normalizeBbl(a.bbl) : undefined })),
  );

  server.registerTool(
    "get_dob_violations",
    {
      title: "DOB violations for a building",
      description:
        "List NYC Department of Buildings (DOB) violations for one building by BIN, newest first. Requires a BIN: if you only have an address, " +
        "or are unsure of the BIN, call resolve_property first. Use for the DOB record of a specific " +
        "building (elevator, construction, work without permit, etc.). Not for ECB penalties/hearings (use get_ecb_violations), " +
        "residential housing-maintenance violations (use get_hpd_violations), or an overview (use building_compliance_summary). " +
        'Open/closed is a heuristic: open means "ACTIVE" appears in the record\'s category, and some "open" records are annotated as deleted (flagged per record).' +
        ' Responses are capped at ~12,000 characters, so a large limit can return fewer records (see `truncated`); recency lists contain dated records only (see `undated_excluded`).',
      inputSchema: { bin: binSchema, status: statusSchema, limit },
      annotations: READ_ONLY,
    },
    (a) => run(() => getDobViolations(r, { bin: a.bin, status: a.status, limit: a.limit })),
  );

  server.registerTool(
    "get_ecb_violations",
    {
      title: "ECB violations for a building",
      description:
        "List DOB ECB (Environmental Control Board / OATH) violations for one building by BIN, newest first, including severity, " +
        "hearing status and penalty balance. Requires a BIN: if you only have an address, or are unsure of the BIN, call resolve_property first. " +
        "Use when the question is about penalties, hearings or amounts owed. Not for DOB " +
        "violation records themselves (use get_dob_violations) or HPD housing violations (use get_hpd_violations). ACTIVE records with hearing status WRITTEN OFF are flagged per record." +
        " Responses are capped at ~12,000 characters, so a large limit can return fewer records (see `truncated`); recency lists contain dated records only (see `undated_excluded`).",
      inputSchema: { bin: binSchema, status: statusSchema, limit },
      annotations: READ_ONLY,
    },
    (a) => run(() => getEcbViolations(r, { bin: a.bin, status: a.status, limit: a.limit })),
  );

  server.registerTool(
    "get_hpd_violations",
    {
      title: "HPD housing violations for a building",
      description:
        "List HPD (Housing Preservation & Development) housing-maintenance violations (Class A/B/C) by bbl or bin, newest first. " +
        "Use for residential conditions: heat, pests, leaks, etc. HPD covers residential buildings only: an empty result for a " +
        "commercial building means no coverage expected, not compliance. Not for DOB or ECB records. If you pass both bin and bbl " +
        "they must refer to the same property. A bbl covers the whole tax lot (possibly many buildings); a bin covers one building." +
        " Responses are capped at ~12,000 characters, so a large limit can return fewer records (see `truncated`); recency lists contain dated records only (see `undated_excluded`).",
      // Published as an object with anyOf [{required:[bbl]},{required:[bin]}] (the closest the SDK allows to "one of"), plus a clear runtime error.
      inputSchema: z
        .object({ bbl: bblSchema.optional(), bin: binSchema.optional(), status: statusSchema, limit })
        .meta({ anyOf: [{ required: ["bbl"] }, { required: ["bin"] }] })
        .refine((v) => v.bbl !== undefined || v.bin !== undefined, {
          error: 'Provide bbl (e.g. "2046540021") or bin (e.g. "2099579"), or both if they are the same property. Use resolve_property first if you only have an address.',
        }),
      annotations: READ_ONLY,
    },
    (a) =>
      run(() =>
        getHpdViolations(r, { bbl: a.bbl !== undefined ? normalizeBbl(a.bbl) : undefined, bin: a.bin, status: a.status, limit: a.limit }),
      ),
  );

  server.registerTool(
    "building_compliance_summary",
    {
      title: "Building compliance summary",
      description:
        "Best first call for \"what is the violation situation at this property?\". Takes ONE of address, bin or bbl and returns open " +
        "vs closed counts per agency (DOB, ECB, HPD), the most recent issue date, the 5 most recent open items (one line each) and " +
        "links to the source records. Makes 13 upstream requests at 1 request per second, so a cold call takes at least about 12 seconds (measured 12-24 s). Use the " +
        "get_*_violations tools afterwards only if you need full details of one agency. Counts DOB, ECB and HPD for the one resolved BIN (see `footprint`); " +
        "read `data_quality_notes` first. Results are cached for an hour, so do not call it repeatedly for the same property.",
      inputSchema: { address: addressSchema.optional(), bin: binSchema.optional(), bbl: bblSchema.optional() },
      annotations: READ_ONLY,
    },
    (a) => run(() => buildingComplianceSummary(r, { address: a.address, bin: a.bin, bbl: a.bbl !== undefined ? normalizeBbl(a.bbl) : undefined })),
  );

  return server;
}

