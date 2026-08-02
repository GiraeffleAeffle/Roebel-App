import { createClient } from "@/lib/supabase/server";
import { hasSupabase } from "@/lib/record";
import { LMPageClient } from "@/components/landesmeisterschaft/LMPageClient";

// Paste the Supabase UUID of the Landesmeisterschaft event here
const LM_EVENT_ID = "eb1b3a37-bf77-4e1e-b9d5-35c6491b03bd";

const YOUTUBE_TRAILER_URL = "https://www.youtube.com/watch?v=4PejO0HOOX0";

export default async function LandesmeisterschaftPage() {
  let livestreamActive = false;
  let livestreamUrl = "";

  // Livestream fields are a Supabase-only operational signal (no record
  // equivalent — EventRow publishes no livestream tags) — stay off rather
  // than throw on the keyless Proxy.
  if (LM_EVENT_ID && hasSupabase) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("events")
      .select("livestream_active, livestream_url")
      .eq("id", LM_EVENT_ID)
      .single();

    livestreamActive = data?.livestream_active ?? false;
    livestreamUrl = data?.livestream_url ?? "";
  }

  return (
    <LMPageClient
      livestreamActive={livestreamActive}
      livestreamUrl={livestreamUrl}
      trailerUrl={YOUTUBE_TRAILER_URL}
    />
  );
}
