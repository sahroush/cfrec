// Rate limiter test (plan M1): no two requests closer than 2000ms, with a mocked clock.
// We test the timing invariant indirectly: run N calls through the limiter and
// assert wall-clock spacing >= 2000ms between consecutive rawRequest timestamps.

import { test } from "node:test";
import assert from "node:assert/strict";

// Stub global fetch before importing the client.
const callLog: number[] = [];
let realFetch: typeof globalThis.fetch;

test("limiter spaces requests >= 2000ms apart", async () => {
  realFetch = globalThis.fetch;
  let n = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    callLog.push(Date.now());
    n++;
    return new Response(JSON.stringify({ status: "OK", result: n }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    // Import fresh so the module-level limiter state starts clean.
    const mod = await import(`../scripts/lib/cf.ts?t=${Date.now()}`);
    const t0 = Date.now();
    await Promise.all([
      mod.cf.problemsetProblems,
    ].map((f) => f.call(mod.cf).catch(() => null)));
    // Instead do 3 simple userStatus calls (tiny payloads).
    callLog.length = 0;
    await mod.cf.userInfo(["a"]);
    await mod.cf.userInfo(["b"]);
    await mod.cf.userInfo(["c"]);
    assert.equal(callLog.length, 3);
    for (let i = 1; i < callLog.length; i++) {
      assert.ok(callLog[i] - callLog[i - 1] >= 2000, `gap ${i}: ${callLog[i] - callLog[i - 1]}ms < 2000ms`);
    }
  } finally {
    globalThis.fetch = realFetch;
  }
});
