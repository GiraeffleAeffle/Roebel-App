import { createClient } from "@supabase/supabase-js";
import { createRecorder, type ProvenanceSink, type WorkspaceAction } from "@netizen-labs/workspace";

/**
 * Slice 1's only sink. Slice 2 adds a Nostr sink beside it — the call site does
 * not change, which is the point of routing every mutation through here.
 */
const postgresSink: ProvenanceSink = {
  name: "postgres",
  async record(action: WorkspaceAction) {
    const client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    );
    const { error } = await client.from("workspace_actions").insert({
      actor_kind: action.actor.kind,
      actor_sub: action.actor.sub,
      acting_for: action.actor.kind === "agent" ? action.actor.actingFor : null,
      kind: action.kind,
      scope_kind: action.scopeKind,
      account_id: action.accountId,
      path: action.path,
      at: action.at,
    });
    if (error) throw new Error(error.message);
  },
};

export const recordWorkspaceAction = createRecorder([postgresSink]);
