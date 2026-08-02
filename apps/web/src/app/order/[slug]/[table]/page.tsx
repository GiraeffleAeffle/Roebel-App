import { createClient } from "@/lib/supabase/server"
import type { Metadata } from "next"
import Link from "next/link"
import { DeepLinkRedirect } from "@/components/deep-link-redirect"
import { hasSupabase } from "@/lib/record"

const APP_STORE_URL = "https://apps.apple.com/de/app/r%C3%B6bel/id6754984699"
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=com.maxbrych.roebelonchain&hl=de"

interface PageProps {
  params: Promise<{ slug: string; table: string }>
}

// QR table ordering is a Supabase-only feature (no record equivalent) — in
// record mode there is no restaurant row to resolve. The page below already
// falls back to a generic "Restaurant" label and its only real job (send
// the visitor to the app stores) needs no backend at all, so this simply
// skips the lookup instead of crashing on the keyless Proxy.
async function getRestaurant(slug: string) {
  if (!hasSupabase) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from("restaurants")
    .select("name, slug")
    .eq("slug", slug)
    .single()
  return data
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug, table } = await params
  const restaurant = await getRestaurant(slug)
  const name = restaurant?.name || "Restaurant"
  return {
    title: `Tisch ${decodeURIComponent(table)} - ${name} | Röbel App`,
    description: `Bestelle direkt am Tisch ${decodeURIComponent(table)} bei ${name} mit der Röbel App.`,
  }
}

export default async function OrderFallbackPage({ params }: PageProps) {
  const { slug, table } = await params
  const decodedTable = decodeURIComponent(table)
  const restaurant = await getRestaurant(slug)
  const name = restaurant?.name || "Restaurant"

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <DeepLinkRedirect path={`/order/${slug}/${table}`} />

      <div className="max-w-sm w-full text-center space-y-8">
        {/* Icon */}
        <div className="text-6xl">🍽️</div>

        {/* Info */}
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold text-foreground">{name}</h1>
          <p className="text-lg text-muted-foreground">Tisch {decodedTable}</p>
        </div>

        {/* CTA */}
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Lade die Röbel App herunter, um direkt am Tisch zu bestellen.
          </p>

          <div className="flex flex-col gap-3">
            <Link
              href={APP_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-black text-white px-6 py-3 text-sm font-medium hover:bg-black/90 transition-colors"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
                <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.8-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
              </svg>
              App Store
            </Link>

            <Link
              href={PLAY_STORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-black text-white px-6 py-3 text-sm font-medium hover:bg-black/90 transition-colors"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current" aria-hidden="true">
                <path d="M3.609 1.814L13.792 12 3.61 22.186a.996.996 0 0 1-.61-.92V2.734a1 1 0 0 1 .609-.92zm10.89 10.893l2.302 2.302-10.937 6.333 8.635-8.635zm3.199-3.199l2.807 1.626a1 1 0 0 1 0 1.732l-2.807 1.626L15.206 12l2.492-2.492zM5.864 2.658L16.8 8.99l-2.302 2.302-8.634-8.634z" />
              </svg>
              Google Play
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p className="text-xs text-muted-foreground">
          Bereits installiert? Der Link sollte automatisch in der App öffnen.
        </p>
      </div>
    </div>
  )
}
