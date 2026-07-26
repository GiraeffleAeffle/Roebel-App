import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseManifest } from "@netizen-labs/protocol";
import { renderBundle } from "./render.js";

/** `netizen render <manifest> [--out ./bundle]` — writes the pure-render bundle. */
function cmdRender(manifestPath: string, outDir: string): void {
  const manifest = parseManifest(JSON.parse(readFileSync(resolve(manifestPath), "utf8")));
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
  case "up":
  case "doctor":
    console.error(`\`netizen ${cmd}\` is the P2 executor — not built yet. Use \`netizen render\` and apply the bundle per PLAN.md.`);
    process.exit(2);
    break;
  default:
    console.error("usage: netizen <render|up|doctor> <manifest.json>");
    process.exit(1);
}
