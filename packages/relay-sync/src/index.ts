/**
 * `@netizen-labs/relay-sync` — keeps a Netizen relay's write allow-list in step
 * with on-chain membership.
 *
 * Each pass: read the private wallet↔npub registry, verify both halves of every
 * binding (Schnorr offline, ERC-1271 on-chain), confirm the wallet still holds a
 * CitizenNFT, and atomically rewrite the allow-list the strfry write policy
 * reads. Revocation is the same code path as admission.
 *
 * See docs/superpowers/specs/2026-07-27-nostr-citizen-identity-bridge-design.md.
 */
export { createGnosisVerifier, createGnosisWalletVerifier } from "./chain.js";
export type {
  GnosisVerifierOptions,
  GnosisWalletVerifierOptions,
} from "./chain.js";

export { createSupabaseRegistry } from "./registry.js";
export type { RegistryOptions } from "./registry.js";

export {
  parseAllowList,
  renderAllowList,
  writeAllowList,
} from "./allowlist.js";

export { syncAllowList } from "./sync.js";
export type { SyncDeps } from "./sync.js";

export { verifyRegistryRow } from "./verify.js";

export type {
  ChainVerifier,
  RegistryRow,
  RejectionReason,
  SyncSummary,
  VerificationOutcome,
} from "./types.js";
