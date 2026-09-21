import assert from "node:assert/strict";
import { test } from "node:test";
import { buildAgentNoteEvent, buildCivicTopicPromotionEvent, buildNoteEvent, deriveAgentIdentity, verifyEvent } from "@netizen-labs/nostr";
import { createPublicDiscussionContextReader, publicDiscussionContextConfig, readPublicFollowUpContext } from "../src/public-discussion-context";
import { createPublicMecky, createStadtstackPublicEvidenceRetriever } from "../src/public-mecky";
import { prepareDiscussionCorrection, publishDiscussionCorrection } from "../src/discussion-correction";

const agent = deriveAgentIdentity("test-discussion-context-agent-secret-2026-09", "example", "mecky");
const citizen = new Uint8Array(32).fill(45), municipalityId = "example-town";
const source = buildNoteEvent(citizen, "@Mecky Begegnungsort prüfen", { createdAt: 100,
  tags: [["p", agent.publicKey], ["source-app-post", "735187dc-d737-4e6c-bdd9-fe0792fec498"]] });
const root = buildCivicTopicPromotionEvent(citizen, { sourcePost: source, municipalityId,
  topicId: `urn:stadtstack:topic:municipality:${municipalityId}:begegnungsort`, topicTitle: "Begegnungsort",
  agentPubkey: agent.publicKey, content: "Die frühere B198-Antwort passt nicht. Testannahmen: A kostet 16600 Euro, B 34500 Euro. @Mecky, welche Fragen sind offen?",
  conversationSource: { kind: "selected_conversation", sourceAppPostId: "735187dc-d737-4e6c-bdd9-fe0792fec498",
    mentionEventId: source.id, replyEventId: "a".repeat(64) }, createdAt: 101 });
const prior = buildAgentNoteEvent(agent, "Veraltete Antwort", { createdAt: 102,
  tags: [["e", root.id, "", "reply"], ["p", root.pubkey], ["mecky-receipt", `urn:stadtstack:mecky-answer:${"a".repeat(64)}`], ["municipality", municipalityId],
    ["topic", `urn:stadtstack:topic:municipality:${municipalityId}:begegnungsort`]] });
const projection = { schemaVersion: "roebel_staging_argument_thread_v1", authorityBinding: "none",
  rootEvent: root, mecky: { event: prior }, suggestion: null, caseBinding: null,
  events: { ignored: "Other participants did not grant direct-mention consent." } };
const options = { baseUrl: "http://web.preview.svc.cluster.local:8080", publicOrigin: "https://app.example.org",
  municipalityId, agentPubkey: agent.publicKey };

test("a signed feed follow-up reads the selected discussion afresh without changing its reply destination", async () => {
  const question = buildNoteEvent(citizen, `@Mecky Was sagt Finanzen?\n\nDiskussion: ${options.publicOrigin}/app/diskussion/${root.id}#citizen-brief`, {
    createdAt: 104, tags: [["p", agent.publicKey], ["source-app-post", "735187dc-d737-4e6c-bdd9-fe0792fec498"]],
  });
  let reads = 0;
  const reader = async (id: string) => { reads++; return read()(id); };
  assert.equal((await readPublicFollowUpContext(question, options.publicOrigin, reader))?.rootEvent.id, root.id);
  assert.equal((await readPublicFollowUpContext(question, options.publicOrigin, reader))?.evidence.eventId, root.id);
  assert.equal(reads, 2);
  assert.equal(question.tags.find(tag => tag[0] === "source-app-post")?.[1], "735187dc-d737-4e6c-bdd9-fe0792fec498");
  await assert.rejects(readPublicFollowUpContext(question, options.publicOrigin, async () => { throw Error("source unavailable"); }), /unavailable/);
});

test("follow-up links cannot fetch arbitrary origins or bind a different feed post", async () => {
  const sign = (url: string, post = "735187dc-d737-4e6c-bdd9-fe0792fec498") => buildNoteEvent(citizen, `@Mecky Meine Frage\n\nDiskussion: ${url}`, {
    createdAt: 104, tags: [["p", agent.publicKey], ["source-app-post", post]],
  });
  const path = `/app/diskussion/${root.id}`;
  for (const url of [`https://foreign.example${path}`, `${options.publicOrigin}${path}?target=other`,
    `${options.publicOrigin}${path}#other`, `${options.publicOrigin}/app/diskussion/invalid`]) {
    await assert.rejects(readPublicFollowUpContext(sign(url), options.publicOrigin, async () => { assert.fail("must not fetch"); }), /reference_invalid/);
  }
  const question = sign(options.publicOrigin + path);
  await assert.rejects(readPublicFollowUpContext({ ...question, content: question.content.replace("Meine", "Andere") }, options.publicOrigin, read()), /reference_invalid/);
  await assert.rejects(readPublicFollowUpContext(sign(options.publicOrigin + path, "b".repeat(64)), options.publicOrigin, read()), /post_mismatch/);
  assert.equal(await readPublicFollowUpContext(source, options.publicOrigin, async () => { assert.fail("ordinary mentions keep their own context"); }), null);
});
const read = (value: unknown = projection) => createPublicDiscussionContextReader({ ...options,
  fetch: async (url, init) => {
    assert.equal(url, `${options.baseUrl}/api/civic/v1/discussions/${root.id}`);
    assert.equal(init?.method, "GET"); assert.equal(init?.credentials, "omit"); assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    return Response.json(value);
  } });

test("the exact public signed discussion reaches inference as community context without unrelated records", async () => {
  const context = await read()(root.id);
  assert.equal(context.evidence.eventUrl, `https://app.example.org/app/diskussion/${root.id}`);
  assert.equal(context.evidence.authority, "community_statement");
  assert.equal(context.evidence.summary, root.content);
  let inferred = false, unrelatedReads = 0;
  const mecky = createPublicMecky({
    retrieveEvidence: createStadtstackPublicEvidenceRetriever({ baseUrl: "https://cases.example.org", municipalityId,
      reviewedSourceKinds: ["local_news", "ratsinformation"], reviewedKnowledgeBaseUrl: "https://records.example.org",
      loadReviewedCases: async () => { unrelatedReads += 1; throw Error("An unrelated Case must not be fetched for this discussion"); },
      reviewedSourceFetch: async () => { unrelatedReads += 1; throw Error("Keyword overlap must not fetch unrelated records"); } }),
    infer: async ({ evidence }) => {
      inferred = true;
      assert.equal(evidence.length, 1);
      assert.deepEqual(evidence.map(item => item.evidenceId), [`sha256:${root.id}`]);
      assert.equal((evidence[0] as { authority: string }).authority, "community_statement");
      return { claims: [{ text: "Der Beitrag nennt zwei simulierte Kostenmodelle; amtliche Prüfungen liegen damit nicht vor.", evidenceIds: [`sha256:${root.id}`] }] };
    },
  });
  const result = await mecky.answerMention({ municipalityId, discussionId: root.id, question: root.content,
    conversationEvidence: [context.evidence], now: "2026-09-17T10:00:00.000Z" });
  assert.equal(inferred, true); assert.equal(unrelatedReads, 0); assert.equal(result.status, "answered");
  if (result.status === "answered") assert.deepEqual(result.evidenceRefs.map(item => item.publicCaseUrl), [context.evidence.eventUrl]);
  const unavailable = await mecky.answerMention({ municipalityId, discussionId: root.id, question: root.content,
    now: "2026-09-17T10:00:00.000Z" });
  assert.equal(unavailable.status, "refused");
});

test("a different signed follow-up question reaches the real answer engine with only its verified root", async () => {
  const question = buildNoteEvent(citizen, `@Mecky Wie unterscheiden sich die Kostenmodelle?\n\nDiskussion: ${options.publicOrigin}/app/diskussion/${root.id}#citizen-brief`, {
    createdAt: 104, tags: [["p", agent.publicKey], ["source-app-post", "735187dc-d737-4e6c-bdd9-fe0792fec498"]],
  });
  const context = await readPublicFollowUpContext(question, options.publicOrigin, read());
  assert.ok(context);
  const mecky = createPublicMecky({
    retrieveEvidence: createStadtstackPublicEvidenceRetriever({
      baseUrl: "https://cases.example.org", municipalityId,
      loadReviewedCases: async () => { assert.fail("A scoped follow-up cannot search unrelated cases"); },
    }),
    infer: async ({ question: asked, evidence }) => {
      assert.equal(asked, question.content);
      assert.deepEqual(evidence.map(item => item.evidenceId), [`sha256:${root.id}`]);
      return { claims: [{ text: "Der Beitrag nennt für A 16600 Euro und für B 34500 Euro.", evidenceIds: [`sha256:${root.id}`] }] };
    },
  });
  const mention = { municipalityId, discussionId: root.id, question: question.content,
    discussionContext: context, now: "2026-09-21T12:00:00.000Z" };
  const answer = await mecky.answerMention(mention);
  assert.equal(answer.status, "answered");
  if (answer.status === "answered") {
    assert.match(answer.content, /16600.*34500/u);
    assert.equal(answer.evidenceRefs[0].publicCaseUrl, context.evidence.eventUrl);
  }
  await assert.rejects(mecky.answerMention({ ...mention, discussionContext: undefined,
    conversationEvidence: [context.evidence] }), /Invalid Public Mecky mention/u);
  for (const invalid of [
    { ...mention, discussionId: "f".repeat(64) },
    { ...mention, municipalityId: "other-town" },
    { ...mention, discussionContext: { ...context, rootEvent: { ...root, content: "forged" } } },
    { ...mention, discussionContext: { ...context, evidence: { ...context.evidence, summary: question.content } } },
  ]) await assert.rejects(mecky.answerMention(invalid), /Invalid Public Mecky mention/u);
});

test("missing, forged, cross-municipality and unconsented public notes cannot become evidence", async () => {
  for (const value of [null, { ...projection, rootEvent: null },
    { ...projection, rootEvent: { ...root, content: "tampered" } },
    { ...projection, rootEvent: source }, { ...projection, authorityBinding: "official" }]) {
    await assert.rejects(read(value)(root.id));
  }
  await assert.rejects(createPublicDiscussionContextReader({ ...options, municipalityId: "another-city",
    fetch: async () => Response.json(projection) })(root.id));
  const otherRoot = buildNoteEvent(citizen, "No consent", { createdAt: 101,
    tags: root.tags.filter(tag => tag[0] !== "p") });
  await assert.rejects(createPublicDiscussionContextReader({ ...options,
    fetch: async () => Response.json({ ...projection, rootEvent: otherRoot }) })(otherRoot.id));
});

test("the public reader rejects unsafe configuration, redirects, invalid types and streamed oversize bodies", async () => {
  assert.equal(publicDiscussionContextConfig({}), undefined);
  assert.throws(() => publicDiscussionContextConfig({ MECKY_PUBLIC_APP_BASE_URL: options.baseUrl }));
  for (const baseUrl of ["http://127.0.0.1", "https://host.example/path", "https://user:password@host.example", "https://host.example?target=other"]) {
    assert.throws(() => createPublicDiscussionContextReader({ ...options, baseUrl }));
  }
  assert.throws(() => createPublicDiscussionContextReader({ ...options, publicOrigin: "http://host.example" }));
  for (const response of [new Response("{}", { headers: { "content-type": "text/plain" } }),
    new Response("x", { status: 302 }),
    new Response("x".repeat(512_001), { headers: { "content-type": "application/json" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-length": "512001" } })]) {
    await assert.rejects(createPublicDiscussionContextReader({ ...options, fetch: async () => response })(root.id));
  }
});

test("one explicit correction signs actual inference and refuses changed, adopted or unsupported answers", async () => {
  const context = await read()(root.id), before = JSON.stringify(context);
  const input = { context, previousAnswerId: prior.id, agent, municipalityId, sourceCaseId: "unused",
    canonicalCaseId: "unused", now: 103,
    publicMecky: { answerMention: async () => ({ status: "answered" as const, content: "KI-Zusammenfassung: Das sind Testannahmen.",
      evidenceRefs: [{ evidenceId: context.evidence.evidenceId, title: "Diskussion", publicCaseUrl: context.evidence.eventUrl }] }) } };
  const correction = await prepareDiscussionCorrection(input);
  assert(verifyEvent(correction)); assert.equal(correction.pubkey, agent.publicKey);
  assert.match(correction.content, /^KI-Korrektur:/); assert.match(correction.content, /Das sind Testannahmen/);
  assert.equal(JSON.stringify(context), before);
  assert(correction.tags.some(tag => tag[0] === "evidence" && tag[1] === `sha256:${root.id}`));
  for (const invalid of [{ ...input, previousAnswerId: "b".repeat(64) },
    { ...input, context: { ...context, hasSuggestionOrCase: true } },
    { ...input, now: prior.created_at },
    { ...input, publicMecky: { answerMention: async () => ({ status: "answered" as const, content: "Unrelated", evidenceRefs: [] }) } }]) {
    await assert.rejects(prepareDiscussionCorrection(invalid));
  }
});

test("a stale public projection cannot duplicate a correction and a proposal appearing during inference blocks publication", async () => {
  const context = await read()(root.id), events = [prior], prepared: string[] = [];
  let inferred = 0, reads = 0, admissionDuringInference = false;
  const input = { discussionId: root.id, previousAnswerId: prior.id, agent, municipalityId, sourceCaseId: "unused",
    canonicalCaseId: "unused", now: 103,
    readContext: async () => ({ ...context, hasSuggestionOrCase: admissionDuringInference && ++reads > 1 }),
    relay: {
      query: async () => events,
      publish: async (event: typeof prior) => { assert(prepared.includes(event.id)); events.push(event); return { ok: true }; },
    },
    recordPrepared: async (event: typeof prior) => { prepared.push(event.id); },
    publicMecky: { answerMention: async () => { inferred++; return { status: "answered" as const, content: "KI-Zusammenfassung: Zwei Testvarianten.",
      evidenceRefs: [{ evidenceId: context.evidence.evidenceId, title: "Diskussion", publicCaseUrl: context.evidence.eventUrl }] }; } },
  };
  const correction = await publishDiscussionCorrection(input);
  assert.equal(events.length, 2); assert.equal(events[0], prior); assert.equal(events[1]?.id, correction.id);
  await assert.rejects(publishDiscussionCorrection(input), /relay_changed/);
  assert.equal(events.length, 2); assert.equal(inferred, 1);
  events.splice(1); prepared.length = 0; admissionDuringInference = true; reads = 0;
  await assert.rejects(publishDiscussionCorrection(input), /correction_changed/);
  assert.equal(events.length, 1); assert.equal(prepared.length, 0);
});
