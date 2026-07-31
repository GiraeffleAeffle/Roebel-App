import { NextcloudError } from "./nextcloud";

/**
 * `ensureGroupFolder` refused to bind because the matched folder already
 * carries a DIFFERENT org's group. Defence in depth alongside the app
 * layer's mount point (`orgFolderMount(accountId)`, unique by construction):
 * two independent mechanisms — an unguessable, unique-by-construction mount
 * point, AND this refusal — both have to fail before one org's group could
 * ever land on another org's folder.
 */
export class GroupFolderConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroupFolderConflictError";
  }
}

/**
 * Nextcloud provisioning over OCS. Every operation is create-if-absent, because
 * it runs on the request path — a citizen's first entry into the workspace —
 * and must be safe to hit concurrently from two tabs.
 */
export interface Provisioner {
  ensureUser(sub: string, displayName: string): Promise<{ created: boolean }>;
  ensureGroup(groupId: string): Promise<{ created: boolean }>;
  ensureGroupFolder(params: {
    name: string;
    groupId: string;
    /**
     * Optional per-role permission bitmask (read=1, update=2, create=4,
     * delete=8, share=16, all=31) applied to this group's binding on the
     * folder. Defense in depth alongside the API layer's `canWrite`
     * enforcement (Task 10) — Nextcloud's own ACL now agrees with it rather
     * than leaving every bound group at the groupfolders default of full
     * access. Omitted entirely, the binding is left exactly as Nextcloud
     * defaults it (unchanged behaviour for any caller that does not pass
     * this).
     */
    permissions?: number;
  }): Promise<{
    folderId: number;
    created: boolean;
    /**
     * Present only when more than one groupfolder shares `name`. This is the
     * one honest side effect of the two-tab race documented on
     * `ensureGroupFolder` below: this client cannot stop a second duplicate
     * row from being created, so it surfaces the fact rather than hiding it
     * behind a bare success. The ids listed are never the one returned as
     * `folderId`.
     */
    duplicateFolderIds?: number[];
  }>;
}

export interface ProvisionerOptions {
  baseUrl: string;
  adminUser: string;
  adminPassword: string;
  fetch?: typeof globalThis.fetch;
}

interface OcsEnvelope<T> {
  ocs: { meta: { statuscode: number }; data: T };
}

interface GroupFolderEntry {
  id: number;
  mount_point: string;
  // The real groupfolders listing endpoint includes each folder's bound
  // groups, keyed by group id. But an empty PHP associative array encodes as
  // JSON `[]`, not `{}` — a well-known PHP/JSON quirk — so "no groups yet"
  // can arrive as either shape, and older server versions may omit the field
  // entirely. Absence must be treated as "unknown", never as "confirmed not
  // bound" vs. "confirmed bound" — see `isGroupConfirmedBound`.
  groups?: Record<string, number> | unknown[];
}

// OCS's own status lives in this envelope, not in the HTTP status line — an
// OCS failure (including "not found") can arrive inside an HTTP 200. Every
// call below has to branch on `meta.statuscode`, never on `res.ok` alone.
const OCS_SUCCESS = 100;
/** OCS's uniform "this already exists" code for every create-type call. */
const OCS_ALREADY_EXISTS = 102;
const OCS_NOT_FOUND = 404;

/** True only when the listing positively confirms the group is bound —
 * `false` also covers "we don't know", which is the safe default: it just
 * costs one extra (idempotent) bind call, never a missed binding. */
function isGroupConfirmedBound(
  groups: GroupFolderEntry["groups"],
  groupId: string,
): boolean {
  if (!groups || Array.isArray(groups)) return false;
  return Object.prototype.hasOwnProperty.call(groups, groupId);
}

/** The bitmask the last listing positively showed for `groupId` on this
 * folder, or `undefined` when the listing does not confirm one (not bound
 * yet, the PHP `[]`-vs-`{}` quirk, or an older server omitting the field).
 * Mirrors `isGroupConfirmedBound`'s safe default: an ambiguous reading never
 * claims a specific bitmask, so the caller falls through to issuing the
 * (idempotent) permissions POST rather than trusting a guess. */
function currentPermissions(
  groups: GroupFolderEntry["groups"],
  groupId: string,
): number | undefined {
  if (!groups || Array.isArray(groups)) return undefined;
  return groups[groupId];
}

/** Pull the accountId out of an `org:<accountId>:<role>` group id, or `null`
 * if the string is not shaped that way (e.g. a future non-org groupId). */
function orgIdFromGroupId(groupId: string): string | null {
  const match = /^org:(.+):[^:]+$/.exec(groupId);
  return match ? match[1] : null;
}

/**
 * True only when the listing POSITIVELY shows a different org's group
 * already bound to this folder. Mirrors `isGroupConfirmedBound`'s safe
 * default: an ambiguous or absent `groups` value (the PHP `[]`-vs-`{}`
 * quirk, or an older server that omits the field) proves nothing either way,
 * so it is never treated as a conflict — only a confirmed `Record<string,
 * number>` entry for a DIFFERENT org's `org:*` group counts. Same-org,
 * different-role groups (binding `org:<id>:owner` when `org:<id>:member` is
 * already bound) are explicitly not a conflict — that is the normal
 * multi-role bind `ensureOrgFolder` performs.
 */
function boundToADifferentOrg(
  groups: GroupFolderEntry["groups"],
  groupId: string,
): boolean {
  if (!groups || Array.isArray(groups)) return false;
  const ourOrgId = orgIdFromGroupId(groupId);
  if (!ourOrgId) return false;
  return Object.keys(groups).some((existing) => {
    const existingOrgId = orgIdFromGroupId(existing);
    return existingOrgId !== null && existingOrgId !== ourOrgId;
  });
}

/** Deterministic choice so that every caller who observes the same set of
 * same-named folders — whatever order they call in, whichever one of them
 * did the creating — agrees on which single folder is "the" one. Ids are
 * assigned by the server in increasing order, so "lowest id" is a pure
 * function of shared server state, not of who happened to ask first. */
function canonicalFolder(folders: GroupFolderEntry[]): GroupFolderEntry {
  return folders.reduce((a, b) => (a.id <= b.id ? a : b));
}

export function createProvisioner(opts: ProvisionerOptions): Provisioner {
  const base = opts.baseUrl.replace(/\/+$/, "");
  const doFetch = opts.fetch ?? globalThis.fetch;
  const authorization = `Basic ${Buffer.from(
    `${opts.adminUser}:${opts.adminPassword}`,
  ).toString("base64")}`;

  async function ocs<T>(
    method: string,
    path: string,
    form?: Record<string, string>,
  ): Promise<OcsEnvelope<T>> {
    const headers: Record<string, string> = {
      Authorization: authorization,
      // Without this header Nextcloud rejects the request outright.
      "OCS-APIRequest": "true",
      Accept: "application/json",
    };
    let body: string | undefined;
    if (form) {
      headers["Content-Type"] = "application/x-www-form-urlencoded";
      body = new URLSearchParams(form).toString();
    }
    const res = await doFetch(`${base}${path}`, { method, headers, body });
    const text = await res.text();
    if (!res.ok) {
      throw new NextcloudError(res.status, `${method} ${path}: HTTP ${res.status}`);
    }
    try {
      return JSON.parse(text) as OcsEnvelope<T>;
    } catch {
      throw new NextcloudError(res.status, `${method} ${path}: non-JSON OCS reply`);
    }
  }

  /**
   * Verify a mutating OCS call actually succeeded. `res.ok` only proves the
   * *transport* worked — OCS reports both "not found" (404) and real write
   * failures (e.g. 104 "no permission", 101 "invalid input") as a statuscode
   * inside an HTTP 200, same as the well-known 404-inside-200 lookup case.
   * A caller that skips this check and only inspects `res.ok` will report
   * `{ created: true }` for a call that never actually created anything —
   * exactly the failure mode that matters most here, since this runs
   * unattended on the request path with nothing else watching for it.
   *
   * `acceptable` lists the statuscodes this particular call treats as
   * "done" — e.g. `OCS_ALREADY_EXISTS` for a create call that lost a
   * two-tab race, which is success, not a retryable error.
   */
  function assertOcsOk(
    envelope: OcsEnvelope<unknown>,
    context: string,
    acceptable: readonly number[],
  ): void {
    const code = envelope.ocs.meta.statuscode;
    if (!acceptable.includes(code)) {
      throw new NextcloudError(code, `${context}: OCS statuscode ${code}`);
    }
  }

  async function listGroupFolders(): Promise<GroupFolderEntry[]> {
    const listing = await ocs<Record<string, GroupFolderEntry>>(
      "GET",
      "/apps/groupfolders/folders?format=json",
    );
    assertOcsOk(listing, "list group folders", [OCS_SUCCESS]);
    return Object.values(listing.ocs.data ?? {});
  }

  /**
   * Idempotently make sure `groupId` can reach `folder`. Skips the network
   * call entirely when the listing already told us the binding exists;
   * otherwise issues the bind and tolerates OCS_ALREADY_EXISTS the same way
   * `ensureUser`/`ensureGroup` tolerate it on their own create calls — two
   * tabs binding the same group to the same folder is the same harmless
   * race, and Nextcloud's own "add group to folder" call is a set-membership
   * write, safe to repeat.
   *
   * Refuses outright — before issuing any request — when the listing
   * positively shows the folder already carries a DIFFERENT org's group.
   * Defence in depth: the app layer is expected to hand this function a
   * mount point that is already unique per org (`orgFolderMount(accountId)`),
   * so this should never fire in practice, but if that guarantee is ever
   * weakened by a future change, a real folder collision must be a hard
   * failure here too, not a silent additive bind.
   *
   * When `permissions` is given, it is also enforced — independently of
   * whether the bind itself was needed — against the folder's own ACL for
   * this group (Task 11: read=1/update=2/create=4/delete=8/share=16/all=31,
   * owner+admin get 31, member gets 1). This is defense in depth alongside
   * the API layer's `canWrite` check (Task 10): even a caller that bypasses
   * this codebase's own routes hits Nextcloud's ACL directly. Skipped when
   * the listing already shows the exact bitmask, the same idempotency
   * discipline as the bind itself — this runs on the request path and must
   * cost nothing beyond the listing on the common, nothing-changed case.
   */
  async function ensureGroupBound(
    folder: { id: number; groups?: GroupFolderEntry["groups"] },
    groupId: string,
    permissions?: number,
  ): Promise<void> {
    if (!isGroupConfirmedBound(folder.groups, groupId)) {
      if (boundToADifferentOrg(folder.groups, groupId)) {
        throw new GroupFolderConflictError(
          `refusing to bind ${groupId} onto folder ${folder.id}: already bound to a different org's group`,
        );
      }
      const bound = await ocs<unknown>(
        "POST",
        `/apps/groupfolders/folders/${folder.id}/groups?format=json`,
        { group: groupId },
      );
      assertOcsOk(bound, `bind group ${groupId} to folder ${folder.id}`, [
        OCS_SUCCESS,
        OCS_ALREADY_EXISTS,
      ]);
    }

    if (permissions === undefined) return;
    if (currentPermissions(folder.groups, groupId) === permissions) return;
    const updated = await ocs<unknown>(
      "POST",
      `/apps/groupfolders/folders/${folder.id}/groups/${encodeURIComponent(groupId)}?format=json`,
      { permissions: String(permissions) },
    );
    assertOcsOk(
      updated,
      `set permissions ${permissions} for group ${groupId} on folder ${folder.id}`,
      [OCS_SUCCESS],
    );
  }

  return {
    async ensureUser(sub, displayName) {
      const lookup = await ocs<unknown>(
        "GET",
        `/ocs/v1.php/cloud/users/${encodeURIComponent(sub)}?format=json`,
      );
      if (lookup.ocs.meta.statuscode !== OCS_NOT_FOUND) {
        // Anything other than "found" or "not found" — e.g. an expired admin
        // session surfaced as an OCS failure rather than an HTTP 401 — must
        // not be treated as "the user is already there".
        assertOcsOk(lookup, `lookup user ${sub}`, [OCS_SUCCESS]);
        return { created: false };
      }

      const created = await ocs<unknown>(
        "POST",
        "/ocs/v1.php/cloud/users?format=json",
        {
          userid: sub,
          displayName,
          // The account authenticates through OIDC; this password is never
          // used for login, and the OCS API refuses to create a user
          // without one.
          password: crypto.randomUUID() + crypto.randomUUID(),
        },
      );
      // A second tab may have created the same user between our lookup and
      // this call; OCS reports that as 102, which is success, not a retry.
      assertOcsOk(created, `create user ${sub}`, [OCS_SUCCESS, OCS_ALREADY_EXISTS]);
      return { created: created.ocs.meta.statuscode === OCS_SUCCESS };
    },

    async ensureGroup(groupId) {
      const created = await ocs<unknown>(
        "POST",
        "/ocs/v1.php/cloud/groups?format=json",
        { groupid: groupId },
      );
      assertOcsOk(created, `create group ${groupId}`, [OCS_SUCCESS, OCS_ALREADY_EXISTS]);
      return { created: created.ocs.meta.statuscode === OCS_SUCCESS };
    },

    /**
     * GUARANTEE this function actually offers — read before changing it.
     *
     * Unlike `ensureUser`/`ensureGroup`, this is NOT atomically idempotent.
     * OCS's groupfolders API has no create-if-absent primitive and
     * `mount_point` carries no uniqueness constraint server-side (there is
     * no analog to the 102 "already exists" dedup that users/groups get for
     * free) — creating a folder is a bare POST that always succeeds with a
     * fresh id. The check-then-act window between "list" and "create"
     * cannot be closed from an HTTP client. Two tabs that both miss the
     * listing WILL both create a row for the same name.
     *
     * So this function does not prevent the duplicate row — it converges
     * the *answer* despite it. Every caller that observes the same set of
     * same-named folders (whether found on the very first listing, or
     * uncovered by the re-list performed right after creating) picks the
     * lowest folder id as canonical — a deterministic function of shared
     * server state, so concurrent callers agree without coordinating — and
     * idempotently ensures the group reaches THAT id. Two tabs racing this
     * call always end up reporting the same `folderId`, both able to reach
     * it through the group, even though the server may be left holding an
     * extra row.
     *
     * It deliberately does NOT delete the loser. A duplicate discovered on
     * the very first listing could be old, could already carry its own
     * group binding or content from outside this code path — this client
     * has no way to know, and deleting on a guess is the wrong failure mode
     * for citizens' files. So a lost race leaves an inert, group-less
     * duplicate that nothing in this codebase ever binds a group to or
     * writes into; `duplicateFolderIds` surfaces it for a human to clean up
     * by hand, rather than the result silently reporting bare success.
     *
     * A partially-provisioned folder — created, but the group bind failed
     * or was never reached — self-heals on the next call: an existing
     * folder always has its group binding (re-)ensured, never assumed from
     * its mere presence in the listing.
     */
    async ensureGroupFolder({ name, groupId, permissions }) {
      const matches = (await listGroupFolders()).filter(
        (folder) => folder.mount_point === name,
      );

      if (matches.length > 0) {
        const canonical = canonicalFolder(matches);
        await ensureGroupBound(canonical, groupId, permissions);
        const duplicateFolderIds = matches
          .filter((folder) => folder.id !== canonical.id)
          .map((folder) => folder.id);
        return {
          folderId: canonical.id,
          created: false,
          ...(duplicateFolderIds.length > 0 ? { duplicateFolderIds } : {}),
        };
      }

      const created = await ocs<{ id: number }>(
        "POST",
        "/apps/groupfolders/folders?format=json",
        { mountpoint: name },
      );
      assertOcsOk(created, `create group folder ${name}`, [OCS_SUCCESS]);
      const ownFolderId = created.ocs.data.id;

      // Re-list rather than trusting our own create response in isolation —
      // this is the only way to notice a concurrent caller who also missed
      // the first listing and created a same-named folder in the meantime
      // (see the GUARANTEE comment above). This extra round trip only ever
      // happens once per org (group-folder creation is a one-time bootstrap
      // event, not a per-request cost), so it is not on the hot path.
      const afterCreate = (await listGroupFolders()).filter(
        (folder) => folder.mount_point === name,
      );
      const canonical =
        afterCreate.length > 0 ? canonicalFolder(afterCreate) : { id: ownFolderId };

      // The folder now exists on the server whether or not the bind below
      // succeeds. If it fails, throw rather than reporting `created: true`
      // on a folder the group can't reach — the caller must see this as a
      // failure, not a false success, even though a folder row now exists.
      await ensureGroupBound(canonical, groupId, permissions);

      const duplicateFolderIds = afterCreate
        .filter((folder) => folder.id !== canonical.id)
        .map((folder) => folder.id);

      return {
        folderId: canonical.id,
        created: canonical.id === ownFolderId,
        ...(duplicateFolderIds.length > 0 ? { duplicateFolderIds } : {}),
      };
    },
  };
}
