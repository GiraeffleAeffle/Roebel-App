import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { hasSupabase } from "@/lib/record";

export const dynamic = "force-dynamic";

/**
 * Thin redirect so shared Expo deep-links / account UUIDs resolve to the
 * slug-based public org page on web. Record mode has no `accounts` UUID
 * table at all (record-mode org ids ARE the slug — see OrgRow.id) so an
 * old UUID deep-link can never resolve here; fail to not-found rather than
 * throw on the keyless Proxy.
 */
export default async function AccountByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!hasSupabase) notFound();

  const supabase = await createClient();
  const { data } = await supabase
    .from("accounts")
    .select("slug, account_type")
    .eq("id", id)
    .maybeSingle();

  if (!data || data.account_type !== "organisation" || !data.slug) notFound();
  redirect(`/app/orgs/${data.slug}`);
}
