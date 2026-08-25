import { execFileSync } from "node:child_process";
import { build } from "esbuild";
import { resolveSourceRevision } from "./build-config.mjs";

const revision = resolveSourceRevision(
  process.env,
  () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  () => execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim() === "",
);
await build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  outfile: "dist/staging-participant-gateway.cjs",
  define: {
    __ROEBEL_STAGING_PARTICIPANT_GATEWAY_SOURCE_REVISION__: JSON.stringify(revision),
  },
});
