import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = (path: string) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("identity-only Semaphore module excludes proof and group dependencies", () => {
  const identity = source("src/lib/semaphore/identity.ts");

  assert.doesNotMatch(
    identity,
    /(?:@semaphore-protocol\/(?:group|proof)|\bsnarkjs\b)/,
  );
  assert.match(identity, /@semaphore-protocol\/identity/);
});

test("identity and status routes use the isolated identity module", () => {
  for (const path of [
    "src/app/semaphore/identity/page.tsx",
    "src/app/semaphore/status/page.tsx",
  ]) {
    const page = source(path);
    assert.match(page, /@\/lib\/semaphore\/identity/);
    assert.doesNotMatch(page, /@\/lib\/semaphore["']/);
  }
});

test("the legacy proof module re-exports identity helpers instead of duplicating them", () => {
  const semaphore = source("src/lib/semaphore.ts");

  assert.match(semaphore, /from "\.\/semaphore\/identity"/);
  assert.doesNotMatch(semaphore, /const IDENTITY_STORAGE_KEY/);
  assert.doesNotMatch(semaphore, /export function (?:generateIdentity|saveIdentity|loadIdentity)/);
});
