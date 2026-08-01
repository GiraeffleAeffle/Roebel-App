import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Account, OrgSubType } from "@/types/account";
import { SUB_TYPE_LABELS } from "@/types/account";
import { hasSupabase, recordClient } from "@/lib/record";
import { getOrgBySlug, RecordUnavailableError } from "@netizen-labs/record-client";
import { OrgDetailClient } from "./OrgDetailClient";

export const dynamic = "force-dynamic";

const ORG_SUB_TYPES = new Set<string>(Object.keys(SUB_TYPE_LABELS));

/**
 * Record mode: `accounts` orgs and `businesses`-table entries (the separate
 * Gewerbe directory — see apps/web/src/app/actions/businesses.ts) both
 * publish under the same kind-0 `netizen_org` shape; `is_business` tells
 * them apart. Only `accounts` orgs render here — a `businesses` entry has no
 * `account_type`/`sub_type` at all, matching the Supabase branch's own
 * `account.account_type !== "organisation"` guard.
 */
async function getAccount(slug: string): Promise<Account | null> {
  if (!hasSupabase) {
    try {
      const org = await getOrgBySlug(recordClient, slug);
      if (!org || org.is_business) return null;
      // orgToSpec (packages/publisher/src/mappers.ts) publishes the row's
      // own sub_type directly under the profile's `category` key — for an
      // accounts org that key IS the real sub_type (businessToSpec is the
      // only mapper that overloads it with the "business" marker instead).
      const subType = org.category && ORG_SUB_TYPES.has(org.category) ? (org.category as OrgSubType) : null;
      return {
        // kind 0 carries no Supabase UUID (see OrgRow.id's own doc comment)
        // — the slug is reused as the id everywhere downstream in record
        // mode (supabase-org-content.ts, supabase-gastro.ts) resolve it
        // back to a pubkey via getOrgBySlug again.
        id: org.slug,
        account_type: "organisation",
        sub_type: subType,
        name: org.name,
        bio: org.bio,
        avatar_url: org.avatar_url,
        cover_url: org.cover_url,
        // No verification/moderation concept exists in record mode — only
        // published, non-withdrawn profiles are ever on the record at all.
        is_verified: false,
        slug: org.slug,
        is_extern: false,
        extern_status: null,
        extern_reason: null,
        extern_reviewed_by: null,
        extern_reviewed_at: null,
        // Never published (orgToSpec carries no contact-person data) — a
        // fork must not fabricate a contact address.
        contact_email: null,
        // orgToSpec only ever forwards opening_hours when it was ALREADY a
        // string on the Supabase row (str() rejects objects) — a real JSONB
        // opening_hours value is not published today, so this is null in
        // practice; parsed defensively in case that ever changes upstream.
        opening_hours: parseOpeningHours(org.opening_hours),
        created_at: "",
        updated_at: "",
      };
    } catch (error) {
      if (error instanceof RecordUnavailableError) return null;
      throw error;
    }
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("accounts")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  return (data as Account) ?? null;
}

function parseOpeningHours(raw: string | null): Account["opening_hours"] {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Account["opening_hours"];
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const account = await getAccount(slug);
  if (!account) return { title: "Organisation" };
  const sub = account.sub_type ? SUB_TYPE_LABELS[account.sub_type] : "Organisation";
  return {
    title: `${account.name} · ${sub}`,
    description: account.bio ?? undefined,
  };
}

export default async function OrgDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const account = await getAccount(slug);

  if (!account || account.account_type !== "organisation") notFound();
  // Hide extern orgs that are still pending / rejected approval.
  if (account.is_extern && account.extern_status !== "approved") notFound();

  return <OrgDetailClient account={account} />;
}
