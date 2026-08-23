/**
 * Semaphore Identity Management Library
 * Handles Semaphore identity generation, storage, and proof generation
 */

import { Identity } from "@semaphore-protocol/identity";
import { Group } from "@semaphore-protocol/group";
import { generateProof, type SemaphoreProof } from "@semaphore-protocol/proof";

export {
  deleteIdentity,
  exportIdentity,
  formatIdentityInfo,
  generateIdentity,
  generateIdentityFromSecret,
  getCommitment,
  getIdentityAge,
  hasIdentity,
  importIdentity,
  isValidCommitment,
  loadIdentity,
  saveIdentity,
} from "./semaphore/identity";

/**
 * Create a Semaphore group from member commitments
 */
export function createGroup(
  groupId: string,
  members: string[] = [],
  treeDepth: number = 20
): Group {
  const group = new Group();
  // Add members to the group
  members.forEach(member => group.addMember(member));
  return group;
}

/**
 * Generate a Semaphore proof for a message
 * @param identity The user's Semaphore identity
 * @param group The Semaphore group
 * @param message The message to sign (will be hashed)
 * @param scope The scope (typically groupId or proposalId)
 */
export async function generateSemaphoreProof(
  identity: Identity,
  group: Group,
  message: bigint | string,
  scope: bigint | string
): Promise<SemaphoreProof> {
  try {
    const proof = await generateProof(identity, group, message, scope);
    return proof;
  } catch (error) {
    console.error("❌ Failed to generate proof:", error);
    throw new Error("Failed to generate proof");
  }
}

/**
 * Hash a message for Semaphore (constrain to SNARK field)
 */
export function hashMessage(message: string): bigint {
  const hash = BigInt(
    "0x" +
      Array.from(new TextEncoder().encode(message))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
  );

  // Constrain to SNARK scalar field
  const SNARK_FIELD_SIZE = BigInt(
    "21888242871839275222246405745257275088548364400416034343698204186575808495617"
  );
  return hash % SNARK_FIELD_SIZE;
}
