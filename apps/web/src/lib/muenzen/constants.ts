// Röbel Münzen (Circles v2 on Gnosis) — addresses, ABIs and formatting helpers.
// Single source of truth for the admin tokenomics console. Mirrors
// docs/CIRCLES_TOKENOMICS.md and the project CLAUDE.md (Gnosis section).
//
// This module is safe to import from both server and client code (no secrets,
// no env access). Env-derived values (RPC URLs, optional operator address) live
// in gnosis.ts / the API routes.
import { parseAbi } from "viem";
import { resolveIdentityContractSet } from "@roebel/blockchain";

const productionIdentityContractSet = resolveIdentityContractSet();

export const GNOSIS_CHAIN_ID = 100;

/** 1 Röbel Münze = 10^18 atto (Circles is an 18-decimal demurraged token). */
export const ATTO = 10n ** 18n;
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/** Fallback xDAI→€ rate (xDAI is USD-pegged) — only used when the live FX fetch fails. */
export const XDAI_EUR = 0.92;

let xdaiEurCache: { rate: number; at: number } | null = null;
/**
 * Live xDAI→€ rate (Coingecko, 10-min in-memory cache) so treasury figures
 * are exact instead of the indicative 0.92 constant. Falls back to the last
 * known rate, then XDAI_EUR, when offline. Safe for server and client.
 */
export async function getXdaiEurRate(): Promise<number> {
  if (xdaiEurCache && Date.now() - xdaiEurCache.at < 10 * 60 * 1000) return xdaiEurCache.rate;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=xdai&vs_currencies=eur");
    const j = (await res.json()) as { xdai?: { eur?: number } };
    const rate = Number(j?.xdai?.eur);
    if (Number.isFinite(rate) && rate > 0.5 && rate < 2) {
      xdaiEurCache = { rate, at: Date.now() };
      return rate;
    }
  } catch {
    /* fall back */
  }
  return xdaiEurCache?.rate ?? XDAI_EUR;
}
/** Indicative € value of 1 Röbel Münze (orientation only — NOT redeemable). */
export const MUENZE_EUR = 1;

/** Alert thresholds (whole Röbel Münzen / personal CRC). */
export const FUNDER_LOW_RCRC = 5;
export const OPERATOR_LOW_CRC = 20;
/** Collateralization is considered healthy within ±2% of 1:1. */
export const COLLATERAL_DRIFT_TOLERANCE = 0.02;

/** On-chain Circles / Röbel Münzen addresses on Gnosis. */
export const ADDR = {
  hub: "0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8", // Circles Hub v2
  group: "0xAc2CeCdBead594F97358a0d3132454f24F3E470c", // Röbel Münzen group token (RCRC)
  vault: "0x0476fd3bD5EbCE0Af18C70dE221eC47F508e8763", // BaseTreasury — holds collateral
  mintHandler: "0x910A0C7Ae84E745B06eC6362Fa29Cd3779e0b96b", // BaseMintHandler
  safe: "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa", // Stadtkasse multisig (reserve / group owner)
  service: "0xd5028284017A32C672CbD73Fe35aCD897bA874cf", // group auto-invite bot
  funder: "0x5ac82fD7f576c86aed8d174074bA707eC1979D9B", // operational funder (rewards + lootbox sink)
  // Production-only treasury and Circles membership gates. The staging test
  // identity set has authorityBinding=none and never flows into these handles.
  productionCitizenNFT: productionIdentityContractSet.citizenNFT,
  productionAttesterNFT: productionIdentityContractSet.attesterNFT,
  membershipCondition: "0x10644F137cDBE9Af5651C8607A6FBa8AfA5276f6", // CitizenMembershipCondition (mint gate)
  nameRegistry: "0xA27566fD89162cC3D40Cb59c87AAaA49B85F3474", // NameRegistry (avatar profiles)
  eure: "0x420CA0f9B9b604cE0fd9C18EF134C705e5Fa3430", // EURe V2 (regulated euro, Monerium) on Gnosis — V1 0xcB444e90… deprecated
  metri: "0x1f14C82926227d948b9a756Db9aEB77fe51273c3", // town Metri wallet (holder)
} as const;

/** Circles encodes an avatar's ERC-1155 token id as uint256(avatarAddress). */
export const GROUP_TOKEN_ID = BigInt(ADDR.group);

export const HUB_ABI = parseAbi([
  "function balanceOf(address account, uint256 id) view returns (uint256)",
  "function isHuman(address) view returns (bool)",
  "function calculateIssuance(address) view returns (uint256, uint256, uint256)",
  "function totalSupply(uint256 id) view returns (uint256)",
]);
export const ERC20_ABI = parseAbi(["function balanceOf(address) view returns (uint256)"]);
export const ERC721_ABI = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
]);

export type WalletKind = "reserve" | "hot" | "vault" | "service" | "operator" | "holder";

export interface WalletMeta {
  key: string;
  address: string;
  label: string;
  role: string;
  kind: WalletKind;
  description: string;
  /** Which asset's health/threshold matters most for this wallet. */
  watch?: "rcrc" | "personalCrc";
}

/** System wallets surfaced on the Wallets & Kasse tab (operator appended at runtime from env). */
export const SYSTEM_WALLETS: WalletMeta[] = [
  {
    key: "safe",
    address: ADDR.safe,
    label: "Stadtkasse (Safe)",
    role: "Multisig-Reserve · Gruppen-Eigentümer",
    kind: "reserve",
    description: "Mehrfach-Signatur-Tresor. Hält die Reserve (xDAI / EURe), besitzt die Gruppe und füllt den Funder auf.",
  },
  {
    key: "funder",
    address: ADDR.funder,
    label: "Funder (Betriebskasse)",
    role: "Hot Float · zahlt Belohnungen, empfängt Lootbox-Käufe",
    kind: "hot",
    description: "Heiße, edge-function-signierte Umlaufkasse. Klein gehalten (begrenzter Schaden), aus der Reserve nachgefüllt.",
    watch: "rcrc",
  },
  {
    key: "vault",
    address: ADDR.vault,
    label: "Sicherheiten-Tresor",
    role: "Collateral hinter den Röbel Münzen",
    kind: "vault",
    description: "BaseTreasury. Hält die persönlichen CRC, die jede ausgegebene Röbel Münze 1:1 decken.",
  },
  {
    key: "service",
    address: ADDR.service,
    label: "Einladungs-Bot",
    role: "Auto-Invite Service",
    kind: "service",
    description: "Vertraut neu verifizierte Bürger:innen automatisch in die Gruppe (nur CitizenNFT-Halter).",
  },
  {
    key: "metri",
    address: ADDR.metri,
    label: "Stadt-Wallet (Metri)",
    role: "Town-Inviter · Halter",
    kind: "holder",
    description: "Persönliches Metri-Wallet der Stadt; tritt als Halter und Erst-Einlader auf.",
  },
];

/** Reward-rail action keys → friendly German labels. */
export const ACTION_LABELS: Record<string, string> = {
  proposal_vote: "Abstimmung",
  checkpoint: "Checkpoint",
  event_submit: "Event eingereicht",
  referral: "Einladung",
  event_attend: "Event-Teilnahme",
};

/** Stable per-action colors (charts + legends). */
export const ACTION_COLORS: Record<string, string> = {
  proposal_vote: "#00498B",
  checkpoint: "#3a6cb8",
  event_submit: "#16a34a",
  referral: "#8b5cf6",
  event_attend: "#f59e0b",
};

export const FLOW_COLORS = {
  mint: "#0ea5e9",
  earn: "#16a34a",
  spend: "#dc2626",
  reserve: "#00498B",
  net: "#8b5cf6",
} as const;

/** Convert an 18-decimal atto amount (bigint | numeric string | number) to whole Münzen. */
export function attoToNumber(v: bigint | string | number | null | undefined): number {
  if (v == null) return 0;
  try {
    let b: bigint;
    if (typeof v === "bigint") b = v;
    else if (typeof v === "number") b = BigInt(Math.trunc(v));
    else b = BigInt(String(v).trim().split(".")[0] || "0");
    // keep 4 decimal places of precision without floating-point drift
    return Number(b / (ATTO / 10_000n)) / 10_000;
  } catch {
    return 0;
  }
}

/** Convert a whole-Münzen amount to an 18-decimal atto string (6-dp precision, no float drift). */
export function numberToAtto(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return "0";
  return (BigInt(Math.round(amount * 1_000_000)) * 1_000_000_000_000n).toString();
}

/** Truncate an address for the secondary monospace label (name-first rule). */
export function shortAddr(addr: string | null | undefined): string {
  if (!addr) return "";
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
