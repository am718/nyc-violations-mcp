#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Cache } from "./cache.js";
import { loadSettings } from "./config.js";
import { HttpClient } from "./http.js";
import { createServer } from "./server.js";
import { SocrataClient } from "./socrata.js";

async function main() {
  const settings = loadSettings();
  let cache: Cache;
  try {
    cache = new Cache(settings.cacheDb, settings.cacheTtlSeconds * 1000);
  } catch {
    console.error("[nyc-violations-mcp] could not open the cache file; using an in-memory cache.");
    cache = new Cache(":memory:", settings.cacheTtlSeconds * 1000);
  }
  const http = new HttpClient({ fetch: (u, i) => fetch(u, i), cache, settings });
  const server = createServer({ http, socrata: new SocrataClient(http) });
  await server.connect(new StdioServerTransport());
  console.error("[nyc-violations-mcp] ready (stdio)");
}

main().catch((e) => {
  console.error("[nyc-violations-mcp] fatal:", e instanceof Error ? e.message : "unknown");
  process.exit(1);
});
