import type { NostrEvent } from "@netizen-labs/nostr";

import type { AppMeckyConversationGateway } from "./app-mecky-conversation";
import {
  stagingGet,
  stagingPost,
  type StagingConfigResponse,
} from "./staging-api";

export const appMeckyConversationGateway: AppMeckyConversationGateway = {
  getConfig: () => stagingGet<StagingConfigResponse>("/config"),
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
