import type { NostrEvent } from "@netizen-labs/nostr";

/** One row of the private `nostr_identities` registry. */
export interface RegistryRow {
  /** Lowercase smart-account address. */
  wallet_address: string;
  pubkey_hex: string;
  npub: string;
  /** EIP-191 signature over the binding statement, produced by the smart account. */
  eth_signature: string;
  /** The Nostr half of the binding — a signed NIP-78 event. */
  binding_event: NostrEvent;
  revoked_at: string | null;
}

/**
 * The two on-chain questions the syncer must answer, behind an interface so the
 * verification logic is testable without a node.
 */
export interface ChainVerifier {
  /**
   * Verify a signature against a smart account (ERC-1271 `isValidSignature`) —
   * Citizens hold ERC-4337 accounts, so this is a contract call, not an ecrecover.
   */
  verifyWalletSignature(args: {
    address: string;
    message: string;
    signature: string;
  }): Promise<boolean>;

  /** Does this wallet currently hold a CitizenNFTv2? */
  holdsCitizenNft(address: string): Promise<boolean>;
}

export type RejectionReason =
  | "revoked"
  | "malformed-row"
  | "pubkey-mismatch"
  | "binding-wrong-kind"
  | "binding-wrong-d-tag"
  | "binding-account-mismatch"
  | "binding-statement-mismatch"
  | "binding-bad-signature"
  | "wallet-signature-invalid"
  | "not-a-citizen";

export type VerificationOutcome =
  | { allowed: true; pubkey: string; wallet: string }
  | { allowed: false; wallet: string; reason: RejectionReason };

export interface SyncSummary {
  checked: number;
  allowed: number;
  rejected: Array<{ wallet: string; reason: RejectionReason }>;
  /** True when the allow-list file actually changed this pass. */
  changed: boolean;
}
