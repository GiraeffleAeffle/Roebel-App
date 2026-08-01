import { createClient } from "@/lib/supabase/server"
import { MapView } from "@/components/maps/MapView"
import type { MapEvent, MapBusiness, MapRestaurant } from "@/components/maps/MapView"
import Link from "next/link"
import Image from "next/image"
import { hasSupabase } from "@/lib/record"

export const dynamic = "force-dynamic"

function KarteShell({ events, businesses, restaurants }: { events: MapEvent[]; businesses: MapBusiness[]; restaurants: MapRestaurant[] }) {
  return (
    <div className="h-screen flex flex-col">
      {/* Header */}
      <header className="h-14 border-b border-gray-100 bg-white flex items-center px-4 gap-3 flex-shrink-0">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Image src="/Logo-new.png" alt="Röbel App" width={105} height={24} className="h-6 w-auto object-contain" />
          <span className="text-lg font-medium text-gray-900">· Karte</span>
        </Link>
        <div className="flex-1" />
        <Link
          href="/app"
          className="text-sm text-primary hover:underline font-medium"
        >
          Zur App
        </Link>
      </header>

      {/* Map */}
      <div className="flex-1">
        <MapView
          events={events}
          businesses={businesses}
          restaurants={restaurants}
        />
      </div>
    </div>
  )
}

export default async function PublicKartePage() {
  if (!hasSupabase) {
    // Record mode: neither `EventRow` nor `OrgRow` (packages/record-client/
    // src/datasets.ts) carry latitude/longitude/address/phone today — the
    // town record has no geodata to plot. Rather than fabricate coordinates,
    // the map renders with no markers instead of crashing on the Supabase
    // client construction below.
    return <KarteShell events={[]} businesses={[]} restaurants={[]} />
  }

  const supabase = await createClient()

  const [eventsRes, businessesRes, restaurantsRes] = await Promise.all([
    supabase
      .from("events")
      .select("id, title, description, date, time, end_time, location, category, latitude, longitude, image_url, organizer_name")
      .eq("status", "approved")
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .order("date", { ascending: true }),
    supabase
      .from("businesses")
      .select("id, name, slug, category, description, address, latitude, longitude, logo_url, cover_image_url, phone, is_featured")
      .eq("status", "published")
      .not("latitude", "is", null)
      .not("longitude", "is", null),
    supabase
      .from("restaurants")
      .select("id, name, slug, description, address, latitude, longitude, logo_url, cover_image_url, phone")
      .in("status", ["approved", "published"])
      .not("latitude", "is", null)
      .not("longitude", "is", null),
  ])

  const events: MapEvent[] = (eventsRes.data || []).map((e) => ({
    id: e.id,
    title: e.title,
    description: e.description,
    date: e.date,
    time: e.time,
    end_time: e.end_time,
    location: e.location,
    category: e.category,
    latitude: Number(e.latitude),
    longitude: Number(e.longitude),
    image_url: e.image_url,
    organizer_name: e.organizer_name,
  }))

  const businesses: MapBusiness[] = (businessesRes.data || []).map((b) => ({
    id: b.id,
    name: b.name,
    slug: b.slug,
    category: b.category,
    description: b.description,
    address: b.address,
    latitude: Number(b.latitude),
    longitude: Number(b.longitude),
    logo_url: b.logo_url,
    cover_image_url: b.cover_image_url,
    phone: b.phone,
    is_featured: b.is_featured ?? false,
  }))

  const restaurants: MapRestaurant[] = (restaurantsRes.data || []).map((r) => ({
    id: r.id,
    name: r.name,
    slug: r.slug,
    description: r.description,
    address: r.address,
    latitude: Number(r.latitude),
    longitude: Number(r.longitude),
    logo_url: r.logo_url,
    cover_image_url: r.cover_image_url,
    phone: r.phone,
  }))

  return <KarteShell events={events} businesses={businesses} restaurants={restaurants} />
}
