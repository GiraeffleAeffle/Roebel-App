import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const ci = readFileSync(new URL("./ci.yml", import.meta.url), "utf8");
const web = readFileSync(new URL("./staging-web-oci.yml", import.meta.url), "utf8");

function workflowStep(source, name) {
  const marker = `      - name: ${name}\n`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing workflow step: ${name}`);
  const end = source.indexOf("\n      - name: ", start + marker.length);
  return source.slice(start, end === -1 ? source.length : end);
}

function runScript(step) {
  const marker = "\n        run: |\n";
  const start = step.indexOf(marker);
  assert.notEqual(start, -1, "missing run script");
  return step
    .slice(start + marker.length)
    .split("\n")
    .map((line) => line.startsWith("          ") ? line.slice(10) : line)
    .join("\n");
}

function runDiagnosticScript(script, { cacheState = "directory" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "roebel-next-cache-test-"));
  try {
    const bin = join(root, "bin");
    const cache = join(root, "cache");
    const archive = join(root, "next-cache-diagnostic.tar.zst");
    const dateCounter = join(root, "date-counter");
    mkdirSync(bin);

    const du = join(bin, "du");
    writeFileSync(du, `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  -sb) value="$TEST_APPARENT_BYTES" ;;
  -sB1) value="$TEST_ALLOCATED_BYTES" ;;
  *) exit 64 ;;
esac
printf '%s\\t%s\\n' "$value" "\${@: -1}"
`);
    chmodSync(du, 0o755);

    const tar = join(bin, "tar");
    writeFileSync(tar, `#!/usr/bin/env bash
set -euo pipefail
test "$1" = --zstd
test "$2" = -cf
printf 'compressed fixture' > "$3"
`);
    chmodSync(tar, 0o755);

    const stat = join(bin, "stat");
    writeFileSync(stat, `#!/usr/bin/env bash
set -euo pipefail
test "$1" = -c
test "$2" = %s
test -f "$3"
printf '%s\\n' "$TEST_COMPRESSED_BYTES"
`);
    chmodSync(stat, 0o755);

    const date = join(bin, "date");
    writeFileSync(date, `#!/usr/bin/env bash
set -euo pipefail
test "$1" = +%s
if [[ -e "$TEST_DATE_COUNTER" ]]; then
  printf '107\\n'
else
  : > "$TEST_DATE_COUNTER"
  printf '100\\n'
fi
`);
    chmodSync(date, 0o755);

    if (cacheState === "rootSymlink") {
      const target = join(root, "cache-target");
      mkdirSync(target);
      symlinkSync(target, cache);
    } else if (cacheState !== "missing") {
      mkdirSync(join(cache, ".rsc"), { recursive: true });
      mkdirSync(join(cache, "swc"), { recursive: true });
      mkdirSync(join(cache, "webpack", "client-production"), { recursive: true });
      writeFileSync(join(cache, ".rsc", "dot.bin"), "dot");
      writeFileSync(join(cache, "swc", "swc.bin"), "swc");
      writeFileSync(join(cache, "webpack", "client-production", "pack"), "pack");
    }
    if (cacheState === "nestedSymlink") {
      const target = join(root, "target");
      writeFileSync(target, "public compiler cache fixture");
      symlinkSync(target, join(cache, "unsafe-link"));
    }

    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        NEXT_CACHE_PATH: cache,
        NEXT_CACHE_ARCHIVE: archive,
        PATH: `${bin}:${process.env.PATH}`,
        TEST_ALLOCATED_BYTES: "222",
        TEST_APPARENT_BYTES: "111",
        TEST_COMPRESSED_BYTES: "333",
        TEST_DATE_COUNTER: dateCounter,
      },
    });
    return {
      ...result,
      archiveExists: existsSync(archive),
    };
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the required ci result joins quality with one verified Web build", () => {
  assert.match(ci, /\n  changes:\n    name: Detect affected staging components/u);
  assert.match(ci, /node scripts\/ci\/affected-staging-components\.mjs --github-output/u);
  assert.match(ci, /\n  quality:\n    name: Affected quality and non-Web builds/u);
  assert.match(ci, /node scripts\/ci\/run-affected-quality\.mjs/u);
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

test("PR Web builds once and measures cache candidates without retaining them", () => {
  const diagnostic = workflowStep(web, "Measure PR-only Web compiler cache candidates");
  const upload = workflowStep(web, "Upload the private short-lived build result");

  assert.doesNotMatch(web, /actions\/cache|MAX_NEXT_CACHE_BYTES|roebel-web-next-cache/u);
  assert.match(diagnostic, /if: \$\{\{ github\.event_name == 'pull_request' \}\}/u);
  assert.match(diagnostic, /NEXT_CACHE_PATH: \$\{\{ runner\.temp \}\}\/context\/apps\/web\/\.next\/cache/u);
  assert.match(diagnostic, /NEXT_CACHE_ARCHIVE: \$\{\{ runner\.temp \}\}\/next-cache-diagnostic\.tar\.zst/u);
  assert.match(diagnostic, /find "\$NEXT_CACHE_PATH" -type l -print -quit/u);
  assert.match(diagnostic, /report_directory "\$NEXT_CACHE_PATH" \./u);
  assert.match(diagnostic, /for directory in "\$NEXT_CACHE_PATH"\/\*/u);
  assert.match(diagnostic, /for directory in "\$NEXT_CACHE_PATH"\/webpack\/\*/u);
  assert.match(diagnostic, /next_cache_directory_v1 path=%q apparent_bytes=%s allocated_bytes=%s files=%s/u);
  assert.match(diagnostic, /tar --zstd -cf "\$NEXT_CACHE_ARCHIVE"/u);
  assert.match(diagnostic, /next_cache_compression_v1 compressed_bytes=%s elapsed_seconds=%s/u);
  assert.match(diagnostic, /next_cache_diagnostic_v1 archive_deleted=true upload=false save=false/u);
  assert.doesNotMatch(upload, /next-cache|\.next\/cache/u);
  assert.ok(
    web.indexOf("Build the standalone Web runtime once") <
      web.indexOf("Measure PR-only Web compiler cache candidates"),
  );
  assert.ok(
    web.indexOf("Measure PR-only Web compiler cache candidates") <
      web.indexOf("Set up isolated Buildx"),
  );
  assert.match(web, /test ! -e "\$RUNNER_TEMP\/context\/node_modules"/u);
  assert.match(web, /MAX_DEPENDENCY_INSTALL_BYTES: "4294967296"/u);
  assert.match(web, /MAX_RUNTIME_CONTEXT_BYTES: "805306368"/u);
  assert.match(web, /run: scripts\/ci\/build-staging-web-runtime\.sh/u);
  assert.match(web, /Build the standalone Web runtime once/u);
  assert.match(web, /--file Dockerfile\.staging-web-runtime/u);
  assert.match(web, /"\$RUNNER_TEMP\/web-runtime-context"/u);
  assert.doesNotMatch(web, /type=gha|mode=max/u);
});

test("the diagnostic inventory executes completely and fails closed on symlinks", () => {
  const script = runScript(workflowStep(web, "Measure PR-only Web compiler cache candidates"));
  const measured = runDiagnosticScript(script);

  assert.equal(measured.status, 0, measured.stderr);
  assert.equal(measured.archiveExists, false);
  assert.match(measured.stdout, /^next_cache_directory_v1 path=\. apparent_bytes=111 allocated_bytes=222 files=3$/mu);
  assert.match(measured.stdout, /^next_cache_directory_v1 path=\.rsc apparent_bytes=111 allocated_bytes=222 files=1$/mu);
  assert.match(measured.stdout, /^next_cache_directory_v1 path=swc apparent_bytes=111 allocated_bytes=222 files=1$/mu);
  assert.match(measured.stdout, /^next_cache_directory_v1 path=webpack apparent_bytes=111 allocated_bytes=222 files=1$/mu);
  assert.match(measured.stdout, /^next_cache_directory_v1 path=webpack\/client-production apparent_bytes=111 allocated_bytes=222 files=1$/mu);
  assert.match(measured.stdout, /^next_cache_compression_v1 compressed_bytes=333 elapsed_seconds=7$/mu);
  assert.match(measured.stdout, /^next_cache_diagnostic_v1 archive_deleted=true upload=false save=false$/mu);
  assert.notEqual(runDiagnosticScript(script, { cacheState: "missing" }).status, 0);
  assert.notEqual(runDiagnosticScript(script, { cacheState: "rootSymlink" }).status, 0);
  const nestedSymlink = runDiagnosticScript(script, { cacheState: "nestedSymlink" });
  assert.notEqual(nestedSymlink.status, 0);
  assert.equal(nestedSymlink.archiveExists, false);
});

test("every candidate action is bound to a reviewed immutable commit", () => {
  const pins = new Map([
    ["actions/checkout", "d23441a48e516b6c34aea4fa41551a30e30af803"],
    ["actions/setup-node", "49933ea5288caeca8642d1e84afbd3f7d6820020"],
    ["pnpm/action-setup", "b906affcce14559ad1aafd4ab0e942779e9f58b1"],
    ["docker/setup-buildx-action", "37fe631027851001ddb9b187196cc803df7f5f0e"],
    ["actions/upload-artifact", "ea165f8d65b6e75b540449e92b4886f43607fa02"],
  ]);
  const uses = [...web.matchAll(/^\s+uses:\s+([^\s#]+)(?:\s+#.*)?$/gmu)].map((match) => match[1]);
  assert.deepEqual(new Set(uses.map((use) => use.split("@")[0])), new Set(pins.keys()));
  for (const use of uses) {
    const [name, sha] = use.split("@");
    assert.equal(sha, pins.get(name), `${name} pin drift`);
  }
});
