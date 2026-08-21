import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { singleFlight } from "../src/single-flight";

describe("singleFlight", () => {
  it("skips overlapping polling passes and allows the next pass after completion", async () => {
    let calls = 0;
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = singleFlight(async () => {
      calls += 1;
      await blocked;
      return calls;
    });

    const first = run();
    assert.equal(await run(), undefined);
    assert.equal(calls, 1);

    release();
    assert.equal(await first, 1);
    assert.equal(await run(), 2);
    assert.equal(calls, 2);
  });

  it("releases the guard after a failed pass", async () => {
    let calls = 0;
    const run = singleFlight(async () => {
      calls += 1;
      if (calls === 1) throw new Error("expected failure");
      return calls;
    });

    await assert.rejects(run(), /expected failure/);
    assert.equal(await run(), 2);
  });
});
