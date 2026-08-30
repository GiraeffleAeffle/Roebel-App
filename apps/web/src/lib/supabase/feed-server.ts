import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

import { createClient as createDefaultServerClient } from "./server";

const IN_CLUSTER_TRACER_POSTGREST_ORIGIN =
  "http://roebel-tracer-postgrest.stadtstack-roebel-staging-lab.svc.cluster.local:3000";

function createDirectPostgrestFetch(expectedOrigin: string): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init);
    const target = new URL(request.url);
    if (
      target.origin !== expectedOrigin ||
      (target.pathname !== "/rest/v1" &&
        !target.pathname.startsWith("/rest/v1/"))
    ) {
      throw new Error("roebel_feed_postgrest_request_invalid");
    }
    target.pathname = target.pathname.slice("/rest/v1".length) || "/";
    return globalThis.fetch(new Request(target, request));
  };
}

/**
 * The tracer feed can use a deliberately small, in-cluster PostgREST overlay
 * without redirecting the rest of the Röbel server to that partial schema.
 * When the two dedicated values are absent, every environment retains the
 * existing Supabase behavior.
 */
export async function createFeedServerClient(): Promise<SupabaseClient> {
  const url = process.env.ROEBEL_FEED_SUPABASE_URL;
  const anonKey = process.env.ROEBEL_FEED_SUPABASE_ANON_KEY;

  if (!url && !anonKey) return createDefaultServerClient();
  if (!url || !anonKey || anonKey.length < 16 || /\s/u.test(anonKey)) {
    throw new Error("roebel_feed_supabase_config_incomplete");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("roebel_feed_supabase_url_invalid");
  }
  const trustedClusterHttp =
    parsed.origin === IN_CLUSTER_TRACER_POSTGREST_ORIGIN;
  if (
    (parsed.protocol !== "https:" && !trustedClusterHttp) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/" ||
    parsed.search !== "" ||
    parsed.hash !== ""
  ) {
    throw new Error("roebel_feed_supabase_url_invalid");
  }

  return createSupabaseClient(url, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    ...(trustedClusterHttp
      ? {
          global: {
            fetch: createDirectPostgrestFetch(parsed.origin),
          },
        }
      : {}),
  });
}
