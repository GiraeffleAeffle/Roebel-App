import { createClient } from "@supabase/supabase-js";
import type { WorkspaceSession } from "./session";

export interface SessionStore {
  create(id: string, session: WorkspaceSession): Promise<void>;
  get(id: string): Promise<WorkspaceSession | null>;
  update(id: string, session: WorkspaceSession): Promise<void>;
  destroy(id: string): Promise<void>;
}

function serviceClient() {
  const url = process.env.WORKSPACE_SESSION_DATABASE_URL;
  const key = process.env.WORKSPACE_SESSION_DATABASE_KEY;
  if (url || key || process.env.ROEBEL_PUBLIC_DEPLOYMENT_PROFILE === "talos_staging_synthetic_workflow") {
    if (!url || !key || key.length < 16 || /\s/u.test(key)) {
      throw new Error("workspace_session_database_configuration_incomplete");
    }
    const target = new URL(url);
    const direct = target.origin ===
      "http://roebel-tracer-postgrest.stadtstack-roebel-staging-lab.svc.cluster.local:3000";
    if ((!direct && target.protocol !== "https:") || target.username || target.password ||
      target.pathname !== "/" || target.search || target.hash) {
      throw new Error("workspace_session_database_url_invalid");
    }
    return createClient(target.origin, key, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
      global: {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          const destination = new URL(request.url);
          if (destination.origin !== target.origin || destination.pathname !== "/rest/v1/workspace_sessions") {
            throw new Error("workspace_session_database_request_invalid");
          }
          if (direct) destination.pathname = "/workspace_sessions";
          // Session credentials never follow a database redirect to another host.
          return globalThis.fetch(new Request(new Request(destination, request), { redirect: "error" }));
        },
      },
    });
  }
  // Existing production configuration remains supported. Staging uses the
  // dedicated runtime variables above instead of a compiled NEXT_PUBLIC value.
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
          groups: session.groups,
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
