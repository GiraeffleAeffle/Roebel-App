// On-chain CitizenNFTv2 holder registry (Gnosis). Server-only.
//
// The `users.is_verified_citizen` flag in Supabase is client-synced — it only
// flips when the verified user next opens the app, so it lags on-chain truth
// by hours or days (and the admin dashboard undercounted fresh verifications).
// This module derives the authoritative holder set + verification timestamps
// straight from CitizenNFTv2 Transfer events.
//
// The scan is incremental: the full history is fetched once per server
// process, subsequent calls only scan blocks minted since. Results are held
// ~60s before re-checking the chain tip.
import "server-only";
import { parseAbiItem } from "viem";
import { gnosisClient } from "./muenzen/gnosis";
import { ADDR } from "./muenzen/constants";

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)"
);

// Safely before the v2 identity deploy (MACI core = block 46,867,803, 2026-06-24).
const DEPLOY_BLOCK = 46_850_000n;
const CHUNK = 50_000n;
const TTL_MS = 60_000;
const ZERO = "0x0000000000000000000000000000000000000000";

export interface CitizenHolder {
  /** Lowercase wallet address. */
  wallet: string;
  tokenId: number;
  /** ISO timestamp of the mint block — when this citizen was verified on-chain. */
  verifiedAt: string;
}

export interface CitizenRegistry {
  /** Current CitizenNFTv2 holders (soulbound → one entry per verified citizen). */
  holders: CitizenHolder[];
  totalOnChain: number;
  scannedAt: string;
}

interface TokenState {
  owner: string;
  block: bigint;
}

const ownerByToken = new Map<string, TokenState>();
const tsByBlock = new Map<string, number>();
let scannedTo = DEPLOY_BLOCK - 1n;
let lastScanAt = 0;
let snapshot: CitizenRegistry | null = null;
let inFlight: Promise<CitizenRegistry> | null = null;

async function blockTimestamp(block: bigint): Promise<number> {
  const key = block.toString();
  const hit = tsByBlock.get(key);
  if (hit !== undefined) return hit;
  const b = await gnosisClient.getBlock({ blockNumber: block });
  const ms = Number(b.timestamp) * 1000;
  tsByBlock.set(key, ms);
  return ms;
}

async function scan(): Promise<CitizenRegistry> {
  const latest = await gnosisClient.getBlockNumber();

  for (let from = scannedTo + 1n; from <= latest; from += CHUNK) {
    const to = from + CHUNK - 1n < latest ? from + CHUNK - 1n : latest;
    const logs = await gnosisClient.getLogs({
      address: ADDR.productionCitizenNFT as `0x${string}`,
      event: TRANSFER_EVENT,
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) {
      const tokenId = (log.args.tokenId ?? 0n).toString();
      const toAddr = (log.args.to ?? ZERO).toLowerCase();
      if (toAddr === ZERO) {
        ownerByToken.delete(tokenId); // revocation burn
      } else {
        ownerByToken.set(tokenId, { owner: toAddr, block: log.blockNumber });
      }
    }
  }
  scannedTo = latest;

  // Resolve mint-block timestamps (deduped, cached across scans).
  const blocks = [...new Set([...ownerByToken.values()].map((t) => t.block))];
  await Promise.all(blocks.map((b) => blockTimestamp(b)));

  // One entry per wallet; if a wallet somehow holds several tokens, keep the
  // earliest acquisition as its verification date.
  const byWallet = new Map<string, CitizenHolder>();
  for (const [tokenId, t] of ownerByToken) {
    const verifiedAt = new Date(tsByBlock.get(t.block.toString()) ?? 0).toISOString();
    const prev = byWallet.get(t.owner);
    if (!prev || verifiedAt < prev.verifiedAt) {
      byWallet.set(t.owner, { wallet: t.owner, tokenId: Number(tokenId), verifiedAt });
    }
  }

  snapshot = {
    holders: [...byWallet.values()].sort((a, b) =>
      b.verifiedAt.localeCompare(a.verifiedAt)
    ),
    totalOnChain: ownerByToken.size,
    scannedAt: new Date().toISOString(),
  };
  lastScanAt = Date.now();
  return snapshot;
}

/**
 * Current on-chain citizen holder set. Throws on RPC failure — callers should
 * catch and degrade to DB-only data.
 */
export async function getCitizenRegistry(): Promise<CitizenRegistry> {
  if (snapshot && Date.now() - lastScanAt < TTL_MS) return snapshot;
  if (!inFlight) {
    inFlight = scan().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}
