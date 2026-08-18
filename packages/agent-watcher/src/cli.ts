#!/usr/bin/env node
import { deriveAgentIdentity } from "@netizen-labs/nostr";
import { DEFAULT_BOUNDS, emptyHistory } from "./bounds";
import { announceAgentProfile } from "./profile";
import {
  createPiPublicMeckyInference,
  createPublicMecky,
  createPublicMeckyRelayReply,
  createStaticReviewedEvidenceReader,
  createStadtstackReviewedEvidenceReader,
  publicMeckyDiscussionBindingFor,
  toPublicMeckyWatcherReply,
} from "./public-mecky";
import { createNodeRelayClient } from "./node-relay-client";
import { singleFlight } from "./single-flight";
import { watchOnce } from "./watcher";

/**
 * `netizen-agent-watcher` — runs beside the relay and answers mentions from
 * checksum-bound, publicly reviewed Stadtstack evidence.
 *
 * Deliberately stateless across restarts except for what it can re-derive from
 * the relay: each pass reads recent mentions plus its own published replies.
 * Those reply events restore the answered-set and rate-limit history, so a
 * restart neither loses a question nor answers it twice.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`missing required env var: ${name}`);
    process.exit(2);
  }
  return value;
}

async function main(): Promise<void> {
  const nodeId = required("NODE_ID");
  const nodeName = process.env.NODE_NAME ?? nodeId;
  const agentName = process.env.AGENT_NAME ?? "mecky";
  const inputRelayUrl = process.env.INPUT_RELAY_URL ?? required("RELAY_URL");
  const outputRelayUrl = process.env.OUTPUT_RELAY_URL ?? inputRelayUrl;
  const publicEvidenceBaseUrl = required("STADTSTACK_PUBLIC_BASE_URL");
  const municipalityId = required("MECKY_MUNICIPALITY_ID");
  const sourceCaseId = required("MECKY_SOURCE_CASE_ID");
  const canonicalCaseId = required("MECKY_CANONICAL_CASE_ID");
  const inferenceBaseUrl = required("MECKY_INFERENCE_BASE_URL");
  const inferenceModel = required("MECKY_INFERENCE_MODEL");
  const inferenceApiKey = required("MECKY_INFERENCE_API_KEY");
  const intervalSeconds = Number(process.env.WATCH_INTERVAL_SECONDS ?? 20);
  const lookbackSeconds = Number(process.env.WATCH_LOOKBACK_SECONDS ?? 86_400);

  const syntheticEvidenceMode = process.env.STADTSTACK_E2E_MODE === "synthetic-reviewed";
  const readReviewedEvidence = syntheticEvidenceMode
    ? createStaticReviewedEvidenceReader(
        required("STADTSTACK_E2E_REVIEWED_EVIDENCE"),
        required("STADTSTACK_E2E_REVIEWED_EVIDENCE_SHA256"),
      )
    : createStadtstackReviewedEvidenceReader({
        baseUrl: publicEvidenceBaseUrl,
        municipalityId,
      });
  const publicMecky = createPublicMecky({
    readReviewedEvidence,
    infer: createPiPublicMeckyInference({
      baseUrl: inferenceBaseUrl,
      apiKey: inferenceApiKey,
      model: inferenceModel,
      timeoutMs: Number(process.env.MECKY_INFERENCE_TIMEOUT_MS ?? 30_000),
    }),
  });
  const agent = deriveAgentIdentity(required("NODE_AGENT_SECRET"), nodeId, agentName);
  const history = emptyHistory();
  const bounds = {
    ...DEFAULT_BOUNDS,
    enabled: process.env.AGENT_ENABLED !== "false",
    perAuthorPerHour: Number(process.env.AGENT_PER_AUTHOR_PER_HOUR ?? DEFAULT_BOUNDS.perAuthorPerHour),
    perDay: Number(process.env.AGENT_PER_DAY ?? DEFAULT_BOUNDS.perDay),
  };

  console.log(`agent "${agentName}" on "${nodeId}" watching ${inputRelayUrl}`);
  console.log(`  replies: ${outputRelayUrl}`);
  console.log(`  npub ${agent.npub}`);
  console.log(`  reviewed evidence: ${syntheticEvidenceMode ? "synthetic checksum-bound snapshot" : publicEvidenceBaseUrl} (${municipalityId})`);
  console.log(`  inference: ${inferenceBaseUrl} (${inferenceModel})`);
  console.log(`  bounds: ${bounds.perAuthorPerHour}/author/h, ${bounds.perDay}/day, enabled=${bounds.enabled}`);

  // Introduce ourselves before answering anything. kind 0 is replaceable, so this
  // is idempotent across restarts, and it means a re-keyed agent is never left
  // publishing under a pubkey no client can put a name to.
  await announceAgentProfile({
    agent,
    relayUrl: outputRelayUrl,
    makeClient: createNodeRelayClient,
    metadata: {
      name: process.env.AGENT_DISPLAY_NAME ?? agentName[0].toUpperCase() + agentName.slice(1),
      about:
        process.env.AGENT_ABOUT ??
        `KI-Assistent von ${nodeName}. Antwortet, wenn man ihn erwähnt.`,
      ...(process.env.AGENT_PICTURE ? { picture: process.env.AGENT_PICTURE } : {}),
    },
    log: (m) => console.log(`  ${m}`),
  });

  const pass = async () => {
    try {
      const result = await watchOnce({
        agent,
        history,
        bounds,
        lookbackSeconds,
        relayUrl: inputRelayUrl,
        replyRelayUrl: outputRelayUrl,
        makeClient: createNodeRelayClient,
        think: async (question, event) => {
          const answer = await publicMecky.answerMention(question);
          if (answer.status === "answered") {
            const civic = event.tags.some(
              (tag) =>
                tag[0] === "t" &&
                tag[1] === "stadtstack-civic-discussion",
            );
            return civic
              ? toPublicMeckyWatcherReply(createPublicMeckyRelayReply({
                  discussion: event,
                  binding: publicMeckyDiscussionBindingFor(event, {
                    municipalityId,
                    sourceCaseId,
                    canonicalCaseId,
                  }),
                  result: answer,
                }))
              : answer.content;
          }
          console.log(
            `[${new Date().toISOString()}] declined public Mecky answer: ${answer.reason} (${answer.diagnosticCode})`,
          );
          if (answer.retryable) {
            throw new Error(`public_mecky_retryable:${answer.diagnosticCode}`);
          }
          return null;
        },
        log: (m) => console.log(`[${new Date().toISOString()}] ${m}`),
      });
      if (result.answered || Object.keys(result.refused).length) {
        console.log(
          `[${new Date().toISOString()}] seen ${result.seen}, answered ${result.answered}` +
            (Object.keys(result.refused).length ? `, refused ${JSON.stringify(result.refused)}` : ""),
        );
      }
    } catch (error) {
      console.error(`[${new Date().toISOString()}] pass failed:`, (error as Error).message);
    }
  };

  const serialPass = singleFlight(pass);
  await serialPass();
  setInterval(() => void serialPass(), intervalSeconds * 1000);
}

void main().catch((error) => {
  console.error("agent watcher failed to start:", error);
  process.exit(1);
});
