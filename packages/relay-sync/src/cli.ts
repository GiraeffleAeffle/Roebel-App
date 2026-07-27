#!/usr/bin/env node
import { createGnosisVerifier } from "./chain.js";
import { createSupabaseRegistry } from "./registry.js";
import { syncAllowList } from "./sync.js";

/**
 * `netizen-relay-sync` — runs on the sovereign node, next to the relay.
 *
 * Pull-based on purpose: the node opens outbound connections only, so this adds
 * no inbound attack surface to the box. Run it as a compose service; a crash
 * loop with `restart: unless-stopped` is a perfectly good supervisor.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`missing required env var: ${name}`);
    process.exit(2);
  }
  return value;
}

async function main(): Promise<void> {
  const registry = createSupabaseRegistry({
    url: required("SUPABASE_URL"),
    serviceKey: required("SUPABASE_SERVICE_KEY"),
  });
  const chain = createGnosisVerifier({
    rpcUrl: required("GNOSIS_RPC_URL"),
    citizenNftAddress: required("CITIZEN_NFT_ADDRESS"),
  });
  // Default matches what `netizen render` ships as strfry-policy/members.txt and
  // mounts at /etc/strfry. The currently-live Röbel box predates that naming and
  // reads citizens.txt — point ALLOWLIST_PATH at it there until it is re-applied.
  const allowListPath = process.env.ALLOWLIST_PATH ?? "/etc/strfry/members.txt";
  const intervalSeconds = Number(process.env.SYNC_INTERVAL_SECONDS ?? 300);
  const once = process.argv.includes("--once");
  // The node's own AI agents. Their Nostr key is NIP-06 derived from an agent
  // smart account, which holds no CitizenNFT — so without this they would be
  // erased from the allow-list on every pass and could never publish.
  const agentPubkeys = (process.env.AGENT_PUBKEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  const runPass = async (): Promise<void> => {
    const startedAt = new Date().toISOString();
    try {
      const summary = await syncAllowList({
        fetchRegistry: registry,
        chain,
        allowListPath,
        alwaysAllow: agentPubkeys,
        log: (message) => console.log(`[${startedAt}] ${message}`),
      });
      if (summary.changed) {
        console.log(`[${startedAt}] wrote ${summary.allowed} pubkey(s) to ${allowListPath}`);
      }
    } catch (error) {
      // Fail closed: log loudly, leave the allow-list untouched, try again next tick.
      console.error(
        `[${startedAt}] sync pass FAILED — allow-list left unchanged:`,
        error instanceof Error ? error.message : error,
      );
      if (once) process.exitCode = 1;
    }
  };

  await runPass();
  if (once) return;

  console.log(`syncing every ${intervalSeconds}s`);
  setInterval(() => {
    void runPass();
  }, intervalSeconds * 1000);
}

void main();
