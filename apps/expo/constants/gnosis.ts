import { getContract } from "thirdweb";
import { defineChain } from "thirdweb/chains";
import { client } from "@/constants/thirdweb";
import { identityContractSet } from '@/constants/identity-contract-set';

export const gnosis = defineChain(100);

// Pinned to a reliable public Gnosis RPC; override via env for staging/prod.
const GNOSIS_READ_RPC =
	process.env.EXPO_PUBLIC_GNOSIS_RPC_URL || "https://rpc.gnosischain.com";
export const gnosisRead = defineChain({ ...gnosis, rpc: GNOSIS_READ_RPC });

// Selected CitizenNFT + AttesterNFT pair on Gnosis. The production v2 pair is
// soulbound and owned by the 3-of-5 Attester Safe; staging may instead select
// the reviewed test/no-authority pair. Production v2 supersedes the v1 NFTs
// (v1 Citizen 0x6FF3dC7974a990425DE79F4B21FB0a39F3B04DD4 /
// v1 Attester 0x7bD6Fd97385BCCf6000380ADd3BF19737c6063C4, 2026-06-17).
export const citizenNFTGnosisAddress = identityContractSet.citizenNFT;
export const attesterNFTGnosisAddress = identityContractSet.attesterNFT;
export const isTestContractSet = identityContractSet.isTest;

// 3-of-5 Attester Safe on Gnosis — owner of the NFTs and (eventually) the Röbeltaler group.
export const attesterSafeGnosisAddress =
	process.env.EXPO_PUBLIC_ATTESTER_SAFE_GNOSIS || "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa";

// Röbeltaler Circles v2 BaseGroup (registered 2026-06-17; owner = Attester Safe,
// standard mint policy, fee 0, citizen-gated via owner-curated trust of the 15
// CitizenNFT holders).
export const roebeltalerGroupAddress =
	process.env.EXPO_PUBLIC_ROEBELTALER_GROUP || "0xAc2CeCdBead594F97358a0d3132454f24F3E470c";

// Circles v2 protocol addresses on Gnosis (from @aboutcircles/sdk-core circlesConfig[100]).
export const circlesHubAddress = "0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8";
export const circlesBaseGroupFactory = "0xD0B5Bd9962197BEaC4cbA24244ec3587f19Bd06d";
// NameRegistry — an avatar sets its own profile (name + photo) via updateMetadataDigest(bytes32).
// Read by Metri / the Explorer / every Circles app, so a Röbel citizen shows up as a person.
export const nameRegistryAddress =
	process.env.EXPO_PUBLIC_CIRCLES_NAME_REGISTRY || "0xA27566fD89162cC3D40Cb59c87AAaA49B85F3474";

/** Returns a contract handle for the CitizenNFT on Gnosis. */
export const citizenNFTGnosisContract = () =>
	getContract({ client, address: citizenNFTGnosisAddress, chain: gnosisRead });

/** External Gnosis-App referral link (Max's personal referral — new users who
 *  join there get a SEPARATE Gnosis account, independent of the app wallet). */
export const gnosisReferralUrl =
	process.env.EXPO_PUBLIC_GNOSIS_REFERRAL_URL ||
	"https://app.gnosis.io/referral/0x2d94a225f02d6cafebe7fda1a272c790b93750b5027443ad2b6f78398d672cc7?utm_campaign=referral";
