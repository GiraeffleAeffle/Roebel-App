import { createBrowserClient } from "@supabase/ssr"
import type { SupabaseClient } from "@supabase/supabase-js"

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

/** In record mode any ACCESS of the client throws with a clear message, so an
 * unported private-data path surfaces as a visible error, not a
 * construction-time crash on every render (`createBrowserClient` validates
 * url/key eagerly, and during SSR of a "use client" component the browser
 * singleton short-circuit is skipped, so it throws on the server for every
 * request). Same treatment as `lib/supabase.ts`'s `keylessProxy`. */
function keylessProxy(): SupabaseClient {
  return new Proxy({} as SupabaseClient, {
    get(_t, prop) {
      throw new Error(
        `Supabase ist nicht konfiguriert (record mode) — '${String(prop)}' ist ohne Backend nicht verfügbar.`,
      )
    },
  })
}

export function createClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) return keylessProxy()
  return createBrowserClient(supabaseUrl, supabaseAnonKey)
}
