import { RelayClient } from "@netizen-labs/nostr";
import WebSocket from "ws";

/**
 * Node does not expose a WebSocket global in every supported runtime build.
 * Keep the shared Nostr package isomorphic and inject the reviewed Node
 * transport only at the watcher CLI boundary.
 */
export function createNodeRelayClient(url: string): RelayClient {
  return new RelayClient(url, {
    timeoutMs: 15_000,
    webSocketFactory: (target) => new WebSocket(target) as never,
  });
}
