"use server";

import { revalidatePath } from "next/cache";
import { generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildCopyPrompt,
  normalizeCopy,
  flyerCopySchema,
  FLYER_COPY_SYSTEM,
  type FlyerCopy,
  type FlyerEventContext,
} from "@/lib/flyer/copy";
import { resolveStyle } from "@/lib/flyer/styles";
import {
  buildFlyerImagePrompt,
  renderFlyerImage,
  renderFlyerImageWithReference,
} from "@/lib/flyer/render";
import type { Flyer, FlyerEventOption } from "@/types/flyer";

// Bounds gpt-image-1 cost. Counts flyers created by the account since UTC midnight.
const DAILY_CAP = 15;
const STORAGE_BUCKET = "images";

/**
 * Owner/admin guard (anon server client + account_owners — open-RLS + app-layer,
 * repo convention). Flyer rows/storage are then written with the admin client.
 */
async function assertOwner(
  accountId: string,
  walletAddress: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!accountId || !walletAddress) return { ok: false, error: "Pflichtangaben fehlen" };
  const supabase = await createClient();
  const { data: owner, error } = await supabase
    .from("account_owners")
    .select("role")
    .eq("account_id", accountId)
    .eq("wallet_address", walletAddress.toLowerCase())
    .maybeSingle();
  if (error || !owner) return { ok: false, error: "Keine Berechtigung für diese Organisation" };
  if (owner.role !== "owner" && owner.role !== "admin") {
    return { ok: false, error: "Nur Inhaber:innen oder Admins dürfen Flyer erstellen" };
  }
  return { ok: true };
}

/** Load an owned event as flyer copy context (owner-gated; null if not owned/found). */
async function loadEventContext(
  admin: ReturnType<typeof createAdminClient>,
  accountId: string,
  eventId: string,
): Promise<FlyerEventContext | null> {
  const { data } = await admin
    .from("events")
    .select(
      "title, date, time, end_time, location, description, category, ticket_price, website_url, organizer_name, image_url, account_id",
    )
    .eq("id", eventId)
    .maybeSingle();
  if (!data || data.account_id !== accountId) return null;
  return {
    title: data.title,
    date: data.date,
    time: data.time,
    end_time: data.end_time,
    location: data.location,
    description: data.description,
    category: data.category,
    ticket_price: data.ticket_price,
    website_url: data.website_url,
    organizer_name: data.organizer_name,
  };
}

/** The org's events, newest first, for the "aus Event übernehmen" picker. */
export async function getFlyerEventOptions(
  accountId: string,
  walletAddress: string,
): Promise<{ success: boolean; error?: string; events?: FlyerEventOption[] }> {
  const guard = await assertOwner(accountId, walletAddress);
  if (!guard.ok) return { success: false, error: guard.error };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("events")
      .select("id, title, date")
      .eq("account_id", accountId)
      .order("date", { ascending: false })
      .limit(50);
    if (error) {
      console.error("getFlyerEventOptions failed", error);
      return { success: false, error: "Events konnten nicht geladen werden." };
    }
    const events: FlyerEventOption[] = (data ?? []).map((e) => ({
      id: String((e as { id: string }).id),
      title: String((e as { title?: string }).title ?? "Event"),
      date: ((e as { date?: string | null }).date) ?? null,
    }));
    return { success: true, events };
  } catch (error) {
    console.error("getFlyerEventOptions threw", error);
    return { success: false, error: "Events konnten nicht geladen werden." };
  }
}

/** Draft editable German flyer copy (Claude Sonnet). Owner-gated. */
export async function draftFlyerCopyAction(
  accountId: string,
  walletAddress: string,
  brief: string,
  style: string,
  eventId?: string | null,
): Promise<{ success: boolean; error?: string; copy?: FlyerCopy }> {
  const guard = await assertOwner(accountId, walletAddress);
  if (!guard.ok) return { success: false, error: guard.error };
  if (!brief.trim() && !eventId) {
    return { success: false, error: "Bitte beschreibt kurz, worum es auf dem Flyer geht." };
  }
  try {
    const admin = createAdminClient();
    const event = eventId ? await loadEventContext(admin, accountId, eventId) : null;
    const resolvedStyle = resolveStyle(style);
    const { object } = await generateObject({
      model: anthropic("claude-sonnet-4-6"),
      schema: flyerCopySchema,
      system: FLYER_COPY_SYSTEM,
      prompt: buildCopyPrompt(brief, event, resolvedStyle),
    });
    return { success: true, copy: normalizeCopy(object as Partial<FlyerCopy>) };
  } catch (error) {
    console.error("draftFlyerCopyAction failed", error);
    return { success: false, error: "Der Text konnte nicht entworfen werden. Bitte erneut versuchen." };
  }
}

const MAX_REFERENCE_BYTES = 10 * 1024 * 1024; // 10 MB

/**
 * Only fetch references from our own Supabase storage host (where uploaded
 * references + event images live). Blocks SSRF to arbitrary/internal URLs — the
 * referenceUrl is client-supplied and fetched server-side.
 */
function isAllowedReferenceUrl(url: string): boolean {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.host === new URL(base).host;
  } catch {
    return false;
  }
}

/** Fetch a reference image (logo / event photo) for the gpt-image-1 edit path. Null on any problem. */
async function fetchReferenceImage(
  url: string,
): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  if (!isAllowedReferenceUrl(url)) return null;
  try {
    // redirect:"manual" fails closed — a redirect off the allowed host can't be followed.
    const res = await fetch(url, { redirect: "manual" });
    if (!res.ok) return null;
    const contentType = res.headers.get("content-type") ?? "image/png";
    if (!contentType.startsWith("image/")) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.byteLength === 0 || buf.byteLength > MAX_REFERENCE_BYTES) return null;
    return { bytes: buf, contentType };
  } catch (error) {
    console.error("fetchReferenceImage failed", error);
    return null;
  }
}

/** Render the flyer (gpt-image-1), upload it, and save the row. Owner-gated + daily-capped. */
export async function generateFlyerAction(
  accountId: string,
  walletAddress: string,
  input: {
    title: string;
    brief: string;
    copy: FlyerCopy;
    style: string;
    eventId?: string | null;
    referenceUrl?: string | null;
  },
): Promise<{ success: boolean; error?: string; flyer?: Flyer }> {
  const guard = await assertOwner(accountId, walletAddress);
  if (!guard.ok) return { success: false, error: guard.error };
  try {
    const admin = createAdminClient();

    // Daily cap — count this account's flyers since UTC midnight.
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const { count, error: countErr } = await admin
      .from("flyers")
      .select("id", { count: "exact", head: true })
      .eq("account_id", accountId)
      .gte("created_at", startOfDay.toISOString());
    if (countErr) console.error("generateFlyerAction cap-count failed", countErr);
    if ((count ?? 0) >= DAILY_CAP) {
      return {
        success: false,
        error: `Tageslimit erreicht (${DAILY_CAP} Flyer). Bitte morgen weitermachen.`,
      };
    }

    // Validate the event linkage against THIS account (mirror the draft path) so
    // a caller can't link a flyer to another org's event, and drop empty strings
    // before they hit the uuid column. Do this before the expensive render.
    const rawEventId = input.eventId && input.eventId.trim() ? input.eventId : null;
    let validEventId: string | null = null;
    if (rawEventId) {
      const owned = await loadEventContext(admin, accountId, rawEventId);
      validEventId = owned ? rawEventId : null;
    }

    // Optional reference image (org logo / event photo) → gpt-image-1 edit path.
    // Best-effort: an unfetchable reference falls back to plain text-to-image.
    const reference = input.referenceUrl ? await fetchReferenceImage(input.referenceUrl) : null;

    const copy = normalizeCopy(input.copy);
    const resolvedStyle = resolveStyle(input.style);
    const prompt = buildFlyerImagePrompt(copy, resolvedStyle, { hasReference: !!reference });

    const bytes = reference
      ? await renderFlyerImageWithReference(prompt, reference)
      : await renderFlyerImage(prompt);

    const filePath = `flyers/${accountId}/${crypto.randomUUID()}.png`;
    const { error: uploadErr } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, Buffer.from(bytes), { contentType: "image/png", upsert: false });
    if (uploadErr) {
      console.error("generateFlyerAction upload failed", uploadErr);
      return { success: false, error: "Der Flyer konnte nicht gespeichert werden." };
    }
    const { data: urlData } = admin.storage.from(STORAGE_BUCKET).getPublicUrl(filePath);
    const imageUrl = urlData.publicUrl;

    const { data, error: insertErr } = await admin
      .from("flyers")
      .insert({
        account_id: accountId,
        created_by_wallet: walletAddress.toLowerCase(),
        title: input.title.trim() || copy.headline || "Flyer",
        brief: input.brief ?? "",
        copy,
        style: resolvedStyle.id,
        image_url: imageUrl,
        event_id: validEventId,
        source: validEventId ? "event" : "brief",
        status: "saved",
      })
      .select("*")
      .single();
    if (insertErr || !data) {
      console.error("generateFlyerAction insert failed", insertErr);
      return { success: false, error: "Der Flyer konnte nicht gespeichert werden." };
    }

    revalidatePath("/dashboard/flyer");
    return { success: true, flyer: data as Flyer };
  } catch (error) {
    console.error("generateFlyerAction failed", error);
    const msg =
      error instanceof Error && error.message.includes("OPENAI_API_KEY")
        ? "Bildgenerierung ist nicht konfiguriert (OPENAI_API_KEY fehlt)."
        : "Der Flyer konnte nicht erstellt werden.";
    return { success: false, error: msg };
  }
}

/** Share a flyer as a normal image post in the main feed. Owner-gated + account-scoped. */
export async function postFlyerToFeed(
  accountId: string,
  walletAddress: string,
  flyerId: string,
  caption?: string,
): Promise<{ success: boolean; error?: string }> {
  const guard = await assertOwner(accountId, walletAddress);
  if (!guard.ok) return { success: false, error: guard.error };
  try {
    const admin = createAdminClient();
    const { data: flyer } = await admin
      .from("flyers")
      .select("image_url, title, account_id")
      .eq("id", flyerId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!flyer) return { success: false, error: "Flyer nicht gefunden" };

    const row = flyer as { image_url: string; title: string | null };
    const content = (caption?.trim() || row.title || "Unser neuer Flyer").slice(0, 240);
    // post_type 'user' (the default) — custom post types need a CHECK migration; a
    // flyer is just an image post, so no migration is required.
    const { error } = await admin.from("posts").insert({
      wallet_address: walletAddress.toLowerCase(),
      account_id: accountId,
      content,
      media_urls: [row.image_url],
      category: "generell",
      feed_type: "main",
      post_type: "user",
      status: "published",
    });
    if (error) {
      console.error("postFlyerToFeed failed", error);
      return { success: false, error: "Der Flyer konnte nicht geteilt werden." };
    }
    revalidatePath("/app");
    return { success: true };
  } catch (error) {
    console.error("postFlyerToFeed threw", error);
    return { success: false, error: "Der Flyer konnte nicht geteilt werden." };
  }
}

/** Set a flyer as an event's cover image (and link the flyer to it). Owner-gated + account-scoped. */
export async function attachFlyerToEvent(
  accountId: string,
  walletAddress: string,
  flyerId: string,
  eventId: string,
): Promise<{ success: boolean; error?: string }> {
  const guard = await assertOwner(accountId, walletAddress);
  if (!guard.ok) return { success: false, error: guard.error };
  try {
    const admin = createAdminClient();
    const { data: flyer } = await admin
      .from("flyers")
      .select("image_url, account_id")
      .eq("id", flyerId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!flyer) return { success: false, error: "Flyer nicht gefunden" };

    // Confirm the event belongs to this account before touching it.
    const { data: ev } = await admin
      .from("events")
      .select("id, account_id")
      .eq("id", eventId)
      .maybeSingle();
    if (!ev || (ev as { account_id: string | null }).account_id !== accountId) {
      return { success: false, error: "Keine Berechtigung für dieses Event." };
    }

    const { error: evErr } = await admin
      .from("events")
      .update({ image_url: (flyer as { image_url: string }).image_url })
      .eq("id", eventId)
      .eq("account_id", accountId);
    if (evErr) {
      console.error("attachFlyerToEvent event update failed", evErr);
      return { success: false, error: "Der Flyer konnte nicht angehängt werden." };
    }
    await admin
      .from("flyers")
      .update({ event_id: eventId, source: "event" })
      .eq("id", flyerId)
      .eq("account_id", accountId);

    revalidatePath("/dashboard/flyer");
    revalidatePath("/dashboard/events");
    return { success: true };
  } catch (error) {
    console.error("attachFlyerToEvent threw", error);
    return { success: false, error: "Der Flyer konnte nicht angehängt werden." };
  }
}

/** List the org's saved flyers (newest first). Owner-gated. */
export async function listFlyers(
  accountId: string,
  walletAddress: string,
): Promise<{ success: boolean; error?: string; flyers?: Flyer[] }> {
  const guard = await assertOwner(accountId, walletAddress);
  if (!guard.ok) return { success: false, error: guard.error };
  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("flyers")
      .select("*")
      .eq("account_id", accountId)
      .order("created_at", { ascending: false });
    if (error) {
      console.error("listFlyers failed", error);
      return { success: false, error: "Flyer konnten nicht geladen werden." };
    }
    return { success: true, flyers: (data ?? []) as Flyer[] };
  } catch (error) {
    console.error("listFlyers threw", error);
    return { success: false, error: "Flyer konnten nicht geladen werden." };
  }
}

/** Delete a flyer (row + best-effort storage object). Owner-gated + account-scoped. */
export async function deleteFlyer(
  accountId: string,
  walletAddress: string,
  flyerId: string,
): Promise<{ success: boolean; error?: string }> {
  const guard = await assertOwner(accountId, walletAddress);
  if (!guard.ok) return { success: false, error: guard.error };
  try {
    const admin = createAdminClient();
    // Fetch first so we can remove the storage object and confirm ownership.
    const { data: row } = await admin
      .from("flyers")
      .select("image_url, account_id")
      .eq("id", flyerId)
      .eq("account_id", accountId)
      .maybeSingle();
    if (!row) return { success: false, error: "Flyer nicht gefunden" };

    const { error } = await admin
      .from("flyers")
      .delete()
      .eq("id", flyerId)
      .eq("account_id", accountId);
    if (error) {
      console.error("deleteFlyer failed", error);
      return { success: false, error: "Flyer konnte nicht gelöscht werden." };
    }

    // Best-effort storage cleanup (derive the object path from the public URL).
    const marker = `/${STORAGE_BUCKET}/`;
    const url = (row as { image_url?: string }).image_url ?? "";
    const idx = url.indexOf(marker);
    if (idx !== -1) {
      const path = url.slice(idx + marker.length);
      await admin.storage.from(STORAGE_BUCKET).remove([path]);
    }

    revalidatePath("/dashboard/flyer");
    return { success: true };
  } catch (error) {
    console.error("deleteFlyer threw", error);
    return { success: false, error: "Flyer konnte nicht gelöscht werden." };
  }
}
