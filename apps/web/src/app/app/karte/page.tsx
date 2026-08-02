import { createClient } from "@/lib/supabase/server"
import { MapView } from "@/components/maps/MapView"
import type { MapEvent, MapBusiness, MapRestaurant, MapCheckpoint } from "@/components/maps/MapView"
import { hasSupabase, recordClient } from "@/lib/record"
import { listEvents, RecordUnavailableError } from "@netizen-labs/record-client"

export const dynamic = "force-dynamic"

export default async function AppKartePage() {
  if (!hasSupabase) {
    // Same recovery rules as the public `/karte` page: `eventToSpec` DOES
    // publish latitude/longitude, so real event markers render below.
    // Businesses/restaurants/checkpoints stay empty — no coordinates are
    // ever published for a business or restaurant (see `/karte`'s own doc
    // comment), and `explorer_checkpoints` is a Supabase-only gamification
    // table with no record equivalent at all.
    let events: MapEvent[] = []
    try {
      const rows = await listEvents(recordClient, { limit: 200 })
      events = rows
        .filter((e): e is typeof e & { latitude: number; longitude: number } => e.latitude !== null && e.longitude !== null)
        .map((e) => ({
          id: e.id,
          title: e.title,
          description: e.description,
          date: e.date,
          time: e.time,
          end_time: e.end_time,
          location: e.location ?? e.address ?? "",
          category: e.category,
          latitude: e.latitude,
          longitude: e.longitude,
          image_url: e.image_url,
          // No record equivalent (eventToSpec never publishes organiser
          // contact data) — MapEvent allows null here, so no fake string.
          organizer_name: null,
        }))
    } catch (err) {
      if (!(err instanceof RecordUnavailableError)) throw err
      events = []
    }
    return (
      <div className="h-[calc(100vh-4rem)] -m-6">
        <MapView events={events} businesses={[]} restaurants={[]} checkpoints={[]} isAuthenticated />
      </div>
    )
  }

  const supabase = await createClient()

  const [eventsRes, businessesRes, restaurantsRes, checkpointsRes] = await Promise.all([
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
    supabase
      .from("explorer_checkpoints")
      .select("id, name, description, latitude, longitude, points_reward, badge_image_url, category")
      .eq("is_active", true),
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

  const checkpoints: MapCheckpoint[] = (checkpointsRes.data || []).map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    latitude: Number(c.latitude),
    longitude: Number(c.longitude),
    points_reward: c.points_reward,
    badge_image_url: c.badge_image_url,
    category: c.category,
  }))

  return (
    <div className="h-[calc(100vh-4rem)] -m-6">
      <MapView
        events={events}
        businesses={businesses}
        restaurants={restaurants}
        checkpoints={checkpoints}
        isAuthenticated
      />
    </div>
  )
}
