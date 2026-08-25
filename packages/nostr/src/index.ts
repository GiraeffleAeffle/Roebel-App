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
  APP_CONVERSATION_TOPIC,
  isAppConversationMentionEvent,
} from "./conversation";

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
  buildCitizenSignedTopicSuggestion,
  buildCitizenSignedSuggestion,
  buildCivicDiscussionEvent,
  buildCivicPromotionEvent,
  buildCivicTopicPromotionEvent,
  buildCitizenTopicSuggestionAdoption,
  buildParticipantTopicSuggestion,
  verifyCivicTopicPromotionEvent,
  verifyCitizenSignedTopicSuggestion,
  verifyCitizenTopicSuggestionAdoption,
  verifyParticipantTopicSuggestion,
} from "./civic";
export type {
  CivicArgumentInput,
  CivicConversationWitnesses,
  CivicSelectedConversationSource,
  CitizenSignedTopicSuggestionInput,
  CitizenSignedTopicSuggestionV1,
  CitizenSignedSuggestionInput,
  CitizenSignedSuggestionV1,
  CivicCaseBinding,
  CivicDiscussionInput,
  CivicPromotionInput,
  CivicTopicBinding,
  CivicTopicPromotionInput,
  CitizenTopicSuggestionAdoptionInput,
  CitizenTopicSuggestionAdoptionV1,
  MunicipalCivicEligibilityPolicyV1,
  MunicipalCivicEligibilityReceiptProofInputV1,
  MunicipalCivicEligibilityReceiptV1,
  ParticipantTopicSuggestionInput,
  ParticipantTopicSuggestionV1,
  PublicParticipantTopicSuggestionDraftV1,
  PublicMeckyTopicSuggestionDraftV1,
  PublicMeckySuggestionDraftV1,
  VerifyCitizenSignedTopicSuggestionInput,
  VerifyCitizenTopicSuggestionAdoptionInput,
  VerifyParticipantTopicSuggestionInput,
  PublicCitizenTopicSuggestionAdoptionV1,
} from "./civic";
