/**
 * Who is acting. Slice 1 only ever constructs `human`, but every call takes an
 * Actor so slice 2's agents use the identical code path — an agent carries its
 * own client-credentials token from the keystone and never borrows a human's
 * session. Attribution is structural rather than a convention to remember.
 */
export type Actor =
  | { kind: "human"; sub: string }
  | { kind: "agent"; sub: string; actingFor: string };

/**
 * Which slice of storage a request may touch. `sub` is always the WebDAV
 * principal (the signed-in citizen); an org scope narrows to that org's group
 * folder, which the citizen only sees at all because their `groups` claim put
 * them in it.
 */
export interface WorkspaceScope {
  kind: "personal" | "org";
  /** OIDC `sub` — the smart-account address, which is also the Nextcloud uid. */
  sub: string;
  /** Org account id. Required when kind === "org". */
  accountId?: string;
  /** Group folder name, e.g. "Org Feuerwehr". Required when kind === "org". */
  folderName?: string;
  /**
   * Whether this scope may write, not just read. A personal scope is always
   * `true` — a citizen always owns their own home. An org scope is `true`
   * for owner/admin and `false` for member: identical write access for all
   * three roles was the gap; this is the field that closes it. The caller
   * that resolves a scope (`resolveScope` in apps/web) is the only place
   * that decides this value — it is derived from the session's role claim,
   * never accepted from the request.
   */
  canWrite: boolean;
}
