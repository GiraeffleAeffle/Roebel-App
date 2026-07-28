import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildAction,
  createRecorder,
  type ProvenanceSink,
  type WorkspaceAction,
} from "../src/provenance";
import type { Actor, WorkspaceScope } from "../src/types";

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

  // The six-keys test above only inspects the top level. `actor` is itself
  // an object, and a caller (or a boundary that deserializes JSON into an
  // `Actor` without re-validating it) could hand in extra fields riding
  // inside it — email, displayName, anything. Those must not survive,
  // because this record is destined for a relay with no NIP-42/NIP-29:
  // world-readable forever, deletion advisory at best. The shape has to be
  // the enforcement, which means reconstructing `actor` field by field
  // rather than forwarding the caller's object.
  it("drops any extra field riding inside a human actor, not just at the top level", () => {
    const dirtyActor = {
      kind: "human",
      sub: "0xabc",
      email: "citizen@example.com",
      displayName: "Max",
    } as Actor;
    const action = buildAction({
      actor: dirtyActor,
      kind: "upload",
      scope,
      path: "x.odt",
      now: new Date("2026-07-28T09:00:00Z"),
    });
    assert.deepEqual(action.actor, { kind: "human", sub: "0xabc" });
    assert.deepEqual(Object.keys(action.actor).sort(), ["kind", "sub"]);
  });

  it("drops any extra field riding inside an agent actor, keeping only kind/sub/actingFor", () => {
    const dirtyActor = {
      kind: "agent",
      sub: "0xagent",
      actingFor: "0xabc",
      note: "should not survive",
    } as Actor;
    const action = buildAction({
      actor: dirtyActor,
      kind: "update",
      scope,
      path: "x.odt",
      now: new Date("2026-07-28T09:00:00Z"),
    });
    assert.deepEqual(action.actor, {
      kind: "agent",
      sub: "0xagent",
      actingFor: "0xabc",
    });
    assert.deepEqual(Object.keys(action.actor).sort(), [
      "actingFor",
      "kind",
      "sub",
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

  // `ProvenanceSink.record` is typed to return `Promise<void>`, but a
  // sink whose `record` is a plain (non-async) function that throws
  // immediately is fully valid against that signature too — it never
  // returns, so the throw is compatible with any return type. That takes
  // a different path than an async rejection: the throw happens while
  // *calling* `sink.record(action)`, before there is anything to await.
  // This must be caught exactly like an async rejection, so a later
  // "simplification" to `sinks.map(s => s.record(a).catch(...))` (which
  // only catches rejections, not synchronous throws) doesn't quietly
  // reintroduce an uncaught-throw crash.
  it("catches a synchronous throw from a sink, not just a rejected promise", async () => {
    const seen: string[] = [];
    const failingSync: ProvenanceSink = {
      name: "broken-sync",
      record(): Promise<void> {
        throw new Error("sync boom");
      },
    };
    const working: ProvenanceSink = {
      name: "postgres",
      async record() {
        seen.push("postgres");
      },
    };
    const record = createRecorder([failingSync, working]);
    await record(buildAction({
      actor: { kind: "human", sub: "0xabc" },
      kind: "upload",
      scope,
      path: "x.odt",
    }));
    assert.deepEqual(seen, ["postgres"]);
  });

  // `Promise.all` waits for every entry. A sink that neither resolves nor
  // rejects — a relay that accepts a connection and never acks, which is
  // the realistic failure mode, not the tidy one — would otherwise hang
  // the whole recorder forever, and the caller awaits this on the request
  // path: a citizen's save would never complete. A timeout must bound
  // each sink and be treated exactly like any other sink failure.
  it("times out a hanging sink instead of blocking forever, and lets the others proceed", async () => {
    const seen: string[] = [];
    const hanging: ProvenanceSink = {
      name: "hanging-relay",
      record() {
        return new Promise<void>(() => {
          // never settles
        });
      },
    };
    const working: ProvenanceSink = {
      name: "postgres",
      async record() {
        seen.push("postgres");
      },
    };
    const record = createRecorder([hanging, working], { timeoutMs: 20 });

    const raced = await Promise.race([
      record(buildAction({
        actor: { kind: "human", sub: "0xabc" },
        kind: "upload",
        scope,
        path: "x.odt",
      })).then(() => "settled"),
      new Promise((resolve) => setTimeout(() => resolve("stalled"), 1500)),
    ]);

    assert.equal(raced, "settled");
    assert.deepEqual(seen, ["postgres"]);
  });
});
