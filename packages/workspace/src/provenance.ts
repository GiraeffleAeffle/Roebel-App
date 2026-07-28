import type { Actor, WorkspaceScope } from "./types";

export type WorkspaceActionKind =
  | "upload"
  | "create-folder"
  | "update"
  | "move"
  | "delete";

/**
 * One auditable thing that happened in a workspace.
 *
 * Deliberately metadata-only. Slice 2 publishes this record to Nostr, where
 * deletion is advisory (NIP-09) and reads are open to the world — so document
 * content and personal data must never be able to reach it. The shape is the
 * enforcement, and a test pins the key set.
 */
export interface WorkspaceAction {
  actor: Actor;
  kind: WorkspaceActionKind;
  scopeKind: "personal" | "org";
  /** Org account id, or null for a personal scope. */
  accountId: string | null;
  /** Path relative to the scope root. */
  path: string;
  /** ISO 8601. */
  at: string;
}

export interface ProvenanceSink {
  /** Used only in the warning line when a sink fails. */
  name: string;
  record(action: WorkspaceAction): Promise<void>;
}

/**
 * Rebuild `actor` field by field rather than forwarding the caller's object.
 * The six-keys test only pins the top level of `WorkspaceAction`; without
 * this, a caller (or a boundary that deserializes JSON into an `Actor`
 * without re-validating its shape) could smuggle arbitrary extra fields —
 * email, displayName, anything — through `actor` and into a record bound
 * for a relay with no NIP-42/NIP-29: world-readable forever, deletion
 * advisory at best. Reconstructing per-variant is what makes the shape the
 * actual enforcement instead of a convention nobody re-checks upstream.
 */
function sanitizeActor(actor: Actor): Actor {
  if (actor.kind === "human") {
    return { kind: "human", sub: actor.sub };
  }
  return { kind: "agent", sub: actor.sub, actingFor: actor.actingFor };
}

export function buildAction(params: {
  actor: Actor;
  kind: WorkspaceActionKind;
  scope: WorkspaceScope;
  path: string;
  now?: Date;
}): WorkspaceAction {
  return {
    actor: sanitizeActor(params.actor),
    kind: params.kind,
    scopeKind: params.scope.kind,
    accountId: params.scope.kind === "org" ? (params.scope.accountId ?? null) : null,
    path: params.path,
    at: (params.now ?? new Date()).toISOString(),
  };
}

/**
 * A relay that accepts a connection and never acks is a more realistic
 * failure than one that promptly errors, and the caller awaits `record()`
 * on the request path — a citizen's save must not hang because a sink went
 * quiet. 5s is generous enough for a slow relay round-trip over the public
 * internet, short enough that a request never reads as frozen.
 */
const DEFAULT_SINK_TIMEOUT_MS = 5000;

/**
 * Invoke a sink and race it against a timeout, normalizing a synchronous
 * throw, an async rejection, and a hang into the same rejected-promise path
 * so the caller can handle all three identically.
 */
function recordWithTimeout(
  sink: ProvenanceSink,
  action: WorkspaceAction,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`sink "${sink.name}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    // Routing the call through a resolved-promise `.then` turns a synchronous
    // throw from `sink.record` into a normal rejection of this chain, the
    // same as a returned rejected promise — one code path handles both.
    Promise.resolve()
      .then(() => sink.record(action))
      .then(
        () => {
          clearTimeout(timer);
          resolve();
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
  });
}

/**
 * Fan out to every sink. Failures — synchronous throws, async rejections,
 * and timeouts alike — are logged, never thrown: the file operation has
 * already succeeded by the time we get here, and rejecting would report a
 * completed save as a failure. An unreachable or unresponsive relay must
 * not look like a lost document.
 */
export function createRecorder(
  sinks: ProvenanceSink[],
  options?: { timeoutMs?: number },
): (action: WorkspaceAction) => Promise<void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_SINK_TIMEOUT_MS;
  return async (action) => {
    await Promise.all(
      sinks.map(async (sink) => {
        try {
          await recordWithTimeout(sink, action, timeoutMs);
        } catch (error) {
          console.warn(
            `[workspace] provenance sink "${sink.name}" failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      }),
    );
  };
}
