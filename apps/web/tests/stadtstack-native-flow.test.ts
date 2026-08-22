import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const feed = readFileSync(
  new URL("../src/components/app/StadtstackStagingFeed.tsx", import.meta.url),
  "utf8"
);
const civicTopicCard = readFileSync(
  new URL("../src/components/app/CivicTopicActivityCard.tsx", import.meta.url),
  "utf8"
);
const discussion = readFileSync(
  new URL("../src/components/app/StadtstackDiscussion.tsx", import.meta.url),
  "utf8"
);
const appPage = readFileSync(
  new URL("../src/app/app/page.tsx", import.meta.url),
  "utf8"
);
const postCard = readFileSync(
  new URL("../src/components/app/PostCard.tsx", import.meta.url),
  "utf8"
);
const postPromotion = readFileSync(
  new URL("../src/components/app/StadtstackPostPromotion.tsx", import.meta.url),
  "utf8"
);
const proposalsPage = readFileSync(
  new URL("../src/app/app/proposals/page.tsx", import.meta.url),
  "utf8"
);
const advisoryParticipation = readFileSync(
  new URL(
    "../src/components/app/StadtstackAdvisoryParticipation.tsx",
    import.meta.url
  ),
  "utf8"
);
const administrationProgress = readFileSync(
  new URL(
    "../src/components/app/StadtstackAdministrationProgress.tsx",
    import.meta.url
  ),
  "utf8"
);

test("keeps the civic workflow native to ordinary Röbel posts and discussion routes", () => {
  assert.doesNotMatch(appPage, /StadtstackStagingFeed/);
  assert.doesNotMatch(appPage, /StadtstackStagingLabCard/);
  assert.match(postCard, /StadtstackPostPromotion/);
  assert.match(postCard, /mode === "detail" && isAuthor/);
  assert.match(postPromotion, /promoteAppPostToCivicTopic/);
  assert.match(postPromotion, /\/app\/diskussion\//);
  assert.match(postPromotion, /Der ursprüngliche Beitrag bleibt unverändert/);
  assert.match(postPromotion, /Noch kein Vorschlag oder CivicCase/);
  assert.match(discussion, /Argumentbaum/);
  assert.match(discussion, /Sunburst/);
  assert.match(discussion, /@Mecky/);
});

test("keeps synthetic fixtures out while projecting public topic activity into the normal timeline", () => {
  assert.doesNotMatch(appPage, /Staging-Testspur im normalen Feed/);
  assert.doesNotMatch(appPage, /<StadtstackStagingFeed/);
  assert.match(appPage, /loadPublicCivicTopicActivity/);
  assert.match(appPage, /<CivicTopicActivityCard/);
  assert.doesNotMatch(feed, /Diskussion → Mecky → Verbesserungsvorschlag/);
  assert.match(feed, /Staging-Testspur im normalen Feed/);
  assert.match(civicTopicCard, /Bürger-Thema/);
  assert.match(civicTopicCard, /signierte Aktivitäten/);
  assert.match(civicTopicCard, /Mecky hat signiert\s+geantwortet/);
  assert.match(civicTopicCard, /Antwort ausstehend/);
  assert.match(appPage, /fetchFeed\(\)\.catch/);
  assert.match(appPage, /setLoading\(false\)/);
});

test("keeps ordinary posts distinct and requires an explicit human promotion action", () => {
  assert.match(feed, /entryType === "post"/);
  assert.match(feed, /Normaler Beitrag/);
  assert.match(feed, /Signierten Testbeitrag veröffentlichen/);
  assert.match(feed, /stagingPost<[^>]+>\("\/post"/);
  assert.match(feed, /createAdmissionProof/);
  assert.match(feed, /signPublicPost/);
  assert.match(feed, /stagingPost<[^>]+>\("\/signed-event"/);
  assert.match(feed, /Als Thema weiterführen/);
  assert.match(feed, /stagingPost<[^>]+>\("\/promote"/);
  assert.match(feed, /Der ursprüngliche Beitrag bleibt unverändert/);
  assert.match(postPromotion, /Als Bürger-Thema weiterführen/);
  assert.match(postPromotion, /Was soll gemeinsam geklärt werden/);
  assert.match(postPromotion, /Nur du als Autor/);
});

test("lets explicit @Mecky mentions answer inside an ordinary app thread without auto-promotion", () => {
  assert.match(postPromotion, /promoteAppPostToCivicTopic/);
  assert.match(
    readFileSync(
      new URL("../src/components/app/PostComposer.tsx", import.meta.url),
      "utf8"
    ),
    /requestAppMeckyConversationAnswer/
  );
  assert.match(
    readFileSync(
      new URL("../src/components/app/CommentSection.tsx", import.meta.url),
      "utf8"
    ),
    /data-mecky-conversation-reply/
  );
});

test("lets a signed-in citizen publish their own pro or contra argument", () => {
  assert.match(discussion, /useCitizenSession/);
  assert.match(discussion, /createAdmissionProof/);
  assert.match(discussion, /signCivicArgument/);
  assert.match(discussion, /intent: "argument"/);
  assert.match(discussion, /Dein verbundenes Konto/);
  assert.match(discussion, /Signiertes Röbel-Konto/);
});

test("refreshes a pending Mecky mention automatically without polling forever", () => {
  assert.match(discussion, /MECKY_POLL_INTERVAL_MS/);
  assert.match(discussion, /MECKY_POLL_ATTEMPT_LIMIT/);
  assert.match(discussion, /window\.setInterval/);
  assert.match(discussion, /window\.clearInterval\(timer\)/);
  assert.match(
    discussion,
    /meckyPollAttempts\.current >= MECKY_POLL_ATTEMPT_LIMIT/
  );
});

test("labels the civic handoff and keeps vote and treasury authority disabled", () => {
  assert.match(discussion, /Verbesserungsvorschlag/);
  assert.match(discussion, /Citizen Brief/);
  assert.match(discussion, /Beratendes Meinungsbild/);
  assert.match(discussion, /Keine echte Abstimmung/);
  assert.match(discussion, /keine Auszahlung/i);
});

test("shows reviewed administration progress inside the same Civic Journey", () => {
  assert.match(discussion, /toStadtstackAdministrationProgress/);
  assert.match(
    discussion,
    /stagingPost<unknown>\("\/view", \{\s*profile: "public",?\s*\}\)/
  );
  assert.match(discussion, /progress\.caseBinding\.caseId !== canonicalCaseId/);
  assert.match(discussion, /administrationRequestId\.current !== requestId/);
  assert.match(discussion, /administrationProgress\.acceptedCount/);
  assert.match(discussion, /<StadtstackAdministrationProgress/);
  assert.match(administrationProgress, /Öffentliche Verwaltungssicht/);
  assert.match(
    administrationProgress,
    /Noch keine öffentlich geprüfte Antwort/
  );
  assert.match(administrationProgress, /Bereit für den Case Steward/);
  assert.match(administrationProgress, /Keine Entscheidungswirkung/);
  assert.match(administrationProgress, /Keine Treasury-Wirkung/);
  assert.doesNotMatch(administrationProgress, /review_pending|review_rejected/);
});

test("lets the topic author sign a proposal without inventing a CivicCase", () => {
  assert.match(discussion, /thread\.topic\?\.title/);
  assert.match(discussion, /thread\.caseBinding/);
  assert.match(discussion, /thread\.sourceAppPostId/);
  assert.match(discussion, /Zum ursprünglichen Beitrag/);
  assert.match(discussion, /Noch kein CivicCase/);
  assert.match(discussion, /signTopicSuggestion/);
  assert.match(discussion, /intent: "suggestion"/);
  assert.match(discussion, /Vorschlag prüfen und signieren/);
  assert.match(discussion, /Wartet auf menschliche Aufnahme/);
  assert.match(discussion, /kein CivicCase automatisch angelegt/);
  assert.match(discussion, /Menschliche Aufnahme als CivicCase/);
});

test("promotes the displayed signed discussion without publishing or polling a duplicate", () => {
  assert.match(discussion, /discussion: thread\.rootEvent/);
  assert.match(discussion, /answer: thread\.mecky\.event/);
  assert.match(discussion, /proposalPersona\.id/);
  assert.doesNotMatch(discussion, /stagingPost<[^>]+>\("\/discussion"/);
  assert.doesNotMatch(discussion, /\/reply\?parent=/);
});

test("shows the reviewed Citizen Brief in Mitmachen without merging it into formal governance", () => {
  assert.match(proposalsPage, /StadtstackAdvisoryParticipation/);
  assert.match(proposalsPage, /Formale Governance · technisch und rechtlich/);
  assert.match(advisoryParticipation, /Beratendes Mitmachen · Staging/);
  assert.match(advisoryParticipation, /Beteiligung vorbereitet/);
  assert.match(advisoryParticipation, /Noch nicht geöffnet/);
  assert.match(advisoryParticipation, /keine Stimmen, kein Ergebnis/);
  assert.match(advisoryParticipation, /participationState === "brief_ready"/);
  assert.match(
    advisoryParticipation,
    /stagingPost<unknown>\("\/view", \{ profile: "public" \}\)/
  );
  assert.match(advisoryParticipation, /Keine formale Abstimmung/);
  assert.match(advisoryParticipation, /Keine Treasury-Wirkung/);
  assert.doesNotMatch(
    advisoryParticipation,
    /castVote|createProposal|executeProposal/
  );
});
