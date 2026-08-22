import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ci = readFileSync(new URL("./ci.yml", import.meta.url), "utf8");
const web = readFileSync(new URL("./staging-web-oci.yml", import.meta.url), "utf8");

test("the required ci result joins quality with one verified Web build", () => {
  assert.match(ci, /\n  changes:\n    name: Detect affected staging components/u);
  assert.match(ci, /node scripts\/ci\/affected-staging-components\.mjs --github-output/u);
  assert.match(ci, /\n  quality:\n    name: Quality and non-Web builds/u);
  assert.match(ci, /pnpm exec turbo build --filter='!@roebel\/web'/u);
  assert.doesNotMatch(ci, /run: pnpm build/u);
  assert.match(
    ci,
    /\n  web-oci:[\s\S]*?needs: changes[\s\S]*?if: \$\{\{ needs\.changes\.outputs\.web == 'true' \}\}[\s\S]*?uses: \.\/\.github\/workflows\/staging-web-oci\.yml[\s\S]*?source_revision: \$\{\{ github\.event\.pull_request\.head\.sha \|\| github\.sha \}\}/u,
  );
  assert.match(ci, /\n  ci:\n    name: ci\n    if: \$\{\{ always\(\) \}\}/u);
  assert.match(ci, /needs:\n      - changes\n      - quality\n      - web-oci/u);
  assert.match(ci, /test "\$CHANGES_RESULT" = success/u);
  assert.match(ci, /test "\$QUALITY_RESULT" = success/u);
  assert.match(ci, /if test "\$WEB_REQUIRED" = true; then[\s\S]*?test "\$WEB_OCI_RESULT" = success[\s\S]*?test "\$WEB_OCI_RESULT" = skipped/u);
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

test("PR Web caching reads protected main and writes only to the PR scope", () => {
  assert.match(web, /BUILDKIT_BASE_CACHE_SCOPE: roebel-web-main/u);
  assert.match(web, /BUILDKIT_CACHE_SCOPE: \$\{\{ github\.event_name == 'pull_request'[\s\S]*?github\.ref == 'refs\/heads\/main'[\s\S]*?roebel-web-run-/u);
  assert.match(web, /--cache-from "type=gha,scope=\$BUILDKIT_BASE_CACHE_SCOPE"/u);
  assert.match(web, /--cache-from "type=gha,scope=\$BUILDKIT_CACHE_SCOPE"/u);
  assert.match(web, /--cache-to "type=gha,scope=\$BUILDKIT_CACHE_SCOPE,mode=max,ignore-error=true"/u);
  assert.doesNotMatch(web, /--cache-to "type=gha,scope=\$BUILDKIT_BASE_CACHE_SCOPE"/u);
});
