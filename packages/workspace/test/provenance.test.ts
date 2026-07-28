import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAction,
  createRecorder,
  type ProvenanceSink,
  type WorkspaceAction,
} from "../src/provenance";
import type { WorkspaceScope } from "../src/types";

const scope: WorkspaceScope = {
  kind: "org",
  sub: "0xabc",
  accountId: "acc-7",
  folderName: "Org Feuerwehr",
};

describe("buildAction", () => {
  it("records who acted, on what, and when", () => {
    const action = buildAction({
      actor: { kind: "human", sub: "0xabc" },
      kind: "upload",
      scope,
      path: "Protokolle/2026.odt",
      now: new Date("2026-07-28T09:00:00Z"),
    });
    assert.deepEqual(action, {
      actor: { kind: "human", sub: "0xabc" },
      kind: "upload",
      scopeKind: "org",
      accountId: "acc-7",
      path: "Protokolle/2026.odt",
      at: "2026-07-28T09:00:00.000Z",
    });
  });

  it("keeps the delegation chain for an agent, which is the whole point", () => {
    const action = buildAction({
      actor: { kind: "agent", sub: "0xagent", actingFor: "0xabc" },
      kind: "update",
      scope,
      path: "Antrag.odt",
      now: new Date("2026-07-28T09:00:00Z"),
    });
    assert.deepEqual(action.actor, {
      kind: "agent",
      sub: "0xagent",
      actingFor: "0xabc",
    });
  });

  it("carries no accountId for a personal scope", () => {
    const action = buildAction({
      actor: { kind: "human", sub: "0xabc" },
      kind: "delete",
      scope: { kind: "personal", sub: "0xabc" },
      path: "alt.odt",
      now: new Date("2026-07-28T09:00:00Z"),
    });
    assert.equal(action.accountId, null);
  });

  // Slice 2 publishes this record to a world-readable, effectively
  // undeletable relay. Anything beyond these six keys would be permanent.
  it("has exactly the six keys and no content field", () => {
    const action = buildAction({
      actor: { kind: "human", sub: "0xabc" },
      kind: "upload",
      scope,
      path: "x.odt",
      now: new Date("2026-07-28T09:00:00Z"),
    });
    assert.deepEqual(Object.keys(action).sort(), [
      "accountId",
      "actor",
      "at",
      "kind",
      "path",
      "scopeKind",
    ]);
  });
});

describe("createRecorder", () => {
  it("writes to every sink", async () => {
    const seen: string[] = [];
    const sink = (name: string): ProvenanceSink => ({
      name,
      async record() {
        seen.push(name);
      },
    });
    const record = createRecorder([sink("postgres"), sink("nostr")]);
    await record(buildAction({
      actor: { kind: "human", sub: "0xabc" },
      kind: "upload",
      scope,
      path: "x.odt",
    }));
    assert.deepEqual(seen, ["postgres", "nostr"]);
  });

  // A failed audit write must not undo a file the citizen already saved.
  it("does not reject when a sink throws, and still writes the others", async () => {
    const seen: string[] = [];
    const failing: ProvenanceSink = {
      name: "broken",
      async record() {
        throw new Error("relay unreachable");
      },
    };
    const working: ProvenanceSink = {
      name: "postgres",
      async record() {
        seen.push("postgres");
      },
    };
    const record = createRecorder([failing, working]);
    await record(buildAction({
      actor: { kind: "human", sub: "0xabc" },
      kind: "upload",
      scope,
      path: "x.odt",
    }));
    assert.deepEqual(seen, ["postgres"]);
  });
});
