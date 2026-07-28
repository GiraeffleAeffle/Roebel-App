import { NextcloudError } from "./nextcloud";

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
  }): Promise<{ folderId: number; created: boolean }>;
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

// OCS's own status lives in this envelope, not in the HTTP status line — an
// OCS failure (including "not found") can arrive inside an HTTP 200. Every
// call below has to branch on `meta.statuscode`, never on `res.ok` alone.
const OCS_SUCCESS = 100;
/** OCS's uniform "this already exists" code for every create-type call. */
const OCS_ALREADY_EXISTS = 102;
const OCS_NOT_FOUND = 404;

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

    async ensureGroupFolder({ name, groupId }) {
      const listing = await ocs<Record<string, { id: number; mount_point: string }>>(
        "GET",
        "/apps/groupfolders/folders?format=json",
      );
      assertOcsOk(listing, "list group folders", [OCS_SUCCESS]);
      const existing = Object.values(listing.ocs.data ?? {}).find(
        (folder) => folder.mount_point === name,
      );
      if (existing) return { folderId: existing.id, created: false };

      const created = await ocs<{ id: number }>(
        "POST",
        "/apps/groupfolders/folders?format=json",
        { mountpoint: name },
      );
      assertOcsOk(created, `create group folder ${name}`, [OCS_SUCCESS]);
      const folderId = created.ocs.data.id;

      // The folder now exists on the server whether or not the bind below
      // succeeds. If it fails, throw rather than reporting `created: true`
      // on a folder the group can't reach — the caller must see this as a
      // failure, not a false success, even though a folder row now exists.
      const bound = await ocs<unknown>(
        "POST",
        `/apps/groupfolders/folders/${folderId}/groups?format=json`,
        { group: groupId },
      );
      assertOcsOk(
        bound,
        `bind group ${groupId} to folder ${folderId}`,
        [OCS_SUCCESS, OCS_ALREADY_EXISTS],
      );

      return { folderId, created: true };
    },
  };
}
