import { createClient } from "@supabase/supabase-js";
import type { WorkspaceSession } from "./session";

export interface SessionStore {
  create(id: string, session: WorkspaceSession): Promise<void>;
  get(id: string): Promise<WorkspaceSession | null>;
  update(id: string, session: WorkspaceSession): Promise<void>;
  destroy(id: string): Promise<void>;
}

function serviceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function toSession(row: {
  sub: string;
  groups: string[] | null;
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
}): WorkspaceSession {
  return {
    sub: row.sub,
    groups: row.groups ?? [],
    accessToken: row.access_token,
    refreshToken: row.refresh_token,
    expiresAt: Date.parse(row.expires_at),
  };
}

export function createSessionStore(): SessionStore {
  return {
    async create(id, session) {
      const { error } = await serviceClient().from("workspace_sessions").insert({
        id,
        sub: session.sub,
        groups: session.groups,
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
        expires_at: new Date(session.expiresAt).toISOString(),
      });
      if (error) throw new Error(error.message);
    },

    async get(id) {
      const { data, error } = await serviceClient()
        .from("workspace_sessions")
        .select("sub, groups, access_token, refresh_token, expires_at")
        .eq("id", id)
        .maybeSingle();
      // A missing row is "not signed in", not a failure. An actual query error
      // IS a failure and must not be silently read as a logged-out user.
      if (error) throw new Error(error.message);
      return data ? toSession(data) : null;
    },

    async update(id, session) {
      const { error } = await serviceClient()
        .from("workspace_sessions")
        .update({
          access_token: session.accessToken,
          refresh_token: session.refreshToken,
          expires_at: new Date(session.expiresAt).toISOString(),
        })
        .eq("id", id);
      if (error) throw new Error(error.message);
    },

    async destroy(id) {
      // Consistent with create/get/update: a query error is a failure, not a
      // silent no-op. Left unchecked, a failed delete here reports as a
      // successful logout while the row — a live Nextcloud access token —
      // survives.
      const { error } = await serviceClient()
        .from("workspace_sessions")
        .delete()
        .eq("id", id);
      if (error) throw new Error(error.message);
    },
  };
}
