import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSyntheticBriefEvidenceAdapter, syntheticBriefConfig } from "../src/synthetic-citizen-brief";
import { createPublicKnowledgeCatalog, parsePublicEvidence } from "../src/public-evidence";
import { createPublicMecky } from "../src/public-mecky";

const { returned } = JSON.parse(readFileSync(new URL("../../stadtstack-federation-client/src/fixtures/synthetic-citizen-brief-return-v1.json", import.meta.url), "utf8"));
const config = { environment: "staging" as const, publicOrigin: "https://app.example", caseId: returned.caseId,
  topicId: returned.topicId, discussionId: returned.discussionId };
const query = { municipalityId: returned.municipalityId, now: "2026-09-14T10:00:00.000Z", question: "Synthetic assessment for planning and traffic?" };

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
    return { answer: "Im synthetischen Test werden die Verkehrsoptionen geprüft; das ist keine amtliche Prüfung.", evidenceIds: [input.evidence[0]!.evidenceId] };
  } });
  const answer = await mecky.answerMention(query);
  assert.equal(answer.status, "answered");
  if (answer.status !== "answered") throw Error("answer missing");
  assert.ok(answer.content.startsWith("Synthetischer Testkontext"));
  assert.ok(answer.evidenceRefs[0]!.publicCaseUrl.includes("/synthetic-citizen-brief/"));
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
