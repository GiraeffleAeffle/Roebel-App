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

function scalar(step, name) {
  const match = step.match(new RegExp(`^\\s+${name}: (.+)$`, "mu"));
  assert.ok(match, `missing ${name} in workflow step`);
  return match[1].trim();
}

function pathEntries(step) {
  const match = step.match(/^\s+path: \|\n((?:\s{12}.+\n?)+)/mu);
  assert.ok(match, "missing path block in workflow step");
  return match[1].trim().split("\n").map((line) => line.trim());
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

function runSelectionScript(script, { fifo = false, includeClient = true, measuredBytes = 100, symlink = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "roebel-selected-cache-test-"));
  try {
    const bin = join(root, "bin");
    const cache = join(root, "cache");
    const archive = join(root, "selected.tar.zst");
    const output = join(root, "github-output");
    const tarArgs = join(root, "tar-args");
    const dateCounter = join(root, "date-counter");
    mkdirSync(bin);
    const selections = ["server-production", "edge-server-production"];
    if (includeClient) selections.push("client-production");
    for (const selected of selections) {
      mkdirSync(join(cache, "webpack", selected), { recursive: true });
      writeFileSync(join(cache, "webpack", selected, "pack"), selected);
    }
    if (symlink) symlinkSync(join(root, "target"), join(cache, "unsafe-link"));
    if (fifo) {
      const fifoResult = spawnSync("mkfifo", [join(cache, "unsafe-fifo")]);
      assert.equal(fifoResult.status, 0, "failed to create FIFO fixture");
    }

    const executables = {
      du: `case "$1" in -sb|-sB1) ;; *) exit 64 ;; esac\nprintf '%s\\t%s\\n' "$TEST_DU_BYTES" "\${@: -1}"`,
      tar: `printf '%s\\n' "$@" > "$TEST_TAR_ARGS"\nprintf compressed > "$3"`,
      stat: `test "$1" = -c && test "$2" = %s && test -f "$3"\nprintf '333\\n'`,
      date: `test "$1" = +%s\nif [[ -e "$TEST_DATE_COUNTER" ]]; then printf '107\\n'; else : > "$TEST_DATE_COUNTER"; printf '100\\n'; fi`,
    };
    for (const [name, body] of Object.entries(executables)) {
      const path = join(bin, name);
      writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}\n`);
      chmodSync(path, 0o755);
    }
    const result = spawnSync("bash", ["-c", script], {
      encoding: "utf8",
      env: {
        ...process.env,
        BASELINE_SELECTED_APPARENT_BYTES: "1688883560",
        CACHE_HIT: "true",
        GITHUB_OUTPUT: output,
        MAX_SELECTED_CACHE_BYTES: "2147483648",
        NEXT_CACHE_ROOT: cache,
        PATH: `${bin}:${process.env.PATH}`,
        SELECTED_CACHE_ARCHIVE: archive,
        TEST_DATE_COUNTER: dateCounter,
        TEST_DU_BYTES: String(measuredBytes),
        TEST_TAR_ARGS: tarArgs,
      },
    });
    return {
      ...result,
      archiveExists: existsSync(archive),
      githubOutput: existsSync(output) ? readFileSync(output, "utf8") : "",
      tarArgs: existsSync(tarArgs) ? readFileSync(tarArgs, "utf8") : "",
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

test("PR Web builds once and uses only the exact-head server cache selection", () => {
  const destination = workflowStep(web, "Guard the exact-head PR compiler cache destination");
  const restore = workflowStep(web, "Restore the exact-head PR server compiler cache");
  const restoreGuard = workflowStep(web, "Validate the exact-head PR server compiler cache");
  const diagnostic = workflowStep(web, "Measure PR-only Web compiler cache candidates");
  const selection = workflowStep(web, "Guard and measure the selected PR server compiler cache");
  const save = workflowStep(web, "Save the exact-head PR server compiler cache");
  const decision = workflowStep(web, "Log the exact-head PR server compiler cache decision");
  const upload = workflowStep(web, "Upload the private short-lived build result");
  const expectedPaths = [
    "${{ runner.temp }}/context/apps/web/.next/cache/webpack/server-production",
    "${{ runner.temp }}/context/apps/web/.next/cache/webpack/edge-server-production",
  ];
  const expectedKey = "roebel-web-pr-webpack-server-v1-${{ runner.os }}-${{ runner.arch }}-node22-pnpm9.15.0-head-${{ github.event.pull_request.head.sha }}";

  assert.equal((web.match(/uses: actions\/cache\/(?:restore|save)@/gu) ?? []).length, 2);
  assert.deepEqual(pathEntries(restore), expectedPaths);
  assert.deepEqual(pathEntries(save), expectedPaths);
  assert.equal(scalar(restore, "key"), expectedKey);
  assert.equal(scalar(save, "key"), expectedKey);
  assert.doesNotMatch(`${restore}\n${save}`, /restore-keys|client-production|node_modules|pnpm-store|runtime-context|\.oci/iu);
  assert.match(destination, /test "\$SOURCE_REVISION" = "\$PR_HEAD_REVISION"/u);
  assert.match(restore, /if: \$\{\{ github\.event_name == 'pull_request' \}\}/u);
  assert.match(save, /github\.event_name == 'pull_request'/u);
  assert.match(save, /steps\.next-cache-restore\.outputs\.cache-hit != 'true'/u);
  assert.match(save, /steps\.next-cache-selection\.outputs\.save_allowed == 'true'/u);
  assert.ok(
    restoreGuard.indexOf('find "$NEXT_CACHE_ROOT" -type l -print -quit') <
      restoreGuard.indexOf('find "$NEXT_CACHE_ROOT" ! -type d ! -type f -print -quit'),
    "special-entry rejection must follow the symlink guard",
  );
  assert.ok(
    restoreGuard.indexOf('find "$NEXT_CACHE_ROOT" ! -type d ! -type f -print -quit') <
      restoreGuard.indexOf('case "$CACHE_HIT" in'),
    "special entries must fail before restored cache measurement or use",
  );
  assert.match(restoreGuard, /selected_apparent_bytes < MAX_SELECTED_CACHE_BYTES/u);
  assert.match(restoreGuard, /selected_allocated_bytes < MAX_SELECTED_CACHE_BYTES/u);
  assert.match(selection, /BASELINE_SELECTED_APPARENT_BYTES: "1688883560"/u);
  assert.match(selection, /MAX_SELECTED_CACHE_BYTES: "2147483648"/u);
  assert.match(selection, /next_cache_selected_v1/u);
  assert.match(decision, /next_cache_save_v1 restore_hit=%s attempted=%s outcome=%s/u);
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
  assert.doesNotMatch(upload, /next-cache|\.next\/cache|node_modules|pnpm-store|runtime-context/u);
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

test("the selected server-cache guard enforces the strict budget and archive boundary", () => {
  const restoreScript = runScript(workflowStep(web, "Validate the exact-head PR server compiler cache"));
  const restored = runSelectionScript(restoreScript, { includeClient: false });
  assert.equal(restored.status, 0, restored.stderr);
  assert.match(restored.stdout, /^next_cache_restore_v1 hit=true apparent_bytes=200 allocated_bytes=200 files=2 /mu);
  assert.notEqual(runSelectionScript(restoreScript).status, 0, "a restored client cache must be rejected");
  assert.notEqual(runSelectionScript(restoreScript, { includeClient: false, measuredBytes: 1073741824 }).status, 0);
  assert.notEqual(runSelectionScript(restoreScript, { includeClient: false, symlink: true }).status, 0);
  assert.notEqual(runSelectionScript(restoreScript, { fifo: true, includeClient: false }).status, 0);

  const script = runScript(workflowStep(web, "Guard and measure the selected PR server compiler cache"));
  const selected = runSelectionScript(script);
  assert.equal(selected.status, 0, selected.stderr);
  assert.equal(selected.archiveExists, false);
  assert.match(selected.stdout, /^next_cache_selected_v1 apparent_bytes=200 allocated_bytes=200 files=2 compressed_bytes=333 elapsed_seconds=7 /mu);
  assert.equal(selected.githubOutput, "save_allowed=true\n");
  assert.match(selected.tarArgs, /^--zstd\n-cf\n.*selected\.tar\.zst\n-C\n.*\/cache\nwebpack\/server-production\nwebpack\/edge-server-production\n$/u);
  assert.doesNotMatch(selected.tarArgs, /client-production|node_modules|pnpm|oci|runtime/u);
  assert.notEqual(runSelectionScript(script, { measuredBytes: 1073741824 }).status, 0);
  const linked = runSelectionScript(script, { symlink: true });
  assert.notEqual(linked.status, 0);
  assert.equal(linked.archiveExists, false);
});

test("every candidate action is bound to a reviewed immutable commit", () => {
  const pins = new Map([
    ["actions/checkout", "d23441a48e516b6c34aea4fa41551a30e30af803"],
    ["actions/setup-node", "49933ea5288caeca8642d1e84afbd3f7d6820020"],
    ["pnpm/action-setup", "b906affcce14559ad1aafd4ab0e942779e9f58b1"],
    ["actions/cache/restore", "0400d5f644dc74513175e3cd8d07132dd4860809"],
    ["actions/cache/save", "0400d5f644dc74513175e3cd8d07132dd4860809"],
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
