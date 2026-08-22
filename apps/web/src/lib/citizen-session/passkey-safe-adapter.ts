import { createCitizenSession, type CitizenSession } from "./session";

/**
 * Structural subset exposed by the passkey-owned Safe implementation.
 *
 * WebAuthn, Safe Protocol Kit, and Pimlico stay behind this adapter. Civic
 * callers only receive the same bounded CitizenSession they already use with
 * Thirdweb.
 */
export type PasskeySafeSigningAccount = {
  address: string;
  signMessage(args: { message: string }): Promise<string>;
};

export type PasskeySafeCitizenSessionInput = {
  account: PasskeySafeSigningAccount;
  memberId: string;
  appAccountId: string;
};

export function createPasskeySafeCitizenSession(
  input: PasskeySafeCitizenSessionInput
): CitizenSession {
  return createCitizenSession({
    memberId: input.memberId,
    appAccountId: input.appAccountId,
    credential: {
      kind: "passkey_safe",
      address: input.account.address,
      chainId: 100,
      signMessage: (args) => input.account.signMessage(args),
    },
  });
}
