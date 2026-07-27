import { writeAllowList } from "./allowlist.js";
import type { ChainVerifier, RegistryRow, SyncSummary } from "./types.js";
import { verifyRegistryRow } from "./verify.js";

export interface SyncDeps {
  /** Fetch the private registry. Must THROW on failure — see the fail-closed rule. */
  fetchRegistry: () => Promise<RegistryRow[]>;
  chain: ChainVerifier;
  allowListPath: string;
  log?: (message: string) => void;
  /** Injectable for tests. */
  write?: (path: string, pubkeys: string[]) => Promise<boolean>;
}

/**
 * One sync pass: registry → verified members → allow-list.
 *
 * **Fail-closed rule.** If the registry fetch or any RPC call fails, this throws
 * and the allow-list is left exactly as it was. The alternative — treating an
 * error as "no members" — would let one Supabase outage or one flaky RPC write an
 * empty file and revoke write access for the entire town. A stale allow-list is a
 * far better failure than an empty one.
 *
 * Revocation is not a special case: a Citizen who no longer holds the NFT simply
 * fails verification and is absent from the next write.
 */
export async function syncAllowList(deps: SyncDeps): Promise<SyncSummary> {
  const log = deps.log ?? (() => {});
  const write = deps.write ?? writeAllowList;

  const rows = await deps.fetchRegistry();
  log(`registry: ${rows.length} row(s)`);

  const allowed: string[] = [];
  const rejected: SyncSummary["rejected"] = [];

  for (const row of rows) {
    const outcome = await verifyRegistryRow(row, deps.chain);
    if (outcome.allowed) allowed.push(outcome.pubkey);
    else rejected.push({ wallet: outcome.wallet, reason: outcome.reason });
  }

  const changed = await write(deps.allowListPath, allowed);
  log(
    `verified ${allowed.length}/${rows.length} — allow-list ${changed ? "updated" : "unchanged"}`,
  );
  for (const { wallet, reason } of rejected) log(`  rejected ${wallet}: ${reason}`);

  return { checked: rows.length, allowed: allowed.length, rejected, changed };
}
