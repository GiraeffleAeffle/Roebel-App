import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildQualityCommands,
  parseQualityPackages,
} from "./run-affected-quality.mjs";

describe("affected quality runner", () => {
  it("preserves the complete historical quality suite for full changes", () => {
    assert.deepEqual(
      buildQualityCommands({ full: true, packages: [], webTests: true, testedPackages: [] }),
      [
        ["test:web"],
        ["lint"],
        ["typecheck"],
        ["exec", "turbo", "build", "--filter=!@roebel/web"],
      ],
    );
  });

  it("runs direct tests and a dependency-aware scoped Turbo graph", () => {
    assert.deepEqual(
      buildQualityCommands({
        full: false,
        packages: ["@netizen-labs/agent-watcher", "@netizen-labs/protocol"],
        webTests: false,
        testedPackages: ["@netizen-labs/agent-watcher", "@netizen-labs/protocol"],
      }),
      [
        ["--filter", "@netizen-labs/agent-watcher", "test"],
        ["--filter", "@netizen-labs/protocol", "test"],
        [
          "exec", "turbo", "lint", "typecheck",
          "--filter", "...@netizen-labs/agent-watcher...",
          "--filter", "...@netizen-labs/protocol...",
        ],
        [
          "exec", "turbo", "build", "--filter=!@roebel/web",
          "--filter", "...@netizen-labs/agent-watcher...",
          "--filter", "...@netizen-labs/protocol...",
        ],
      ],
    );
  });

  it("keeps Web tests without duplicating the authoritative Web build", () => {
    const commands = buildQualityCommands({
      full: false,
      packages: ["@netizen-labs/nostr"],
      webTests: true,
      testedPackages: ["@netizen-labs/nostr"],
    });
    assert.deepEqual(commands[0], ["test:web"]);
    assert.ok(commands.at(-1).includes("--filter=!@roebel/web"));
  });

  it("rejects unknown, duplicate, unsorted and empty scoped declarations", () => {
    assert.deepEqual(
      parseQualityPackages('["@netizen-labs/agent-watcher","@netizen-labs/protocol"]'),
      ["@netizen-labs/agent-watcher", "@netizen-labs/protocol"],
    );
    for (const value of [
      "not-json",
      '["unknown"]',
      '["@netizen-labs/protocol","@netizen-labs/agent-watcher"]',
      '["@netizen-labs/protocol","@netizen-labs/protocol"]',
    ]) {
      assert.throws(() => parseQualityPackages(value));
    }
    assert.throws(() => buildQualityCommands({
      full: false,
      packages: [],
      webTests: false,
      testedPackages: [],
    }));
  });
});
