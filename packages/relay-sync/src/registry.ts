import type { RegistryRow } from "./types.js";

const COLUMNS = "wallet_address,pubkey_hex,npub,eth_signature,binding_event,revoked_at";

export interface RegistryOptions {
  url: string;
  /**
   * A **scoped service key**, never the anon key.
   *
   * `nostr_identities` maps wallet ↔ npub, and the anon key ships inside the app
   * bundle. Exposing this table publicly would hand anyone a table linking every
   * Citizen's Nostr posts to their Gnosis wallet — and therefore to their MACI
   * signup and Circles balance. The table stays private; the node authenticates.
   */
  serviceKey: string;
  table?: string;
  fetchImpl?: typeof fetch;
}

/**
 * Read the private identity registry over PostgREST.
 *
 * Throws on any non-OK response — the fail-closed rule depends on this never
 * quietly returning an empty array.
 */
export function createSupabaseRegistry(options: RegistryOptions): () => Promise<RegistryRow[]> {
  const table = options.table ?? "nostr_identities";
  const doFetch = options.fetchImpl ?? fetch;
  const endpoint = `${options.url.replace(/\/$/, "")}/rest/v1/${table}?select=${COLUMNS}`;

  return async () => {
    const response = await doFetch(endpoint, {
      headers: {
        apikey: options.serviceKey,
        Authorization: `Bearer ${options.serviceKey}`,
        Accept: "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(
        `registry fetch failed: ${response.status} ${response.statusText} — refusing to touch the allow-list`,
      );
    }

    const rows = (await response.json()) as unknown;
    if (!Array.isArray(rows)) throw new Error("registry did not return an array");
    return rows as RegistryRow[];
  };
}
