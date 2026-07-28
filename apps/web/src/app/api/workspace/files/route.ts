import { NextResponse } from "next/server";
import { buildAction, GroupFolderConflictError } from "@netizen-labs/workspace";
import { ensureOrgFolder, requireWorkspace, resolveScope } from "@/lib/workspace/context";
import { errorResponse, parseScopeRequest } from "@/lib/workspace/request";
import { recordWorkspaceAction } from "@/lib/workspace/provenance-sink";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { session, client, provisioner } = await requireWorkspace();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = await resolveScope({ session, ...parsed });
    // Best-effort, and only reachable at all once resolveScope above has
    // already authorised this citizen for this org via the `groups`-claim
    // ACL check. What makes "best effort" safe here is that the folder this
    // call provisions is orgFolderMount(accountId) — derived from that same
    // ACL-checked accountId alone, never from any name — so a failure here
    // can only affect the caller's own already-authorised folder, never let
    // it reach or collide with a different org's. A transient OCS admin-API
    // hiccup (a separate credential path from the citizen's own
    // bearer-token listing call below) must not blank an otherwise-healthy
    // file list. ensureOrgFolder is already a no-op for a personal scope and
    // for any org this process has already confirmed provisioned. Do not
    // reintroduce a name-based lookup here — see the incident writeup on
    // resolveScope in lib/workspace/context.ts.
    await ensureOrgFolder({ session, client, provisioner }, scope).catch((error) => {
      if (error instanceof GroupFolderConflictError) {
        // Not an ordinary provisioning flake: this is ensureGroupBound's own
        // defence-in-depth refusal firing, which only happens if two orgs'
        // groups are colliding on one folder — i.e. the app-layer guarantee
        // above (unique-by-construction folder naming) has somehow been
        // defeated. That is a security-relevant event, not a transient OCS
        // timeout, so it gets its own greppable/alertable prefix instead of
        // blending into ordinary provisioning-failure noise. Still
        // best-effort: the listing must render regardless, same as below.
        console.error("[workspace][SECURITY] GroupFolderConflictError in ensureOrgFolder:", error);
        return;
      }
      console.error("[workspace] ensureOrgFolder failed:", error);
    });
    return NextResponse.json({ entries: await client.listDirectory(scope, parsed.path) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { session, client } = await requireWorkspace();
    const parsed = parseScopeRequest(new URL(request.url));
    const scope = await resolveScope({ session, ...parsed });
    await client.remove(scope, parsed.path);
    await recordWorkspaceAction(
      buildAction({
        actor: { kind: "human", sub: session.sub },
        kind: "delete",
        scope,
        path: parsed.path,
      }),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
