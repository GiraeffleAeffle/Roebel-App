import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ci = readFileSync(new URL("./ci.yml", import.meta.url), "utf8");
const web = readFileSync(new URL("./staging-web-oci.yml", import.meta.url), "utf8");

test("the required ci result joins quality with one verified Web build", () => {
  assert.match(ci, /\n  quality:\n    name: Quality and non-Web builds/u);
  assert.match(ci, /pnpm exec turbo build --filter='!@roebel\/web'/u);
  assert.doesNotMatch(ci, /run: pnpm build/u);
  assert.match(
    ci,
    /\n  web-oci:[\s\S]*?uses: \.\/\.github\/workflows\/staging-web-oci\.yml[\s\S]*?source_revision: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u,
  );
  assert.match(ci, /\n  ci:\n    name: ci\n    if: \$\{\{ always\(\) \}\}/u);
  assert.match(ci, /needs:\n      - quality\n      - web-oci/u);
  assert.match(ci, /test "\$QUALITY_RESULT" = success/u);
  assert.match(ci, /test "\$WEB_OCI_RESULT" = success/u);
});

test("the Web workflow is reusable and no longer starts a duplicate PR build", () => {
  assert.match(web, /on:\n  workflow_call:\n    inputs:\n      source_revision:/u);
  assert.match(web, /  workflow_dispatch:/u);
  assert.doesNotMatch(web, /\n  pull_request:/u);
  assert.match(web, /SOURCE_REVISION: \$\{\{ inputs\.source_revision \|\| github\.sha \}\}/u);
  assert.match(web, /\[\[ "\$SOURCE_REVISION" =~ \^\[0-9a-f\]\{40\}\$ \]\]/u);
  assert.match(web, /test "\$\(git rev-parse HEAD\)" = "\$SOURCE_REVISION"/u);
  assert.equal((web.match(/Build one linux\/amd64 OCI archive/gu) ?? []).length, 1);
});

test("the required summary has no publication or deployment authority", () => {
  assert.match(ci, /^permissions: \{\}$/mu);
  assert.match(ci, /web-oci:[\s\S]*?permissions:\n      contents: read/u);
  assert.doesNotMatch(ci, /(?:packages|attestations|id-token): write/u);
  assert.doesNotMatch(ci, /^\s*(?:kubectl|helm|flux|talosctl|tailscale|ssh)\b/imu);
});
