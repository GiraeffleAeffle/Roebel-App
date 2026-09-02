// Gnosis Chain (Circles v2) constants for the web app. Mirrors
// apps/expo/constants/gnosis.ts. Source of truth for addresses:
// contracts/governor-contract/deployments/gnosis.json.
import { defineChain } from "thirdweb/chains";
import { resolveIdentityContractSet } from "@roebel/blockchain";

export const gnosis = defineChain(100);

const productionIdentityContractSet = resolveIdentityContractSet();

export const circlesHubAddress = "0xc12C1E50ABB450d6205Ea2C3Fa861b3B834d13e8";
// v2 Sybil-hardened NFTs (2026-06-25). Legacy v1 (2026-06-17):
// Citizen 0x6FF3dC7974a990425DE79F4B21FB0a39F3B04DD4 / Attester 0x7bD6Fd97385BCCf6000380ADd3BF19737c6063C4.
// Production-only: the Circles admin roster and treasury are not part of the
// staging identity rehearsal and must never follow its no-authority test pair.
export const productionCitizenNFTGnosisAddress =
  productionIdentityContractSet.citizenNFT;
export const productionAttesterNFTGnosisAddress =
  productionIdentityContractSet.attesterNFT;
export const attesterSafeGnosisAddress = "0x3A08c86Efc5ff38CC35d850F1D4d564e497bFDEa";
// Röbeltaler Circles v2 BaseGroup (registered 2026-06-17; owner = Attester Safe).
export const roebeltalerGroupAddress = "0xAc2CeCdBead594F97358a0d3132454f24F3E470c";
export const circlesRpcUrl = "https://rpc.aboutcircles.com/";

// The 15 migration-minted citizens on Gnosis (5 are Attesters). Source: gnosis.json.
export const GNOSIS_CITIZENS: { address: string; attester: boolean }[] = [
  { address: "0xC49dE63CcfeE46C6C5c3E393293f66779799Fb28", attester: true },
  { address: "0x90F677dC480e76a127Ec1dCE42263a370e396313", attester: true },
  { address: "0xf468d87FCa0E15bC2c383eF482D38b9b77812b29", attester: true },
  { address: "0xCa598EcD6541177897c7a30cE378e53F5557e951", attester: false },
  { address: "0xD7cA07c0F152fC27F0E48d5326e07026e4fDD4bA", attester: true },
  { address: "0x3B49287F15F5605036d135A296C2bAC2aFbFA24c", attester: true },
  { address: "0xEbf3C1694FBD80b1a7ab8F82e19A1291Cd795227", attester: false },
  { address: "0x466587C1102a99726b2751712c69338cf0401f43", attester: false },
  { address: "0x5Ddf5ee5ac3b5DeB9eae2920E71997e2a07A406B", attester: false },
  { address: "0xa6B3defbBe135f3fcE045e59b3e984c23d43E5a8", attester: false },
  { address: "0x1a3cD237400b032DCfB3d45Ef694674f2dEcdee0", attester: false },
  { address: "0x2645530306321e4758FF93559A4F44a826C6EfA6", attester: false },
  { address: "0x1916bAC01118EE53A7F7eca0F312431b68011Ce4", attester: false },
  { address: "0xd1A7d945fCCa08f67E30E526E34cf4Aaa2725D03", attester: false },
  { address: "0x0e9C37cfc94E1BAFCd53450998Cc26d10A6b5D20", attester: false },
];

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}
