// Gnosis (chain 100) on-chain reads for the Röbel Münzen console. Server-only.
// Uses viem against GNOSIS_RPC_URL (falls back to the public Gnosis RPC).
import "server-only";
import { createPublicClient, http, getAddress, type Address } from "viem";
import { gnosis } from "viem/chains";
import {
  ADDR,
  HUB_ABI,
  ERC20_ABI,
  ERC721_ABI,
  GROUP_TOKEN_ID,
  getXdaiEurRate,
} from "./constants";

const RPC_URL = process.env.GNOSIS_RPC_URL || "https://rpc.gnosischain.com";

export const gnosisClient = createPublicClient({
  chain: gnosis,
  transport: http(RPC_URL),
});

function addr(a: string): Address {
  return getAddress(a);
}

/** Röbel Münzen (RCRC) balance — demurraged ERC-1155 group-token balance. */
export async function rcrcBalance(account: string): Promise<bigint> {
  return gnosisClient.readContract({
    address: addr(ADDR.hub),
    abi: HUB_ABI,
    functionName: "balanceOf",
    args: [addr(account), GROUP_TOKEN_ID],
  });
}

/** An avatar's own personal CRC (token id = uint256(self)). */
export async function personalCrcBalance(account: string): Promise<bigint> {
  const a = addr(account);
  return gnosisClient.readContract({
    address: addr(ADDR.hub),
    abi: HUB_ABI,
    functionName: "balanceOf",
    args: [a, BigInt(a)],
  });
}

export async function isHuman(account: string): Promise<boolean> {
  try {
    return await gnosisClient.readContract({
      address: addr(ADDR.hub),
      abi: HUB_ABI,
      functionName: "isHuman",
      args: [addr(account)],
    });
  } catch {
    return false;
  }
}

/** Total RCRC supply via Hub.totalSupply(groupId). Null if the call reverts. */
export async function rcrcTotalSupply(): Promise<bigint | null> {
  try {
    return await gnosisClient.readContract({
      address: addr(ADDR.hub),
      abi: HUB_ABI,
      functionName: "totalSupply",
      args: [GROUP_TOKEN_ID],
    });
  } catch {
    return null;
  }
}

/** Native xDAI balance. */
export async function nativeBalance(account: string): Promise<bigint> {
  try {
    return await gnosisClient.getBalance({ address: addr(account) });
  } catch {
    return 0n;
  }
}

/** EURe (regulated euro) ERC-20 balance. */
export async function eureBalance(account: string): Promise<bigint> {
  try {
    return await gnosisClient.readContract({
      address: addr(ADDR.eure),
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [addr(account)],
    });
  } catch {
    return 0n;
  }
}

/** True if the address currently holds a CitizenNFT (mint-gate membership). */
export async function hasCitizenNFT(account: string): Promise<boolean> {
  try {
    const bal = await gnosisClient.readContract({
      address: addr(ADDR.productionCitizenNFT),
      abi: ERC721_ABI,
      functionName: "balanceOf",
      args: [addr(account)],
    });
    return bal > 0n;
  } catch {
    return false;
  }
}

/** True if the address currently holds an AttesterNFT. */
export async function hasAttesterNFT(account: string): Promise<boolean> {
  try {
    const bal = await gnosisClient.readContract({
      address: addr(ADDR.productionAttesterNFT),
      abi: ERC721_ABI,
      functionName: "balanceOf",
      args: [addr(account)],
    });
    return bal > 0n;
  } catch {
    return false;
  }
}

/**
 * € value of the Gemeinschaftskasse (civic treasury) Safe:
 * native xDAI (live-converted to €) + EURe. Excludes Röbel Münzen (not
 * euro-redeemable) — matches the Expo Gemeinschaftskasse hero.
 * Used to freeze a balance snapshot onto a proposal at creation time.
 */
export async function treasuryEuro(): Promise<number> {
  const [xdai, eure, rate] = await Promise.all([
    nativeBalance(ADDR.safe),
    eureBalance(ADDR.safe),
    getXdaiEurRate(),
  ]);
  return (Number(xdai) / 1e18) * rate + Number(eure) / 1e18;
}

export interface WalletAssets {
  rcrc: bigint;
  personalCrc: bigint;
  xdai: bigint;
  eure: bigint;
}

/** Full asset snapshot for a wallet (RCRC + personal CRC + xDAI + EURe). */
export async function walletAssets(account: string): Promise<WalletAssets> {
  const [rcrc, personalCrc, xdai, eure] = await Promise.all([
    rcrcBalance(account).catch(() => 0n),
    personalCrcBalance(account).catch(() => 0n),
    nativeBalance(account),
    eureBalance(account),
  ]);
  return { rcrc, personalCrc, xdai, eure };
}
