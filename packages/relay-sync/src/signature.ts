import {
  hashMessage,
  recoverAddress,
  recoverMessageAddress,
  recoverTypedDataAddress,
} from "viem";

/**
 * Recovering the signer of a smart-account signature.
 *
 * A thirdweb smart account does NOT sign with a key of its own — its admin EOA
 * signs, and the account validates via ERC-1271. Two things make a naive
 * `verifyMessage` check fail against a perfectly valid signature:
 *
 *  1. The account wraps the message in an EIP-712 `AccountMessage` struct, so the
 *     signed digest is not `hashMessage(message)`.
 *  2. The EIP-712 domain carries the chain the WALLET is configured for, which is
 *     not necessarily the chain the account is deployed on. The Röbel app's
 *     primary wallet is still configured for Base (8453) while its accounts are
 *     read on Gnosis (100) — the address is identical on both, since it is
 *     deterministic CREATE2 from factory + admin + salt.
 *
 * So instead of asserting one convention, recover the signer under every
 * plausible one and let the caller check admin-ness ON-CHAIN. That check is what
 * provides authorisation; this module only proposes candidates.
 */

/** Chains whose EIP-712 domain we accept. Gnosis is where accounts live; Base is what the app still signs with. */
export const SIGNING_CHAIN_IDS = [100, 8453] as const;

export interface SignerCandidate {
  label: string;
  address: string;
}

const ACCOUNT_MESSAGE_TYPES = {
  AccountMessage: [{ name: "message", type: "bytes" }],
} as const;

/**
 * Every address that could plausibly have produced this signature.
 *
 * Pure and offline apart from the optional `accountDigest`, which the caller
 * supplies from the account's own `getMessageHash` when available — that is the
 * most authoritative variant, because the contract states its own terms.
 */
export async function recoverCandidateSigners(args: {
  account: string;
  message: string;
  signature: string;
  /** Result of `getMessageHash(hashMessage(message))` on the account, if readable. */
  accountDigest?: string;
}): Promise<SignerCandidate[]> {
  const { account, message, signature } = args;
  const candidates: SignerCandidate[] = [];
  const push = async (label: string, recover: () => Promise<string>) => {
    try {
      candidates.push({ label, address: (await recover()).toLowerCase() });
    } catch {
      // A convention that cannot even be recovered is simply not a candidate.
    }
  };

  if (args.accountDigest) {
    await push("account-getMessageHash", () =>
      recoverAddress({
        hash: args.accountDigest as `0x${string}`,
        signature: signature as `0x${string}`,
      }),
    );
  }

  await push("personal_sign", () =>
    recoverMessageAddress({ message, signature: signature as `0x${string}` }),
  );

  for (const chainId of SIGNING_CHAIN_IDS) {
    await push(`eip712-cid${chainId}`, () =>
      recoverTypedDataAddress({
        domain: {
          name: "Account",
          version: "1",
          chainId,
          verifyingContract: account as `0x${string}`,
        },
        types: ACCOUNT_MESSAGE_TYPES,
        primaryType: "AccountMessage",
        message: { message: hashMessage(message) },
        signature: signature as `0x${string}`,
      }),
    );
  }

  return candidates;
}
