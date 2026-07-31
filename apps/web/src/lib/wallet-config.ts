import { inAppWallet } from "thirdweb/wallets";
import { activeChain } from "@/lib/chains";

// Shared wallet configuration for thirdweb ConnectButton
// Used by both the landing page Header and the App layout AppHeader
export const wallets = [
  inAppWallet({
    auth: {
      options: ["email", "phone", "google", "apple", "facebook"],
    },
    smartAccount: {
      chain: activeChain,
      sponsorGas: true,
    },
  }),
];
