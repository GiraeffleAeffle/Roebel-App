/**
 * `@netizen-labs/nostr` — the Nostr primitives a Netizen node and its apps share.
 *
 * Wallet-derived identity, NIP-01 events, the wallet↔npub binding proof, and a
 * dependency-free relay client. Isomorphic: the same code runs in the Expo app,
 * in the allow-list syncer on the sovereign node, and in tests.
 *
 * See docs/superpowers/specs/2026-07-27-nostr-citizen-identity-bridge-design.md.
 */
export {
  NOSTR_KEY_DERIVATION_MESSAGE,
  deriveNostrIdentity,
  deriveNostrSecretKey,
  getPublicKeyHex,
  isNostrPubkey,
  npubDecode,
  npubEncode,
  nsecEncode,
} from "./keys";

export {
  KIND,
  buildDeletionEvent,
  buildEvent,
  buildNoteEvent,
  buildProfileEvent,
  buildVanishEvent,
  eventId,
  signEvent,
  verifyEvent,
} from "./events";
export type {
  NostrEvent,
  NostrTag,
  ProfileMetadata,
  UnsignedEvent,
} from "./events";

export {
  BINDING_ACCOUNT_TAG,
  BINDING_D_TAG,
  bindingStatement,
  buildBindingEvent,
  verifyBindingEvent,
} from "./binding";
export type { BindingFailure, BindingResult, BindingSubject } from "./binding";

export {
  AGENT_TAG,
  agentOf,
  buildAgentNoteEvent,
  buildAgentProfileEvent,
  deriveAgentIdentity,
  isAgentEvent,
} from "./agent";
export type { AgentIdentity } from "./agent";

export {
  KIND_DATE_BASED_EVENT,
  KIND_TIME_BASED_EVENT,
  buildCalendarEvent,
  parseCalendarEvent,
} from "./calendar";
export type { CalendarEventInput } from "./calendar";

export {
  AUTHORIZED_BY_TAG,
  authorizedBy,
  buildOrgProfileEvent,
  deriveOrgIdentity,
  withAuthorizedBy,
} from "./org";
export type { OrgIdentity } from "./org";

export { RelayClient } from "./relay";
export type { Filter, PublishResult, RelayOptions } from "./relay";

export {
  buildCivicArgumentEvent,
  buildCitizenSignedSuggestion,
  buildCivicDiscussionEvent,
  buildCivicPromotionEvent,
  buildCivicTopicPromotionEvent,
} from "./civic";
export type {
  CivicArgumentInput,
  CitizenSignedSuggestionInput,
  CitizenSignedSuggestionV1,
  CivicCaseBinding,
  CivicDiscussionInput,
  CivicPromotionInput,
  CivicTopicBinding,
  CivicTopicPromotionInput,
  PublicMeckySuggestionDraftV1,
} from "./civic";
