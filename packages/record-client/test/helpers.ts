import type { PublishSpec } from "@netizen-labs/publisher";

/**
 * A `PublishSpec` becomes the `RecordEvent` the index would serve (crypto
 * stubbed — parity is about content+tags, not signatures). Shared by every
 * `*.test.ts` in this package that pins a dataset reader to the publisher's
 * mappers, so the fixture shape lives in exactly one place.
 */
export function asRecordEvent(spec: PublishSpec, pubkey = "f".repeat(64)) {
  return {
    id: "0".repeat(64), pubkey, kind: spec.kind, created_at: spec.createdAt,
    content: spec.content, tags: [["d", spec.d], ...spec.tags.filter((t) => t[0] !== "d")].filter((t) => t[1] !== ""),
    sig: "0".repeat(128), node_id: "roebel", source: "test",
  };
}
