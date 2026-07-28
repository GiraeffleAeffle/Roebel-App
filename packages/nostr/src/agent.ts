import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { KIND, type NostrEvent, buildEvent, type ProfileMetadata } from "./events";
import { deriveNostrSecretKey, getPublicKeyHex, npubEncode } from "./keys";

/**
 * Agents as first-class members of a node's public record.
 *
 * An agent is not a person with a wallet, so it cannot derive its key from a
 * wallet signature the way a Citizen does. It derives from a secret the NODE
 * holds, scoped by node id and agent name, so:
 *
 *  - the same agent on the same node always has the same npub (reputation accrues)
 *  - two agents on one node never collide
 *  - the same agent name on two different nodes is a DIFFERENT identity, because
 *    "Mecky of Röbel" and "Mecky of some other town" are not the same actor and
 *    must not be able to speak for each other
 *
 * The node secret never leaves the node. Losing it re-keys that node's agents —
 * which is why it belongs with the node's other secrets, not in a manifest.
 */

/** Domain separation, so an agent key can never collide with a Citizen's. */
const AGENT_DERIVATION_PREFIX = "Netizen Agent-Identität v1";

export interface AgentIdentity {
  name: string;
  nodeId: string;
  secretKey: Uint8Array;
  publicKey: string;
  npub: string;
}

/**
 * Derive a node's agent identity deterministically.
 *
 * `nodeSecret` is a high-entropy secret held by the node. The derived key is a
 * pure function of (secret, node, agent), so an agent that loses its local state
 * recovers the same identity rather than appearing as a stranger.
 */
export function deriveAgentIdentity(
  nodeSecret: string,
  nodeId: string,
  name: string,
): AgentIdentity {
  if (!nodeSecret || nodeSecret.length < 32) {
    throw new Error("nodeSecret must be at least 32 characters of high-entropy secret");
  }
  if (!/^[a-z0-9-]+$/.test(nodeId)) throw new Error(`node id must be a lowercase slug: ${nodeId}`);
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`agent name must be a lowercase slug: ${name}`);

  // Hash the scoped statement into the same shape a wallet signature would take,
  // so agent and Citizen keys go through one derivation path.
  const scoped = `${AGENT_DERIVATION_PREFIX}\nnode=${nodeId}\nagent=${name}\nsecret=${nodeSecret}`;
  const seed = bytesToHex(keccak_256(utf8ToBytes(scoped)));
  const secretKey = deriveNostrSecretKey(seed);
  const publicKey = getPublicKeyHex(secretKey);
  return { name, nodeId, secretKey, publicKey, npub: npubEncode(publicKey) };
}

/** Tag marking an event as machine-authored, and naming which agent. */
export const AGENT_TAG = "netizen_agent";

/**
 * An agent's kind 0 profile.
 *
 * Sets NIP-24's `bot: true`, which is the standard field every Nostr client
 * already understands. A town's public record has to let anyone — human or
 * machine — tell "a citizen wrote this" from "an AI generated this". Labelling is
 * not decoration: an unlabelled agent in a civic feed is indistinguishable from a
 * resident, and that is the failure mode that erodes trust in the whole record.
 */
export function buildAgentProfileEvent(
  agent: AgentIdentity,
  metadata: ProfileMetadata & { about?: string },
  options: { createdAt?: number } = {},
): NostrEvent {
  const content = JSON.stringify({
    ...Object.fromEntries(
      Object.entries(metadata).filter(([, v]) => v !== undefined && v !== null && v !== ""),
    ),
    bot: true,
  });
  return buildEvent(agent.secretKey, KIND.profile, content, {
    createdAt: options.createdAt,
    tags: [[AGENT_TAG, agent.name, agent.nodeId]],
  });
}

/**
 * A note published by an agent.
 *
 * Carries the agent tag in addition to the `bot` profile flag, so a single event
 * is self-describing even to a reader that never fetched the profile.
 */
export function buildAgentNoteEvent(
  agent: AgentIdentity,
  content: string,
  options: { createdAt?: number; tags?: string[][] } = {},
): NostrEvent {
  return buildEvent(agent.secretKey, KIND.note, content, {
    createdAt: options.createdAt,
    tags: [[AGENT_TAG, agent.name, agent.nodeId], ...(options.tags ?? [])],
  });
}

/** True when an event declares itself machine-authored. */
export function isAgentEvent(event: NostrEvent): boolean {
  return event.tags?.some((t) => t[0] === AGENT_TAG) ?? false;
}

/** Which agent, and from which node, authored this — or null if it is not an agent event. */
export function agentOf(event: NostrEvent): { name: string; nodeId: string } | null {
  const tag = event.tags?.find((t) => t[0] === AGENT_TAG);
  if (!tag || !tag[1]) return null;
  return { name: tag[1], nodeId: tag[2] ?? "" };
}
