import assert from "node:assert/strict";
import test from "node:test";

import { resolveWebpackParallelism } from "../next.config.mjs";

test("keeps the default build serial for constrained environments", () => {
  assert.equal(resolveWebpackParallelism(undefined), 1);
  assert.equal(resolveWebpackParallelism("1"), 1);
});

test("allows reviewed staging builders to use two or four webpack workers", () => {
  assert.equal(resolveWebpackParallelism("2"), 2);
  assert.equal(resolveWebpackParallelism("4"), 4);
});

test("rejects unreviewed webpack parallelism values", () => {
  for (const value of ["0", "3", "5", "four", " 2"])
    assert.throws(
      () => resolveWebpackParallelism(value),
      /roebel_webpack_parallelism_invalid/,
    );
});
