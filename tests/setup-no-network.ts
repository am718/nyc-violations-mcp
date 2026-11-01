// Guard: tests must never touch the network. Any global fetch fails loudly.
globalThis.fetch = (() => {
  throw new Error("NETWORK USED IN TEST: use fixtureFetch/stubFetch from tests/helpers.ts");
}) as typeof fetch;
