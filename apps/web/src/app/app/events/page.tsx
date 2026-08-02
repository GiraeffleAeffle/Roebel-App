import { createClient } from "@/lib/supabase/server";
import { AppEventsContent } from "@/components/app/AppEventsContent";
import { hasSupabase, recordClient } from "@/lib/record";
import { listEvents, RecordUnavailableError } from "@netizen-labs/record-client";

export const dynamic = "force-dynamic";

export default async function AppEventsPage() {
  if (!hasSupabase) {
    try {
      const rows = await listEvents(recordClient, { limit: 200 });
      const events = rows
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((e) => ({
          id: e.id,
          title: e.title,
          description: e.description,
          date: e.date,
          time: e.time,
          end_time: e.end_time,
          location: e.location ?? "",
          // No record equivalent (eventToSpec never publishes organiser
          // contact data) — explicit neutral, never fabricated.
          organizer_name: "",
          organizer_email: "",
          organizer_phone: null,
          category: e.category,
          image_url: e.image_url,
          website_url: e.website_url,
          ticket_price: e.ticket_price !== null ? Number(e.ticket_price) : null,
          max_attendees: null,
          created_at: "",
          // eventToSpec never publishes the Supabase account id (privacy
          // boundary) — no org card to join here either way.
          account_id: null,
          accounts: null,
        }));
      return <AppEventsContent initialEvents={events} />;
    } catch (err) {
      if (err instanceof RecordUnavailableError) return <AppEventsContent initialEvents={[]} />;
      throw err;
    }
  }

  const supabase = await createClient();

  const { data: events } = await supabase
    .from("events")
    .select("*, accounts:account_id(id, name, avatar_url, account_type)")
    .eq("status", "approved")
    .order("date", { ascending: true });

  return <AppEventsContent initialEvents={events || []} />;
}
