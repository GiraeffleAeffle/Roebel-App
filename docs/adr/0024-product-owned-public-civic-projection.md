---
status: accepted
---

# Product-owned public civic projection

The normal Röbel app must not read the diagnostic `/stadtstack-test` surface directly: that route couples the public journey to a disposable workbench and currently makes deployed civic links disappear when the diagnostic ingress is absent. Röbel will expose a versioned, GET-only `/api/civic/v1` projection for post links, topics, discussions, Mecky conversations, and reviewed later-stage records; its staging adapter may read the existing isolated signed-event projection internally, but it returns only non-synthetic, no-authority public records and never exposes workbench controls or write intents.

The ordinary feed remains the source for ordinary posts and comments, participant writes remain on the bounded participant gateway, and signed Nostr events plus admitted Stadtstack records remain their respective sources of truth. The browser depends only on the public civic projection contract, so the staging adapter can later be replaced by a native relay/index projection without changing the journey UI.
