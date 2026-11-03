#!/usr/bin/env node
/**
 * Shows the no-network test guard (tests/setup-no-network.ts) both ways, portably (plain Node, no sed, no internet):
 *   1. writes a scratch test that fetches from a local HTTP server it starts itself,
 *   2. runs it with the normal vitest config (guard on): it must FAIL with "NETWORK USED IN TEST",
 *   3. runs it with vitest.no-guard.config.ts (guard off; that config includes only the scratch file): it must PASS,
 *   4. deletes the scratch test.
 * Run: npm run check:network-guard   (exit code 0 only if both outcomes are as expected)
 */
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const scratch = join(root, "tests", "zz-network-guard-scratch.test.ts");
const vitest = join(root, "node_modules", "vitest", "vitest.mjs");

const test = `import { createServer } from "node:http";
import { expect, it } from "vitest";
it("a test that uses fetch", async () => {
  const server = createServer((_q, res) => res.end("local ok"));
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", () => ok()));
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch("http://127.0.0.1:" + port + "/");
    expect(await res.text()).toBe("local ok");
  } finally {
    server.close();
  }
});
`;

const run = (args) => {
  const r = spawnSync(process.execPath, [vitest, "run", ...args], { cwd: root, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
};

let ok = false;
try {
  writeFileSync(scratch, test);
  const on = run(["tests/zz-network-guard-scratch.test.ts"]);
  const off = run(["--config", "vitest.no-guard.config.ts"]);
  const onOk = on.code !== 0 && on.out.includes("NETWORK USED IN TEST");
  const offOk = off.code === 0 && /1 passed/.test(off.out);
  console.log(`guard ON : exit ${on.code}, ${onOk ? 'failed with "NETWORK USED IN TEST" (expected)' : "UNEXPECTED"}`);
  console.log(`guard OFF: exit ${off.code}, ${offOk ? "passed (expected)" : "UNEXPECTED"}`);
  if (!onOk) console.log(on.out.slice(-1500));
  if (!offOk) console.log(off.out.slice(-1500));
  ok = onOk && offOk;
} finally {
  rmSync(scratch, { force: true });
}
process.exit(ok ? 0 : 1);
