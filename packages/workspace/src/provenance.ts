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

export function buildAction(params: {
  actor: Actor;
  kind: WorkspaceActionKind;
  scope: WorkspaceScope;
  path: string;
  now?: Date;
}): WorkspaceAction {
  return {
    actor: params.actor,
    kind: params.kind,
    scopeKind: params.scope.kind,
    accountId: params.scope.kind === "org" ? (params.scope.accountId ?? null) : null,
    path: params.path,
    at: (params.now ?? new Date()).toISOString(),
  };
}

/**
 * Fan out to every sink. Failures are logged, never thrown: the file operation
 * has already succeeded by the time we get here, and rejecting would report a
 * completed save as a failure. An unreachable relay must not look like a lost
 * document.
 */
export function createRecorder(
  sinks: ProvenanceSink[],
): (action: WorkspaceAction) => Promise<void> {
  return async (action) => {
    await Promise.all(
      sinks.map(async (sink) => {
        try {
          await sink.record(action);
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
