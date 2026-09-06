import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import { verifyParticipantTopicSuggestionForAdoption } from "@netizen-labs/nostr";
import { verifyPublicCaseBindingReceipt } from "../src/lib/stadtstack/public-case-binding-receipt-contract";
import { fetchVerifiedPublicCaseBindingReceipt } from "../src/lib/stadtstack/public-case-binding-receipt-transport";
import { respondPublicCaseBindingRequest } from "../src/lib/stadtstack/public-case-binding-bff";
import {
  isMunicipalCaseBindingReceipt,
  loadVerifiedPublicCaseBindingReceipt,
} from "../src/lib/stadtstack/public-case-binding-receipt-client";
import {
  bindPublicCaseReceiptToProposal,
  bindPublicSyntheticCaseReceiptToProposal,
  projectPublicCitizenAdoptionEvidence,
} from "../src/lib/stadtstack/proposal-signature";
import { loadPublicSyntheticCitizenAdoption } from "../src/lib/staging-participant/synthetic-citizen-adoption";
import {
  projectPublicCivicTopicJourney,
  type PublicCivicTopicDetail,
} from "../src/lib/stadtstack/civic-topic-detail";

// Public, synthetic wire data and an actual neutral writer receipt. No live account data.
const fixture = JSON.parse(
  readFileSync(
    new URL("./fixtures/synthetic-case-binding-v1.json", import.meta.url),
    "utf8"
  )
);
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});
function suggestion() {
  const event = fixture.participantSuggestionEvent;
  return verifyParticipantTopicSuggestionForAdoption({
    schemaVersion: "staging_participant_signed_topic_suggestion_v1",
    suggestionId: event.id,
    candidateId: `urn:stadtstack:participant-topic-suggestion:${event.id}`,
    signerPubkey: event.pubkey,
    event,
    draft: JSON.parse(event.content),
    verification: { kind: "nostr_nip01", verified: true },
    entryState: "citizen_adoption_required",
    authorityBinding: "none",
    submittedToCivicWorkflow: false,
  });
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
function rechecksum(value: Record<string, unknown>) {
  const { receiptChecksum, ...core } = value;
  return {
    ...core,
    receiptChecksum: `sha256:${createHash("sha256").update(canonical(core)).digest("hex")}`,
  };
}
function response(value: Record<string, unknown>) {
  return Response.json(value, {
    headers: { "x-stadtstack-receipt-sha256": String(value.receiptChecksum) },
  });
}
async function savedProjection() {
  globalThis.fetch = async (url, init) => {
    assert.equal(
      url,
      `/api/staging-participant/v1/synthetic-citizen-adoption/by-suggestion/${fixture.participantSuggestionEvent.id}/adopter/${fixture.projection.proofEvent.pubkey}`
    );
    assert.equal(init?.method, "GET");
    assert.equal(init?.body, undefined);
    return Response.json(fixture.projection);
  };
  const projection = await loadPublicSyntheticCitizenAdoption(
    fixture.participantSuggestionEvent.id,
    fixture.projection.proofEvent.pubkey
  );
  assert.ok(projection);
  return projection;
}

test("neutral test admission crosses the credential-free transport, BFF and browser with its original preview intact", async () => {
  const before = JSON.stringify(fixture);
  const rootEventId = fixture.receipt.rootEventId;
  const loaded = await loadVerifiedPublicCaseBindingReceipt(
    rootEventId,
    async (url, init) => {
      assert.equal(
        url,
        `/api/stadtstack/case-bindings/by-discussion/${rootEventId}`
      );
      assert.equal(init?.method, "GET");
      const bff = await respondPublicCaseBindingRequest({
        method: "GET",
        rootEventId,
        read: (id) =>
          fetchVerifiedPublicCaseBindingReceipt(id, {
            origin: "https://public.example.test",
            fetchImpl: async (upstream, options) => {
              assert.equal(
                String(upstream),
                `https://public.example.test/v1/public/case-bindings/by-discussion/${rootEventId}`
              );
              assert.equal(options?.credentials, "omit");
              assert.equal(options?.redirect, "error");
              assert.equal(options?.headers, undefined);
              return response(fixture.receipt);
            },
          }),
      });
      return Response.json(bff.body, {
        status: bff.status,
        headers: bff.headers,
      });
    }
  );
  assert.equal(
    loaded?.schemaVersion,
    "public_synthetic_case_binding_receipt_v1"
  );
  const projection = await savedProjection();
  const bound = bindPublicSyntheticCaseReceiptToProposal({
    suggestion: suggestion(),
    receipt: loaded,
    projection,
  });
  assert.deepEqual(bound, fixture.receipt);
  assert.equal(bound?.syntheticCaseCreated, true);
  assert.equal(bound?.civicCaseCreated, false);
  assert.equal(projection.submittedToCivicWorkflow, false);
  assert.equal(projection.civicCaseCreated, false);
  assert.equal(JSON.stringify(fixture), before);
});

test("neither browser nor server accepts relabelling, an eligibility claim or civic effects even with a new checksum", async () => {
  for (const change of [
    { environment: "production" },
    { testOnly: false },
    { civicCaseCreated: true },
    { syntheticCaseCreated: false },
    { candidateKind: "eligible_citizen_adopted_topic_suggestion_v1" },
    { schemaVersion: "public_case_binding_receipt_v2" },
    { caseId: fixture.receipt.caseId.replace(":synthetic-case:", ":case:") },
    {
      topicId: fixture.receipt.topicId.replace(
        ":example-city:",
        ":other-town:"
      ),
    },
    {
      eligibilityReceiptId: `urn:stadtstack:municipal-civic-eligibility-receipt:${"a".repeat(64)}`,
    },
    { caseEventIds: [...fixture.receipt.caseEventIds].reverse() },
    ...[
      "bindingVote",
      "councilDecision",
      "openDeskWrite",
      "treasuryEffect",
      "paymentEffect",
      "administrativeEndorsement",
    ].map((key) => ({ [key]: true })),
  ]) {
    const value = rechecksum({ ...fixture.receipt, ...change });
    assert.throws(
      () => verifyPublicCaseBindingReceipt(value),
      JSON.stringify(change)
    );
    await assert.rejects(
      loadVerifiedPublicCaseBindingReceipt(
        fixture.receipt.rootEventId,
        async () => response(value)
      ),
      JSON.stringify(change)
    );
  }
  assert.throws(() =>
    verifyPublicCaseBindingReceipt({
      ...fixture.receipt,
      receiptChecksum: `sha256:${"0".repeat(64)}`,
    })
  );
  const bad = await respondPublicCaseBindingRequest({
    method: "GET",
    rootEventId: fixture.receipt.rootEventId,
    read: async () => ({ ...fixture.receipt, testOnly: false }),
  });
  assert.equal(bad.status, 503);
  assert.deepEqual(bad.body, { error: "service_unavailable" });
});

test("a test Case must match every saved suggestion, proof, source and acceptance binding", async () => {
  const projection = await savedProjection();
  const receipt = verifyPublicCaseBindingReceipt(fixture.receipt);
  const input = { suggestion: suggestion(), receipt, projection };
  assert.equal(
    bindPublicSyntheticCaseReceiptToProposal({ ...input, projection: null }),
    null
  );
  for (const key of [
    "rootEventId",
    "topicId",
    "participantSuggestionEventId",
    "sourceAnswerEventId",
    "sourceAnswerReceiptId",
    "candidateId",
    "candidateEventId",
    "adopterPubkey",
    "testPolicyVersion",
    "adoptionAcceptanceReceiptChecksum",
  ] as const) {
    assert.equal(
      bindPublicSyntheticCaseReceiptToProposal({
        ...input,
        receipt: { ...receipt, [key]: `changed-${key}` },
      }),
      null,
      key
    );
  }
  for (const key of [
    "sourceDiscussionId",
    "sourceAnswerReceiptId",
    "municipalityId",
    "topicId",
    "participantPubkey",
    "title",
    "summary",
  ] as const) {
    assert.equal(
      bindPublicSyntheticCaseReceiptToProposal({
        ...input,
        projection: {
          ...projection,
          tracer: { ...projection.tracer, [key]: `changed-${key}` },
        },
      }),
      null,
      key
    );
  }
});

test("saved test projection rejects altered tracer and ledger checksums before it can be bound", async () => {
  for (const mutate of [
    (value: typeof fixture.projection) => {
      value.tracer.title += " changed";
    },
    (value: typeof fixture.projection) => {
      value.acceptanceReceipt.policyVersion = "other-policy";
    },
    (value: typeof fixture.projection) => {
      value.acceptanceReceipt.receiptChecksum = "0".repeat(64);
    },
    (value: typeof fixture.projection) => {
      value.acceptanceReceipt.adopterPubkey = "0".repeat(64);
    },
  ]) {
    const value = structuredClone(fixture.projection);
    mutate(value);
    globalThis.fetch = async () => Response.json(value);
    await assert.rejects(
      loadPublicSyntheticCitizenAdoption(
        fixture.participantSuggestionEvent.id,
        fixture.projection.proofEvent.pubkey
      ),
      /projection_invalid/u
    );
  }
});

test("test admission cannot advance real proposal, topic, administration or participation even when the proposal is absent", () => {
  const receipt = verifyPublicCaseBindingReceipt(fixture.receipt);
  const participant = suggestion();
  assert.equal(isMunicipalCaseBindingReceipt(receipt), false);
  assert.equal(projectPublicCitizenAdoptionEvidence(receipt), null);
  for (const current of [participant, null]) {
    assert.equal(
      bindPublicCaseReceiptToProposal({
        suggestion: current,
        receipt,
        rootEventId: receipt.rootEventId,
        topicId: receipt.topicId,
      }),
      null
    );
  }
  // Only the existing public journey input fields are relevant to this projector.
  const detail = {
    topic: {
      topicId: receipt.topicId,
      sourcePostIds: ["source"],
      discussions: [
        {
          id: receipt.rootEventId,
          meckyMentioned: true,
          meckyAnswered: true,
          suggestionSigned: true,
        },
      ],
    },
  } as PublicCivicTopicDetail;
  const journey = projectPublicCivicTopicJourney(
    detail,
    { caseId: receipt.caseId, status: "brief_current" },
    receipt
  );
  assert.equal(journey?.currentStageId, "adoption");
  for (const id of [
    "case",
    "administration",
    "participation",
    "decision",
    "execution",
  ]) {
    assert.equal(
      journey?.stages.find((stage) => stage.id === id)?.state,
      "gated",
      id
    );
  }
});
