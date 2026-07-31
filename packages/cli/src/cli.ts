import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parseManifest, type NetizenManifest } from "@netizen-labs/protocol";
import { renderBundle, type Bundle } from "./render.js";
import { doctor, formatDoctorReport, checkIdpDrift } from "./doctor.js";
import { applyOverSsh } from "./executor.js";

const loadManifest = (p: string): NetizenManifest =>
  parseManifest(JSON.parse(readFileSync(resolve(p), "utf8")));

function writeBundle(bundle: Bundle, outDir: string): void {
  for (const [rel, content] of Object.entries(bundle.files)) {
    const full = join(outDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  copyRelaySyncBundle(bundle, outDir);
  copyVanishScanBundle(bundle, outDir);
}

/**
 * The allow-list syncer ships as a single pre-built file rather than as text the
 * renderer emits, because it is a real program with dependencies (viem, nostr
 * crypto) — not config. It is copied in here so `netizen up` carries it like any
 * other bundle file, instead of the operator scp-ing it to /root by hand.
 *
 * Missing artifact is a WARNING, not a failure: the rest of the node is fine
 * without it, and the compose service simply will not start. Saying nothing
 * would leave an operator wondering why membership never syncs.
 */
function copyRelaySyncBundle(bundle: Bundle, outDir: string): void {
  if (!bundle.files["docker-compose.yml"]?.includes("relay-sync:")) return;
  const built = fileURLToPath(new URL("../../relay-sync/dist/relay-sync.cjs", import.meta.url));
  if (!existsSync(built)) {
    console.warn(
      "warning: relay-sync is declared but dist/relay-sync.cjs is missing — membership will NOT sync.\n" +
        "         build it first: pnpm --filter @netizen-labs/relay-sync build",
    );
    return;
  }
  const dest = join(outDir, "relay-sync", "relay-sync.cjs");
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(built, dest);
}

/**
 * The vanish scanner ships the same way as the allow-list syncer, and for the
 * same reason: a real program (WebSocket client, JSON verification), not
 * config. Without it the executor idles on an empty queue — deletion requests
 * would be silently ignored, which is exactly what the Datenschutzerklärung
 * says we do not do. Hence the loud warning.
 */
function copyVanishScanBundle(bundle: Bundle, outDir: string): void {
  if (!bundle.files["docker-compose.yml"]?.includes("vanish-scan:")) return;
  const built = fileURLToPath(new URL("../../relay-sync/dist/vanish-scan.cjs", import.meta.url));
  if (!existsSync(built)) {
    console.warn(
      "warning: vanish-scan is declared but dist/vanish-scan.cjs is missing — NIP-62/NIP-09 deletion requests will NOT be honoured.\n" +
        "         build it first: pnpm --filter @netizen-labs/relay-sync build",
    );
    return;
  }
  const dest = join(outDir, "vanish", "vanish-scan.cjs");
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(built, dest);
}

const [cmd, manifestPath, ...rest] = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = rest.indexOf(name);
  return i >= 0 ? rest[i + 1] : undefined;
};
const has = (name: string): boolean => rest.includes(name);

function requireManifest(usage: string): NetizenManifest {
  if (!manifestPath) {
    console.error(usage);
    process.exit(1);
  }
  return loadManifest(manifestPath);
}

switch (cmd) {
  case "render": {
    const m = requireManifest("usage: netizen render <manifest.json> [--out ./bundle]");
    const outDir = flag("--out") ?? "./bundle";
    const bundle = renderBundle(m);
    writeBundle(bundle, outDir);
    console.log(`Rendered node "${m.id}" → ${outDir}`);
    console.log(
      `  ${Object.keys(bundle.files).length} files · ${bundle.plan.length} steps · ${bundle.secretRefs.length} secrets to supply (see SECRETS.md)`,
    );
    break;
  }
  case "doctor": {
    const m = requireManifest("usage: netizen doctor <manifest.json> [--json]");
    const report = doctor(m);
    // Live check: the manifest declares the truth, so anything the keystone
    // serves differently is drift — and drift here means broken logins.
    const drift = await checkIdpDrift(m);

    if (has("--json")) {
      // Machine-readable, for an agent runtime rather than a person. Same facts,
      // no prose to scrape: `ok` is the single field a caller must branch on.
      const own = report.sovereignty.filter((s) => s.sovereign);
      process.stdout.write(
        JSON.stringify(
          {
            node: report.node,
            ok: drift.length === 0,
            drift,
            sovereignty: {
              score: `${own.length}/${report.sovereignty.length}`,
              owned: own.length,
              total: report.sovereignty.length,
              layers: report.sovereignty,
            },
            warnings: report.warnings,
            endpoints: report.endpoints,
            secretRefs: report.secretRefs,
            plan: report.plan,
          },
          null,
          2,
        ) + "\n",
      );
      if (drift.length > 0) process.exitCode = 1;
      break;
    }

    process.stdout.write(formatDoctorReport(report));
    if (drift.length === 0) {
      console.log("identity: keystone matches the manifest ✓");
    } else {
      console.log(`identity DRIFT (${drift.length}) — logins may fail:`);
      for (const f of drift) console.log(`  ! ${f.field}: expected ${f.expected}, got ${f.actual}`);
      process.exitCode = 1;
    }
    break;
  }
  case "up": {
    const m = requireManifest(
      "usage: netizen up <manifest.json> [--dry-run] [--host user@ip] [--identity ~/.ssh/key]",
    );
    const bundle = renderBundle(m);
    if (has("--dry-run")) {
      console.log(`Plan for "${m.id}" (dry run — nothing applied):`);
      bundle.plan.forEach((s, i) => console.log(`  ${i + 1}. [${s.phase}] ${s.title}`));
      break;
    }
    const host = flag("--host");
    if (!host) {
      console.error(
        "usage: netizen up <manifest.json> --host user@ip [--identity ~/.ssh/key]\n" +
          "Operator-run: executes from where your ssh key + the box's .env live. Or use --dry-run.",
      );
      process.exit(1);
    }
    const dir = join(tmpdir(), `netizen-${m.id}`);
    writeBundle(bundle, dir);
    console.log(`Applying node "${m.id}" → ${host} (bundle: ${dir})`);
    process.exit(applyOverSsh(dir, m.id, { host, identity: flag("--identity") }));
    break;
  }
  default:
    console.error("usage: netizen <render|up|doctor> <manifest.json>");
    process.exit(1);
}
