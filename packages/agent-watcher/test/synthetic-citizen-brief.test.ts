import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSyntheticBriefEvidenceAdapter, syntheticBriefConfig } from "../src/synthetic-citizen-brief";
import { createPublicKnowledgeCatalog, parsePublicEvidence } from "../src/public-evidence";
import { createPublicMecky } from "../src/public-mecky";
import { createPublicMeckyEvidenceReply } from "../src/public-mecky-receipt";
import type { PublicDiscussionContext } from "../src/public-discussion-context";

const { returned } = JSON.parse(readFileSync(new URL("../../stadtstack-federation-client/src/fixtures/synthetic-citizen-brief-return-v1.json", import.meta.url), "utf8"));
const config = { environment: "staging" as const, publicOrigin: "https://app.example", caseId: returned.caseId,
  topicId: returned.topicId, discussionId: returned.discussionId };
const query = { municipalityId: returned.municipalityId, discussionId: returned.discussionId,
  now: "2026-09-14T10:00:00.000Z", question: "Synthetic assessment for planning and traffic?" };

test("Mecky cites the current coordinator Brief with synthetic authority and no write capability", async () => {
  const calls: RequestInit[] = [];
  const adapter = createSyntheticBriefEvidenceAdapter(config, async (_url, init) => { calls.push(init!); return Response.json(returned); });
  const records = await adapter.load(query);
  assert.equal(records.length, 8);
  for (const record of records) {
    const evidence = parsePublicEvidence(record); assert.equal(evidence.authority, "synthetic_demo");
    assert.throws(() => parsePublicEvidence({ ...evidence, authority: "official_record" }));
  }
  const catalog = createPublicKnowledgeCatalog([adapter]);
  const mecky = createPublicMecky({ retrieveEvidence: q => catalog.retrieve(q), infer: async input => {
    assert.ok(input.evidence.length > 0);
    assert.ok(input.evidence.every(e => "authority" in e && e.authority === "synthetic_demo"));
    return { claims: [{ text: "Für die Querung werden zwei Verkehrsoptionen verglichen.", evidenceIds: [input.evidence[0]!.evidenceId] }] };
  } });
  const answer = await mecky.answerMention(query);
  assert.equal(answer.status, "answered");
  if (answer.status !== "answered") throw Error("answer missing");
  assert.ok(answer.content.startsWith("KI-Zusammenfassung: Für die Querung werden zwei Verkehrsoptionen verglichen."));
  assert.ok(!answer.content.includes("Synthetischer Testkontext"));
  assert.equal(answer.evidenceRefs[0]!.publicCaseUrl, `${config.publicOrigin}/app/diskussion/${config.discussionId}`);
  const feedReply = createPublicMeckyEvidenceReply(answer);
  assert.equal(feedReply.content, answer.content);
  assert.deepEqual(feedReply.tags, answer.evidenceRefs.map(e => ["evidence", e.evidenceId, e.publicCaseUrl]));
  assert.ok(feedReply.tags.every(tag => tag[0] === "evidence"));
  assert.ok(calls.every(c => c.method === "GET" && c.credentials === "omit" && !c.body));
  await assert.rejects(adapter.load({ ...query, municipalityId: "other-city" }));
});

test("withdrawal and source outage supply no old synthetic passages", async () => {
  const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === "object"
    ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
  const { returnChecksum: _, ...base } = returned;
  const body = { ...base, status: "withdrawn", brief: null };
  const withdrawn = { ...body, returnChecksum: `sha256:${createHash("sha256").update(JSON.stringify(canonical(body))).digest("hex")}` };
  let value = returned;
  const adapter = createSyntheticBriefEvidenceAdapter(config, async () => Response.json(value));
  assert.equal((await adapter.load(query)).length, 8);
  value = withdrawn; assert.deepEqual(await adapter.load(query), []);
  value = { error: "private-canary" };
  const packet = await createPublicKnowledgeCatalog([adapter]).retrieve(query);
  assert.equal(packet.passages.length, 0); assert.ok(!JSON.stringify(packet).includes("private-canary"));
});

test("synthetic evidence needs the explicit deployment opt-in", () => {
  assert.equal(syntheticBriefConfig({}), undefined);
  const raw = JSON.stringify(config);
  assert.throws(() => syntheticBriefConfig({ MECKY_SYNTHETIC_BRIEF_CONFIG: raw }));
  assert.throws(() => syntheticBriefConfig({ MECKY_ALLOW_SYNTHETIC_BRIEF: "true", MECKY_SYNTHETIC_BRIEF_CONFIG: JSON.stringify({ ...config, environment: "production" }) }));
  assert.deepEqual(syntheticBriefConfig({ MECKY_ALLOW_SYNTHETIC_BRIEF: "true", MECKY_SYNTHETIC_BRIEF_CONFIG: raw }), config);
});

test("a named topic resolves its Brief through the verified discussion title without a pasted ID", async () => {
  // This seam supplies the result of the separately tested signature-verifying reader.
  const context = { rootEvent: { id: config.discussionId, content: "A correction mentions an unrelated playground.",
    tags: [["municipality", returned.municipalityId], ["topic", config.topicId], ["topic-title", "Schulweg am Niederwall"]] } } as PublicDiscussionContext;
  let reads = 0;
  const adapter = createSyntheticBriefEvidenceAdapter(config, async () => Response.json(returned), async id => {
    assert.equal(id, config.discussionId); reads++; return context;
  });
  const { discussionId: _, ...general } = query;
  const records = await adapter.load({ ...general, question: "Was sagen die Fachbereiche Verkehr und Finanzen zum Niederwall?" });
  assert.equal(reads, 1);
  assert.deepEqual(records.map(record => parsePublicEvidence(record).title.split(" · ")[0]).sort(), ["Fachantwort Finanzen", "Fachantwort Verkehr"]);
  assert.deepEqual(await adapter.load({ ...general, question: "What is happening at the playground?" }), []);
  assert.deepEqual(await adapter.load({ ...general, discussionId: "a".repeat(64), question: "Niederwall" }), []);
});

test("title lookup cannot substitute another topic, municipality or discussion", async () => {
  const { discussionId: _, ...general } = query;
  for (const mismatch of ["discussion", "municipality", "topic", "duplicate-title"]) {
    const rootEvent = { id: mismatch === "discussion" ? "b".repeat(64) : config.discussionId,
      tags: [["municipality", mismatch === "municipality" ? "other-city" : returned.municipalityId],
        ["topic", mismatch === "topic" ? config.topicId + "-other" : config.topicId], ["topic-title", "Niederwall"],
        ...(mismatch === "duplicate-title" ? [["topic-title", "Niederwall"]] : [])] };
    const adapter = createSyntheticBriefEvidenceAdapter(config, async () => Response.json(returned),
      async () => ({ rootEvent } as PublicDiscussionContext));
    assert.deepEqual(await adapter.load({ ...general, question: "Was sagt Verkehr zum Niederwall?" }), [], mismatch);
  }
});

test("staging uses the existing Web service while citations retain the public origin", async () => {
  const adapter = createSyntheticBriefEvidenceAdapter({ ...config, transport: "staging_web_service" }, async (url, init) => {
    assert.equal(String(url), `http://roebel-web-presentation.stadtstack-roebel-web-preview.svc.cluster.local:8080/api/stadtstack/synthetic-citizen-brief/by-discussion/${config.discussionId}`);
    assert.equal(init?.redirect, "error");
    assert.equal(init?.credentials, "omit");
    assert.deepEqual(init?.headers, { accept: "application/json" });
    return Response.json(returned);
  });
  const records = await adapter.load(query);
  assert.equal(records.length, 8);
  for (const record of records) {
    const evidence = parsePublicEvidence(record);
    if (evidence.sourceKind !== "synthetic_citizen_brief") throw Error("unexpected evidence source");
    assert.equal(evidence.caseUrl, `${config.publicOrigin}/app/diskussion/${config.discussionId}`);
    assert.ok(!JSON.stringify(record).includes("svc.cluster.local"));
  }
});

test("the staging transport does not accept a caller-selected network destination", () => {
  for (const extra of [{ transport: "http://other-service:8080" }, { transport: null },
    { transport: "staging_web_service", readOrigin: "http://other-service:8080" }]) {
    assert.throws(() => syntheticBriefConfig({ MECKY_ALLOW_SYNTHETIC_BRIEF: "true",
      MECKY_SYNTHETIC_BRIEF_CONFIG: JSON.stringify({ ...config, ...extra }) }), /synthetic_brief_configuration_invalid/);
  }
});

test("German department questions select that department before incidental mentions elsewhere", async () => {
  const catalog = createPublicKnowledgeCatalog([createSyntheticBriefEvidenceAdapter(config, async () => Response.json(returned))]);
  for (const name of ["Verkehr", "Stadtplanung", "Finanzen", "Umwelt", "Recht", "Soziales", "Technische Dienste", "Öffentliche Ordnung"]) {
    const packet = await catalog.retrieve({ ...query, question: `Was sagt ${name} im synthetischen Test?` });
    assert.equal(packet.passages.length, 1);
    assert.match(packet.passages[0]!.evidence.title, new RegExp(`Fachantwort ${name} ·`));
  }
});

test("explicit department questions exclude incidental mentions and retain requested comparisons", async () => {
  const adapter = createSyntheticBriefEvidenceAdapter(config, async () => Response.json(returned));
  const catalog = createPublicKnowledgeCatalog([adapter]);
  for (const question of [
    "@Mecky, welche nächsten Prüfschritte nennt die bestätigte Fachantwort Verkehr zu diesem B-198-Testfall? Bitte verlinke die gemeinsame Kurzfassung aus dem Town Workspace.",
    "Was steht in der Antwort des Fachbereichs Verkehr?", "Was sagen die Fachbereiche Verkehr?",
  ]) {
    const packet = await catalog.retrieve({ ...query, question });
    assert.equal(packet.passages.length, 1);
    assert.match(packet.passages[0]!.evidence.title, /^Fachantwort Verkehr ·/);
  }
  const comparison = await adapter.load({ ...query, question: "Vergleiche die Fachantworten von Verkehr und Finanzen." });
  assert.deepEqual(comparison.map(e => parsePublicEvidence(e).title.split(" · ")[0]).sort(), ["Fachantwort Finanzen", "Fachantwort Verkehr"]);
  assert.equal((await adapter.load({ ...query, question: "Wie können wir Verkehr und Kosten der Querung verbessern?" })).length, 8);
  assert.equal((await adapter.load({ ...query, question: "Was sagt Verkehrsplanung?" })).length, 8);
});

test("Mecky reads only the selected discussion and never substitutes another Case", async () => {
  const binding = { caseId: config.caseId, discussionId: config.discussionId, topicId: config.topicId };
  const multiple = { ...config, caseId: config.caseId.replace(/.$/, config.caseId.endsWith("0") ? "1" : "0"),
    discussionId: "b".repeat(64), additionalBindings: [binding] };
  const urls: string[] = [];
  const adapter = createSyntheticBriefEvidenceAdapter(multiple, async (url, init) => {
    urls.push(String(url)); assert.equal(init?.method, "GET"); assert.equal(init?.credentials, "omit");
    return String(url).endsWith(config.discussionId) ? Response.json(returned) : new Response(null, { status: 503 });
  });
  const packet = await createPublicKnowledgeCatalog([adapter]).retrieve({ ...query, question: "Was sagt Verkehr im synthetischen Test?" });
  assert.deepEqual(urls, [`${config.publicOrigin}/api/stadtstack/synthetic-citizen-brief/by-discussion/${config.discussionId}`]);
  assert.equal(packet.passages.length, 1);
  const evidence = packet.passages[0]!.evidence;
  assert.equal(evidence.sourceKind, "synthetic_citizen_brief");
  if (evidence.sourceKind !== "synthetic_citizen_brief") throw Error();
  assert.equal(evidence.caseId, config.caseId);
  assert.equal(evidence.caseUrl, `${config.publicOrigin}/app/diskussion/${config.discussionId}`);
  assert.equal(evidence.briefChecksum, returned.brief.briefChecksum);
  for (const additionalBindings of [[binding, binding], [{ ...binding, caseId: multiple.caseId }],
    [{ ...binding, discussionId: multiple.discussionId }], [{ ...binding, publicOrigin: "https://foreign.example" }],
    [{ ...binding, caseId: binding.caseId.replace(returned.municipalityId, "other-city") }], null]) {
    assert.throws(() => createSyntheticBriefEvidenceAdapter({ ...multiple, additionalBindings } as never), /configuration_invalid/);
  }
});

test("an unrelated meeting-place question cannot borrow traffic department answers", async () => {
  const adapter = createSyntheticBriefEvidenceAdapter(config, async () => Response.json(returned));
  const { discussionId: _, ...unscoped } = query;
  const question = "Testablauf: Begegnungsort nach dem Vorbild des Kugellagers · @Mecky: Welche Fragen sollten die Fachpakete für diesen Testvergleich beantworten? Bitte trenne die dokumentierte Empfehlung von unseren Annahmen.";
  const catalog = createPublicKnowledgeCatalog([adapter]);
  const result = await createPublicMecky({retrieveEvidence:q=>catalog.retrieve(q),infer:async()=>{
    assert.fail("Unrelated Brief must never reach inference");
  }}).answerMention({...unscoped,question});
  assert.equal(result.status,"refused");
  if(result.status!=="refused")throw Error();
  assert.equal(result.reason,"insufficient_evidence");
  assert.deepEqual(await adapter.load({...unscoped,question:"Was sagen die Fachbereiche Verkehr und Finanzen zu diesem neuen Treffpunkt?"}),[]);
  assert.equal((await adapter.load({...unscoped,question:"What does the road-safety review say?"})).length,8);
  assert.equal((await adapter.load({...unscoped,question:`Was sagt Verkehr? ${config.publicOrigin}/app/diskussion/${config.discussionId}`})).length,1);
});

test("a new discussion cannot fall back to the only deployed Brief even when traffic is mentioned", async () => {
  let reads=0;
  const adapter=createSyntheticBriefEvidenceAdapter(config,async()=>{reads++;return Response.json(returned);});
  const catalog=createPublicKnowledgeCatalog([adapter]);
  const answer=await createPublicMecky({retrieveEvidence:q=>catalog.retrieve(q),infer:async()=>{
    assert.fail("Unknown discussion must not receive another Case's response");
  }}).answerMention({...query,discussionId:"c".repeat(64),question:"What does the road-safety review say?"});
  assert.equal(answer.status,"refused");assert.equal(reads,0);
  for(const discussionId of ["", "https://foreign.example", "c".repeat(63)]) {
    await assert.rejects(catalog.retrieve({...query,discussionId}),/Invalid public evidence query/);
  }
});
