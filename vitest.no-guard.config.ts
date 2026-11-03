import { defineConfig } from "vitest/config";

// Used ONLY by scripts/check-network-guard.mjs to show the guard both ways. It includes nothing but that script's scratch test,
// so it cannot be used to run the real suite without the no-network guard.
export default defineConfig({
  test: { include: ["tests/zz-network-guard-scratch.test.ts"], setupFiles: [] },
});
