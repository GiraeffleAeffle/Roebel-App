import { resolveIdentityContractSet } from "@roebel/blockchain";

/** Expo inlines only direct EXPO_PUBLIC_* property reads. Keep them at this seam. */
export const identityContractSet = resolveIdentityContractSet({
  id: process.env.EXPO_PUBLIC_IDENTITY_CONTRACT_SET,
  attesterNFT: process.env.EXPO_PUBLIC_ATTESTER_NFT_ADDRESS,
  citizenNFT: process.env.EXPO_PUBLIC_CITIZEN_NFT_ADDRESS,
});
