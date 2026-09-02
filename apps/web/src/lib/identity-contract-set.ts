import { resolveIdentityContractSet } from "@roebel/blockchain";

/**
 * The only Web seam for selecting the active identity contracts. Next.js must
 * see these direct environment-property reads so it can embed the reviewed
 * runtime-replacement tokens in both browser and server bundles.
 */
export const identityContractSet = resolveIdentityContractSet({
  id: process.env.NEXT_PUBLIC_IDENTITY_CONTRACT_SET,
  attesterNFT: process.env.NEXT_PUBLIC_ATTESTER_NFT_ADDRESS,
  citizenNFT: process.env.NEXT_PUBLIC_CITIZEN_NFT_ADDRESS,
});
