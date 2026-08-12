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
export { watchOnce } from "./watcher";
export type { PassResult, WatcherDeps, WatcherReply } from "./watcher";
export { announceAgentProfile } from "./profile";
export type { AnnounceDeps } from "./profile";
export {
  createOpenAICompatiblePublicMeckyInference,
  createPiPublicMeckyInference,
  createPublicMecky,
  createPublicMeckyRelayReply,
  createStadtstackReviewedEvidenceReader,
} from "./public-mecky";
export type {
  OpenAICompatiblePublicMeckyInferenceOptions,
  PiPublicMeckyInferenceOptions,
  PublicMecky,
  PublicMeckyDependencies,
  PublicMeckyInference,
  PublicMeckyInferenceInput,
  PublicMeckyRelayReply,
  PublicMeckyResult,
  ReviewedCivicEvidence,
  StadtstackReviewedEvidenceReaderOptions,
} from "./public-mecky";
export { createStadtstackNostrIntakeClient } from "./stadtstack-control";
export type {
  StadtstackCommandReceipt,
  StadtstackNostrIntakeClient,
  StadtstackNostrIntakeClientOptions,
} from "./stadtstack-control";
