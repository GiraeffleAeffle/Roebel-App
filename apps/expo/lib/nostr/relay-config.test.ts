import assert from 'node:assert/strict';
import { resolvePublicRelayUrls } from './relay-config';

describe('public relay configuration', () => {
  it('uses a separate bounded relay for Mecky replies', () => {
    assert.deepEqual(
      resolvePublicRelayUrls({
        EXPO_PUBLIC_NOSTR_RELAY_URL: 'wss://staging.example/citizen-relay',
        EXPO_PUBLIC_MECKY_REPLY_RELAY_URL: 'wss://staging.example/agent-relay',
      }),
      {
        citizenRelayUrl: 'wss://staging.example/citizen-relay',
        agentRelayUrl: 'wss://staging.example/agent-relay',
      },
    );
  });

  it('keeps the production-compatible single-relay default', () => {
    const config = resolvePublicRelayUrls({});
    assert.equal(config.citizenRelayUrl, 'wss://relay.roebel.app');
    assert.equal(config.agentRelayUrl, config.citizenRelayUrl);
  });

  it('rejects plaintext remote, credentials, queries, and fragments', () => {
    for (const value of [
      'ws://remote.example/relay',
      'wss://user:secret@remote.example/relay',
      'wss://remote.example/relay?token=secret',
      'wss://remote.example/relay#fragment',
    ]) {
      assert.throws(() => resolvePublicRelayUrls({ EXPO_PUBLIC_NOSTR_RELAY_URL: value }));
    }
    assert.equal(
      resolvePublicRelayUrls({ EXPO_PUBLIC_NOSTR_RELAY_URL: 'ws://127.0.0.1:18081/citizen-relay' }).citizenRelayUrl,
      'ws://127.0.0.1:18081/citizen-relay',
    );
  });
});
