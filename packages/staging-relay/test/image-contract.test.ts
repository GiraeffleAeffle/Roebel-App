import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const baseDigest = "a17d50af28002a160548bd4225b3cfcb12c5efcb171f79e68758f2885fb1b066";

describe("staging relay image contract", () => {
  it("uses only the reviewed linux/amd64 Node base", () => {
    assert.equal(
      dockerfile.match(new RegExp(`FROM --platform=linux/amd64 docker\\.io/library/node@sha256:${baseDigest}`, "g"))?.length,
      2,
    );
  });

  it("binds provenance and deterministic build inputs", () => {
    assert.match(dockerfile, /ARG SOURCE_REVISION[\s\S]*test "\$\{#SOURCE_REVISION\}" -eq 40/);
    assert.match(dockerfile, /ARG SOURCE_DATE_EPOCH[\s\S]*case "\$\{SOURCE_DATE_EPOCH\}" in \*\[!0-9\]\*\)/);
    assert.match(dockerfile, /org\.opencontainers\.image\.source="https:\/\/github\.com\/GiraeffleAeffle\/Roebel-App"/);
  });

  it("runs only the bundled relay as a non-root user", () => {
    assert.match(dockerfile, /USER 65532:65532/);
    assert.match(dockerfile, /ENTRYPOINT \["node", "\/app\/staging-relay\.cjs"\]/);
    assert.doesNotMatch(dockerfile, /ARG .*SECRET|ENV .*SECRET/);
  });
});
