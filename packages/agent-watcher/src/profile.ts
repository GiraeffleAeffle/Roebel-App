import {
  RelayClient,
  buildAgentProfileEvent,
  type AgentIdentity,
  type ProfileMetadata,
} from "@netizen-labs/nostr";

/**
 * Announce the agent's own kind 0 profile.
 *
 * Without this an agent is *nameless*: it answers questions, but every client
 * shows a bare 64-hex pubkey instead of "Mecky", and nothing marks the author as
 * a machine except a tag most readers never see. That is precisely the state a
 * civic feed must not be in — see `buildAgentProfileEvent`, which sets NIP-24
 * `bot: true`.
 *
 * Published on every startup, deliberately. kind 0 is a *replaceable* event, so
 * re-announcing is idempotent — the relay keeps one profile per pubkey and the
 * newest wins. Making it automatic is what stops a profile from being a manual
 * step somebody has to remember, and it is what makes a node-secret rotation
 * self-healing: the agent comes back under a new key already introduced, instead
 * of silently anonymous until a human notices.
 */

export interface AnnounceDeps {
  agent: AgentIdentity;
  relayUrl: string;
  metadata: ProfileMetadata;
  makeClient?: (url: string) => Pick<RelayClient, "publish" | "close">;
  log?: (message: string) => void;
}

/**
 * Returns whether the relay accepted the profile.
 *
 * Never throws. A node whose relay is briefly unreachable should still start
 * watching — losing the introduction is a cosmetic failure, while refusing to
 * boot over it is an outage.
 */
export async function announceAgentProfile(deps: AnnounceDeps): Promise<boolean> {
  const log = deps.log ?? (() => {});
  const client = deps.makeClient
    ? deps.makeClient(deps.relayUrl)
    : new RelayClient(deps.relayUrl, { timeoutMs: 15_000 });

  try {
    const event = buildAgentProfileEvent(deps.agent, deps.metadata);
    const result = await client.publish(event);
    if (result.ok) {
      log(`profile published for "${deps.agent.name}" (${deps.agent.publicKey.slice(0, 12)}…)`);
      return true;
    }
    // The most likely cause is the agent's key missing from the relay allow-list,
    // which is a real misconfiguration worth naming rather than a transient blip.
    // The relay always states a reason, so pass it through verbatim.
    log(`profile rejected by relay: ${result.message}`);
    return false;
  } catch (error) {
    log(`profile publish failed: ${(error as Error).message}`);
    return false;
  } finally {
    client.close();
  }
}
