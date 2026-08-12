const DEFAULT_CITIZEN_RELAY_URL = 'wss://relay.roebel.app';

export interface PublicRelayUrls {
  agentRelayUrl: string;
  citizenRelayUrl: string;
}

function normalizeRelayUrl(value: string, field: string): string {
  if (value.length > 512) throw new Error(`${field}_invalid`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field}_invalid`);
  }
  const localDevelopment =
    url.protocol === 'ws:' && (url.hostname === '127.0.0.1' || url.hostname === 'localhost');
  if (url.protocol !== 'wss:' && !localDevelopment) throw new Error(`${field}_must_use_wss`);
  if (url.username || url.password || url.search || url.hash) throw new Error(`${field}_invalid`);
  return url.toString().replace(/\/$/, url.pathname === '/' ? '' : '/');
}

/**
 * Public client relay split. Citizens write/read their own signed discussion on
 * one relay; Mecky publishes only to the second. Production stays compatible
 * until an explicit agent relay is configured.
 */
export function resolvePublicRelayUrls(
  environment: Record<string, string | undefined> = process.env,
): PublicRelayUrls {
  const citizenRelayUrl = normalizeRelayUrl(
    environment.EXPO_PUBLIC_NOSTR_RELAY_URL?.trim() || DEFAULT_CITIZEN_RELAY_URL,
    'EXPO_PUBLIC_NOSTR_RELAY_URL',
  );
  const agentRelayUrl = normalizeRelayUrl(
    environment.EXPO_PUBLIC_MECKY_REPLY_RELAY_URL?.trim() || citizenRelayUrl,
    'EXPO_PUBLIC_MECKY_REPLY_RELAY_URL',
  );
  return { agentRelayUrl, citizenRelayUrl };
}
