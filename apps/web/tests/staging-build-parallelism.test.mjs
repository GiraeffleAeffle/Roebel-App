import assert from "node:assert/strict";
import test from "node:test";

import {
  resolveStagingBuildWorkers,
  resolveStagingOptimizedPackageImports,
  resolveWebpackParallelism,
} from "../next.config.mjs";

test("keeps the default build serial for constrained environments", () => {
  assert.equal(resolveWebpackParallelism(undefined), 1);
  assert.equal(resolveWebpackParallelism("1"), 1);
});

test("allows the reviewed staging builder to use two webpack workers", () => {
  assert.equal(resolveWebpackParallelism("2"), 2);
});

test("rejects unreviewed webpack parallelism values", () => {
  for (const value of ["0", "3", "four", " 2"])
    assert.throws(
      () => resolveWebpackParallelism(value),
      /roebel_webpack_parallelism_invalid/,
    );
});

test("enables Next build workers only for the standalone staging image", () => {
  assert.equal(resolveStagingBuildWorkers("1"), true);
  for (const value of [undefined, "", "0", "true", " 1"])
    assert.equal(resolveStagingBuildWorkers(value), false);
});

test("optimizes thirdweb barrels only for the standalone staging image", () => {
  assert.deepEqual(resolveStagingOptimizedPackageImports("1"), [
    "thirdweb",
    "thirdweb/react",
  ]);
  for (const value of [undefined, "", "0", "true", " 1"])
    assert.equal(resolveStagingOptimizedPackageImports(value), undefined);
});
