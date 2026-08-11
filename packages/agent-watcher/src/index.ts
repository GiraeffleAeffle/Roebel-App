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
export type { PassResult, WatcherDeps } from "./watcher";
export { announceAgentProfile } from "./profile";
export type { AnnounceDeps } from "./profile";
export {
  createOpenAICompatiblePublicMeckyInference,
  createPublicMecky,
  createStadtstackReviewedEvidenceReader,
} from "./public-mecky";
export type {
  OpenAICompatiblePublicMeckyInferenceOptions,
  PublicMecky,
  PublicMeckyDependencies,
  PublicMeckyInference,
  PublicMeckyInferenceInput,
  PublicMeckyResult,
  ReviewedCivicEvidence,
  StadtstackReviewedEvidenceReaderOptions,
} from "./public-mecky";
