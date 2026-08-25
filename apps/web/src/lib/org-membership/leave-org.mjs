import { runNonStagingMutation } from "../stadtstack/profile-write-boundary.mjs";

export const LAST_OWNER_MESSAGE =
  "Du bist der einzige Inhaber. Übertrage die Inhaberschaft, bevor du die Organisation verlässt.";

/**
 * Execute the complete leave operation behind the staging boundary. Owner
 * lookup is part of the operation, so explicit staging performs zero I/O.
 */
export async function executeLeaveOrg({
  stagingFlag,
  account,
  accountId,
  fetchOwners,
  leave,
}) {
  return runNonStagingMutation(stagingFlag, async () => {
    const walletAddress = account.address.toLowerCase();
    const owners = await fetchOwners(accountId);
    const ownerCount = owners.filter((owner) => owner.role === "owner").length;
    const myRole = owners.find(
      (owner) => owner.wallet_address.toLowerCase() === walletAddress,
    )?.role;

    if (myRole === "owner" && ownerCount <= 1) {
      throw new Error(LAST_OWNER_MESSAGE);
    }

    const response = await leave(account, accountId);
    if (!response.ok) {
      if (response.code === "LAST_OWNER") throw new Error(LAST_OWNER_MESSAGE);
      console.error("leaveOrg error:", response.code, response.message);
      throw new Error(response.message || response.code || "leaveOrg failed");
    }
  });
}
