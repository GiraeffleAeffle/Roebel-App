/**
 * `@netizen-labs/agent-watcher` — a node's agent answers when mentioned.
 *
 * Tag the agent's pubkey in a note and it replies in place, labelled as machine
 * authored. The bounds live in `bounds.ts` and are enforced before any answer is
 * produced, because an agent that replies to everything is a spam engine wearing
 * the community's identity.
 */
export { DEFAULT_BOUNDS, emptyHistory, recordReply, shouldAnswer } from "./bounds";
export type { Bounds, Decision, Refusal, ReplyHistory } from "./bounds";
export { DEFAULT_LOOKBACK_SECONDS, watchOnce } from "./watcher";
export type { PassResult, WatcherDeps, WatcherReply } from "./watcher";
export { createPublicMeckyReplyProjectionSink } from "./public-mecky-projection";
export type {
  PublicMeckyReplyProjectionSink,
  PublicMeckyReplyProjectionSinkOptions,
} from "./public-mecky-projection";
export { announceAgentProfile } from "./profile";
export type { AnnounceDeps } from "./profile";
export { createDirectMentionEvidence } from "./conversation-evidence";
export type { DirectMentionEvidenceOptions } from "./conversation-evidence";
export {
  createOpenAICompatiblePublicMeckyInference,
  createPiPublicMeckyInference,
  createPublicMecky,
  createPublicMeckyEvidenceReply,
  createPublicMeckyRelayReply,
  createStadtstackPublicEvidenceRetriever,
  createStadtstackReviewedEvidenceReader,
  publicMeckyDiscussionBindingFor,
} from "./public-mecky";
export type {
  OpenAICompatiblePublicMeckyInferenceOptions,
  PiPublicMeckyInferenceOptions,
  PublicMecky,
  PublicMeckyDiscussionBinding,
  PublicMeckyEvidenceReply,
  PublicMeckyDependencies,
  PublicMeckyInference,
  PublicMeckyInferenceInput,
  PublicMeckyMention,
  PublicMeckyRelayReply,
  PublicMeckyResult,
  ReviewedCivicEvidence,
  StadtstackReviewedEvidenceReaderOptions,
  StadtstackPublicEvidenceRetrieverOptions,
} from "./public-mecky";
export {
  createInMemoryPublicEvidenceCatalog,
  createPublicEvidencePacket,
  createPublicKnowledgeCatalog,
  parsePublicEvidence,
  publicEvidenceUrl,
  renderPromptEvidence,
  retrievePublicEvidence,
  toPromptPublicEvidence,
  DEFAULT_PUBLIC_EVIDENCE_LIMIT,
  DEFAULT_PUBLIC_EVIDENCE_MAX_PROMPT_BYTES,
  PUBLIC_EVIDENCE_OMISSION_REASONS,
} from "./public-evidence";
export type {
  LocalNewsEvidence,
  NostrPostEvidence,
  PromptPublicEvidence,
  PublicEvidence,
  PublicEvidenceAdmissionState,
  PublicEvidenceAuthority,
  PublicEvidenceLifecycle,
  PublicEvidenceOmission,
  PublicEvidenceOmissionReason,
  PublicEvidencePacket,
  PublicEvidenceQuery,
  PublicEvidenceRetrievalOptions,
  PublicEvidenceSourceAdapter,
  PublicEvidenceSourceKind,
  PublicKnowledgeCatalog,
  RatsinformationEvidence,
  RetrievedPublicEvidence,
  ReviewedCivicCaseEvidence,
} from "./public-evidence";
export {
  createReviewedPublicKnowledgeSourceAdapter,
  parseReviewedPublicKnowledgeSourceKinds,
  ReviewedPublicKnowledgeError,
  sealReviewedPublicKnowledgeProjection,
  REVIEWED_PUBLIC_KNOWLEDGE_SOURCE_KINDS,
} from "./reviewed-public-knowledge";
export type {
  ReviewedPublicKnowledgeAdapterOptions,
  ReviewedPublicKnowledgeErrorCode,
  ReviewedPublicKnowledgeProjection,
  ReviewedPublicKnowledgeProjectionDraft,
  ReviewedPublicKnowledgeRecord,
  ReviewedPublicKnowledgeSourceKind,
} from "./reviewed-public-knowledge";
export { createStadtstackNostrIntakeClient } from "./stadtstack-control";
export type {
  StadtstackCommandReceipt,
  StadtstackNostrIntakeClient,
  StadtstackNostrIntakeClientOptions,
} from "./stadtstack-control";
