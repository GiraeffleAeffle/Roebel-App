/**
 * Server-side citizen/attester verification.
 *
 * The PostComposer gates the UI client-side, but that is trivially
 * bypassable (anyone can call the `createPost` server action directly).
 * This module is the authoritative gate: it reads NFT ownership straight
 * from the chain so the server can reject posts from non-citizens.
 *
 * The addresses come from the same indivisible identity contract set as the
 * browser handles. A partial, mixed or unknown pair fails before this server
 * gate can construct either contract handle.
 *
 * Gnosis v2 Sybil-hardened rotation (2026-06-25): NFTs now live on Gnosis
 * (chainId 100). hasCitizenNFT/hasAttesterNFT are unchanged in v2.
 */

import { readContract, getContract } from "thirdweb";
import { gnosis } from "@/lib/gnosis";
import { client } from "@/app/client";
import { identityContractSet } from "@/lib/identity-contract-set";

const citizenNftContract = getContract({
  client,
  address: identityContractSet.citizenNFT,
  chain: gnosis,
});

const attesterNftContract = getContract({
  client,
  address: identityContractSet.attesterNFT,
  chain: gnosis,
});

/**
 * Returns true if `address` currently holds a CitizenNFT or an AttesterNFT.
 * Attesters are a superset of verified citizens, so either grants posting
 * rights. Fails closed: any RPC error returns false.
 */
export async function isVerifiedCitizen(address: string): Promise<boolean> {
  if (!address || !identityContractSet.usable) return false;
  const wallet = address as `0x${string}`;

  try {
    const [isCitizen, isAttester] = await Promise.all([
      readContract({
        contract: citizenNftContract,
        method: "function hasCitizenNFT(address account) view returns (bool)",
        params: [wallet],
      }) as Promise<boolean>,
      readContract({
        contract: attesterNftContract,
        method: "function hasAttesterNFT(address account) view returns (bool)",
        params: [wallet],
      }) as Promise<boolean>,
    ]);

    return Boolean(isCitizen) || Boolean(isAttester);
  } catch (err) {
    console.error("[verify-citizen] NFT ownership read failed", err);
    return false;
  }
}
