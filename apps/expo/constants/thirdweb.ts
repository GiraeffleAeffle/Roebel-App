import { createThirdwebClient, getContract } from "thirdweb";
import { base, defineChain } from "thirdweb/chains";
import Constants from "expo-constants";
import { gnosis, gnosisRead } from "@/constants/gnosis";
import { resolveIdentityContractSet } from '@roebel/blockchain';
import { identityContractSet } from '@/constants/identity-contract-set';

const clientId = Constants.expoConfig?.extra?.THIRDWEB_CLIENT_ID ??
                 process.env.EXPO_PUBLIC_THIRDWEB_CLIENT_ID ??
                 "";

if (!clientId) {
	console.warn(
		"⚠️ Missing EXPO_PUBLIC_THIRDWEB_CLIENT_ID - Thirdweb features will be disabled",
	);
}

export const client = createThirdwebClient({
	clientId: clientId || "dummy-client-id", // Provide fallback to prevent crashes
});

/**
 * The app's PRIMARY chain — Gnosis since the 2026-07-27 consolidation.
 *
 * This is what `constants/wallets.ts` builds the smart account on, and it decides
 * far more than which RPC gets called: a thirdweb smart account stamps its
 * EIP-712 `AccountMessage` domain with THIS chain id. Any server that verifies a
 * signature from this app via ERC-1271 must therefore use the same chain, or the
 * domain separator differs and recovery yields a stranger.
 *
 * That mismatch is exactly what broke Nostr registration while this was `base`
 * and accounts were verified on Gnosis. Identity, governance, Circles and the
 * treasury all live on Gnosis, so the wallet now signs there too.
 *
 * The account ADDRESS is unchanged: it is CREATE2 from factory + admin + salt,
 * identical on every EVM chain.
 */
export const chain = gnosis;

// Read-only Base chain pinned to a reliable public RPC. Base is archived — kept
// only for historical reads (the legacy public-vote governor below).
const BASE_READ_RPC = process.env.EXPO_PUBLIC_BASE_RPC_URL || "https://mainnet.base.org";
export const baseRead = defineChain({ ...base, rpc: BASE_READ_RPC });

export const contract = getContract({
	client,
	address: "0x82e50a6BF13A70366eDFC871f8FB8a428C43Dc03",
	chain: base,
});

export const usdcContract = getContract({
	address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
	chain: base,
	client,
});

// Governance + verification Contracts (Gnosis v2 mainnet, chainId 100; source of
// truth: contracts/governor-contract/deployments/gnosis.json).
//
// Sybil-hardening rotation 2026-06: the entire Citizen-verification + MACI
// privacy-voting stack moved off Base onto the new Gnosis v2 contracts
// (CitizenNFTv2 / AttesterNFTv2 with dynamic percentage-band thresholds, fresh
// MACI core + gatekeeper). Reads/scans use `gnosisRead` (pinned public RPC);
// writes use `gnosis` (thirdweb bundler, gasless). The coordinator EOA + pubkey
// are UNCHANGED.
//
// Two governance regimes coexist:
//  - legacyGovernorContract — old public-vote AttesterGovernor on BASE; kept for
//    historical proposals. Reads only.
//  - governorContract       — current MACI v2 privacy-voting governor on GNOSIS.
//    All new proposals + votes go here.
// The NFT addresses come from the shared, fail-closed contract-set selector.
// Expo supplies one profile plus both exact addresses through EXPO_PUBLIC_*;
// partial, mixed and unknown pairs fail before handles are constructed.
export const attesterNFTAddress = identityContractSet.attesterNFT;
export const citizenNFTAddress = identityContractSet.citizenNFT;

// Legacy public-vote AttesterGovernor remains on BASE (read-only, historical).
export const legacyGovernorContractAddress = process.env.EXPO_PUBLIC_LEGACY_GOVERNOR || "0x84D8ab0FcA4D0689e2E3F036dc461942343c2a5b";
// MaciAttesterGovernor on Gnosis v2 — binds to the fresh MACI core + gatekeeper.
export const governorContractAddress = process.env.EXPO_PUBLIC_GOVERNOR || "0x5F5e499Dc1872c2Ce19a4b50cd10f680e78E3Ba3";

// MACI v2 infrastructure on Gnosis (Sybil-hardening rotation 2026-06).
export const maciAddress = process.env.EXPO_PUBLIC_MACI || "0x6663eDC8650276fe264710B1A2ba46eB8bd0bF1D";
export const maciVerifierAddress = process.env.EXPO_PUBLIC_MACI_VERIFIER || "0xC95359cF5d7391cD239c9476393706a8132406dc";
export const maciVkRegistryAddress = process.env.EXPO_PUBLIC_MACI_VK_REGISTRY || "0xB21EAA60DF62b7cf06Eb0a2554D9C4e6BA76658f";
export const maciCoordinatorAddress = process.env.EXPO_PUBLIC_MACI_COORDINATOR || "0x5e6528D22283Daf1E4340B39d48a4D3CeaDC184C";

/** Block at (or slightly before) the MACI core deployment on Gnosis mainnet.
 *  Used as the lower bound for SignUp event scans when recovering a citizen's
 *  stateIndex after an app cold-start. The current MACI core
 *  (0x6663eDC8650276fe264710B1A2ba46eB8bd0bF1D, Sybil-hardening rotation 2026-06)
 *  was deployed at block 46,867,803; we round down ~100 blocks for RPC-drift
 *  safety. KEEP THIS IN SYNC with the MACI core
 *  address above — a stale value forces the SignUp event scan to span
 *  hundreds of thousands of blocks, which the public Gnosis RPC will reject
 *  and which can crash the app at cold start. */
export const MACI_DEPLOY_BLOCK = 46867703n;

export const attesterNFTContract = getContract({
	client,
	address: attesterNFTAddress,
	chain: gnosis,
});

export const citizenNFTContract = getContract({
	client,
	address: citizenNFTAddress,
	chain: gnosis,
});

// Test identity credentials carry no production governance authority. Voting and
// proposal callers use this production-only handle explicitly.
const productionIdentityContractSet = resolveIdentityContractSet();
export const governanceCitizenNFTContract = getContract({
	client,
	address: productionIdentityContractSet.citizenNFT,
	chain: gnosis,
});

// Legacy public-vote governor stays on Base (read-only historical proposals).
export const legacyGovernorContract = getContract({
	client,
	address: legacyGovernorContractAddress,
	chain: base,
});

export const governorContract = getContract({
	client,
	address: governorContractAddress,
	chain: gnosis,
});

export const maciContract = getContract({
	client,
	address: maciAddress,
	chain: gnosis,
});

// Same MACI core, but pinned to the reliable Gnosis read RPC — used for the
// SignUp event scan (recovering a citizen's stateIndex) so it isn't blocked by
// the hosted-RPC rate limit.
export const maciReadContract = getContract({
	client,
	address: maciAddress,
	chain: gnosisRead,
});

/** Build a Poll contract handle for a per-proposal MACI Poll address (Gnosis). */
export function getPollContract(pollAddress: string) {
	return getContract({ client, address: pollAddress, chain: gnosis });
}

/** Build a Tally contract handle for a per-proposal MACI Tally address (Gnosis). */
export function getTallyContract(tallyAddress: string) {
	return getContract({ client, address: tallyAddress, chain: gnosis });
}
