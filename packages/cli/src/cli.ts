import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseManifest } from "@netizen-labs/protocol";
import { renderBundle } from "./render.js";
import { doctor, formatDoctorReport } from "./doctor.js";

const loadManifest = (p: string) => parseManifest(JSON.parse(readFileSync(resolve(p), "utf8")));

/** `netizen render <manifest> [--out ./bundle]` — writes the pure-render bundle. */
function cmdRender(manifestPath: string, outDir: string): void {
  const manifest = loadManifest(manifestPath);
  const bundle = renderBundle(manifest);
  for (const [rel, content] of Object.entries(bundle.files)) {
    const full = join(outDir, rel);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content);
  }
  console.log(`Rendered node "${manifest.id}" → ${outDir}`);
  console.log(
    `  ${Object.keys(bundle.files).length} files · ${bundle.plan.length} steps · ${bundle.secretRefs.length} secrets to supply (see SECRETS.md)`,
  );
}

const [cmd, manifestPath, ...rest] = process.argv.slice(2);
const outIdx = rest.indexOf("--out");
const outDir = outIdx >= 0 ? rest[outIdx + 1] : "./bundle";

switch (cmd) {
  case "render":
    if (!manifestPath) {
      console.error("usage: netizen render <manifest.json> [--out ./bundle]");
      process.exit(1);
    }
    cmdRender(manifestPath, outDir);
    break;
  case "doctor":
    if (!manifestPath) {
      console.error("usage: netizen doctor <manifest.json>");
      process.exit(1);
    }
    process.stdout.write(formatDoctorReport(doctor(loadManifest(manifestPath))));
    break;
  case "up": {
    if (!manifestPath) {
      console.error("usage: netizen up <manifest.json> [--dry-run] [--host user@ip]");
      process.exit(1);
    }
    const bundle = renderBundle(loadManifest(manifestPath));
    if (rest.includes("--dry-run")) {
      console.log(`Plan for "${loadManifest(manifestPath).id}" (dry run — nothing applied):`);
      bundle.plan.forEach((s, i) => console.log(`  ${i + 1}. [${s.phase}] ${s.title}`));
      break;
    }
    console.error(
      "The apply executor is P2b — it needs a provisioned box (see docs/HETZNER_SETUP.md) and a --host target.\n" +
        "For now: `netizen render` the bundle, then apply it per PLAN.md, or run `netizen up <manifest> --dry-run`.",
    );
    process.exit(2);
    break;
  }
  default:
    console.error("usage: netizen <render|up|doctor> <manifest.json>");
    process.exit(1);
}
