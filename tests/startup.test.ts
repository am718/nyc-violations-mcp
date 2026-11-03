import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const entry = join(__dirname, "..", "dist", "src", "index.js");

/** Start the built server over stdio, send initialize + tools/list, return what it wrote to stdout and stderr. */
function runServer(env: Record<string, string>): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [entry], { env: { ...process.env, ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`server did not answer in time. stderr: ${stderr.slice(0, 300)}`));
    }, 15_000);
    child.stdout.on("data", (d) => {
      stdout += d;
      if (stdout.includes('"id":2')) {
        clearTimeout(timer);
        child.kill();
      }
    });
    child.stderr.on("data", (d) => (stderr += d));
    child.on("close", () => resolve({ stdout, stderr }));
    child.stdin.write(
      [
        { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } } },
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 2, method: "tools/list" },
      ]
        .map((m) => JSON.stringify(m))
        .join("\n") + "\n",
    );
  });
}

describe("server start-up (built entry point, real stdio)", () => {
  it("falls back to an in-memory cache when the cache path is unusable, and still serves tools; stdout carries only protocol messages", async () => {
    expect(existsSync(entry), "dist/src/index.js is missing: run `npm run build` first (npm test does this)").toBe(true);
    const dir = mkdtempSync(join(tmpdir(), "nyc-violations-startup-"));
    try {
      const blocker = join(dir, "not-a-directory");
      writeFileSync(blocker, "x");
      const { stdout, stderr } = await runServer({ NYC_VIOLATIONS_CACHE_DB: join(blocker, "sub", "cache.sqlite") });
      expect(stderr).toContain("could not open the cache file; using an in-memory cache");
      expect(stderr).toContain("ready (stdio)");
      const lines = stdout.split("\n").filter(Boolean);
      for (const l of lines) expect(() => JSON.parse(l), `non-JSON line on stdout: ${l.slice(0, 80)}`).not.toThrow();
      const list = lines.map((l) => JSON.parse(l)).find((m) => m.id === 2);
      expect((list.result.tools as { name: string }[]).map((t) => t.name).sort()).toEqual(
        ["building_compliance_summary", "get_dob_violations", "get_ecb_violations", "get_hpd_violations", "resolve_property"].sort(),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it("a usable cache path starts without the fallback message", async () => {
    const dir = mkdtempSync(join(tmpdir(), "nyc-violations-startup-"));
    try {
      const { stderr } = await runServer({ NYC_VIOLATIONS_CACHE_DB: join(dir, "cache.sqlite") });
      expect(stderr).not.toContain("using an in-memory cache");
      expect(stderr).toContain("ready (stdio)");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
