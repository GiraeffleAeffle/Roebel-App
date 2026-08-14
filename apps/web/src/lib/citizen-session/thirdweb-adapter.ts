import { createCitizenSession, type CitizenSession } from "./session";

/** Structural subset of a Thirdweb Account; keeps the SDK behind the adapter. */
export type ThirdwebSigningAccount = {
  address: string;
  signMessage(args: { message: string }): Promise<string>;
};

export type ThirdwebCitizenSessionInput = {
  account: ThirdwebSigningAccount;
  memberId: string | null;
  appAccountId: string | null;
};

export function createThirdwebCitizenSession(
  input: ThirdwebCitizenSessionInput
): CitizenSession {
  return createCitizenSession({
    memberId: input.memberId,
    appAccountId: input.appAccountId,
    credential: {
      kind: "thirdweb_smart_account",
      address: input.account.address,
      chainId: 100,
      signMessage: (args) => input.account.signMessage(args),
    },
  });
}
