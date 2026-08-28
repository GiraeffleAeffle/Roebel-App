import type { NostrEvent } from "@netizen-labs/nostr";

import type { AppMeckyConversationGateway } from "./app-mecky-conversation";
import { stagingPost } from "./staging-api";
import { loadPublicCivicInstance } from "./civic-projection-client";

export const appMeckyConversationGateway: AppMeckyConversationGateway = {
  getConfig: loadPublicCivicInstance,
  admit: (proof) =>
    stagingPost<{ status: "admitted"; pubkey: string }>(
      "/session/admit",
      proof
    ),
  publish: (event: NostrEvent) =>
    stagingPost<{ status: "published"; event: NostrEvent }>("/signed-event", {
      intent: "conversation",
      event,
    }),
};
