import { createServerClient as createSupabaseServerClient } from "@supabase/ssr"
import { cookies } from "next/headers"
import type { SupabaseClient } from "@supabase/supabase-js"

// Browser requests keep the same-origin public read path. Server-side readers
// prefer the namespace-local read gateway so they do not hairpin through the
// public load balancer. Both paths use the public anon key and remain GET/HEAD-only.
const supabaseUrl =
  process.env.ROEBEL_SERVER_SUPABASE_URL ??
  process.env.ROEBEL_PUBLIC_SUPABASE_URL ??
  process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey =
  process.env.ROEBEL_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/** In record mode any ACCESS of the client throws with a clear message, so an
 * unported private-data path surfaces as a visible error, not a
 * construction-time crash (`createServerClient` validates url/key eagerly).
 * Same treatment as `lib/supabase.ts`'s `keylessProxy` / `lib/supabase/client.ts`. */
function keylessProxy(): SupabaseClient {
  return new Proxy({} as SupabaseClient, {
    get(_t, prop) {
      throw new Error(
        `Supabase ist nicht konfiguriert (record mode) — '${String(prop)}' ist ohne Backend nicht verfügbar.`,
      )
    },
  })
}

export async function createServerClient() {
  return await createClient()
}

export async function createClient(): Promise<SupabaseClient> {
  if (!supabaseUrl || !supabaseAnonKey) return keylessProxy()

  const cookieStore = await cookies()

  return createSupabaseServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        } catch {
          // The `setAll` method was called from a Server Component.
          // This can be ignored if you have middleware refreshing
          // user sessions.
        }
      },
    },
  })
}
