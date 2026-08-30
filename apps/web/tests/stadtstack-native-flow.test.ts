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
const civicTopic = readFileSync(
  new URL("../src/components/app/StadtstackCivicTopic.tsx", import.meta.url),
  "utf8"
);
const civicTopicPage = readFileSync(
  new URL("../src/app/app/themen/[topicId]/page.tsx", import.meta.url),
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
const postDetail = readFileSync(
  new URL("../src/app/app/posts/[id]/page.tsx", import.meta.url),
  "utf8"
);
const civicProjectionClient = readFileSync(
  new URL("../src/lib/stadtstack/civic-projection-client.ts", import.meta.url),
  "utf8"
);
const participantTopicTracer = readFileSync(
  new URL("../src/lib/staging-participant/topic-tracer.ts", import.meta.url),
  "utf8"
);
const durableParticipantOperation = readFileSync(
  new URL(
    "../src/lib/staging-participant/durable-operation.ts",
    import.meta.url,
  ),
  "utf8",
);
const commentSection = readFileSync(
  new URL("../src/components/app/CommentSection.tsx", import.meta.url),
  "utf8"
);
const postComposer = readFileSync(
  new URL("../src/components/app/PostComposer.tsx", import.meta.url),
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
const workbenchServer = readFileSync(
  new URL(
    "../../../packages/e2e-workbench/src/server.ts",
    import.meta.url
  ),
  "utf8"
);

test("keeps the civic workflow native to ordinary Röbel posts and discussion routes", () => {
  assert.doesNotMatch(appPage, /StadtstackStagingFeed/);
  assert.doesNotMatch(appPage, /StadtstackStagingLabCard/);
  assert.match(postCard, /StadtstackPostJourney/);
  assert.match(postCard, /mode === "detail" && isAuthor/);
  assert.match(postPromotion, /promoteStagingParticipantSourcePost/);
  assert.match(participantTopicTracer, /API_ROOT = "\/api\/staging-participant\/v1"/);
  assert.match(participantTopicTracer, /request\("promote-source-post"/);
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
  assert.match(civicTopicCard, /\/app\/themen\//);
  assert.match(civicTopicPage, /<StadtstackCivicTopic/);
  assert.match(civicTopic, /Aus dem normalen Feed/);
  assert.match(civicTopic, /Strukturierte Diskussionen/);
  assert.match(civicTopic, /Beiträge bleiben Beiträge/);
  assert.match(civicTopic, /\/app\/diskussion\//);
  assert.match(civicTopic, /\/app\/posts\//);
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
  assert.match(postPromotion, /Nachvollziehbarer Ausgangspunkt/);
  assert.match(postPromotion, /@Mecky-Austausch von.*mitnehmen/);
  assert.match(postPromotion, /conversationSource/);
  assert.match(postPromotion, /selectedReply\.mentionEvent/);
  assert.match(postPromotion, /staging_participant_mecky_reply_required/);
});

test("brings a promoted source post back into its one visible civic journey", () => {
  const postJourney = readFileSync(
    new URL("../src/components/app/StadtstackPostJourney.tsx", import.meta.url),
    "utf8"
  );
  assert.match(postJourney, /loadPublicCivicPostLink/);
  assert.match(postJourney, /Bürgerprozess aus diesem Beitrag/);
  assert.match(postJourney, /Der ursprüngliche Beitrag bleibt unverändert/);
  assert.match(postJourney, /Bürgerprozess öffnen/);
  assert.match(postJourney, /Nächster Schritt/);
  assert.match(postJourney, /<StadtstackPostPromotion/);
  assert.match(postJourney, /\/app\/themen\//);
  assert.match(civicProjectionClient, /PUBLIC_CIVIC_API = "\/api\/civic\/v1"/);
  assert.doesNotMatch(postDetail, /StadtstackStagingPostDetail/);
  assert.doesNotMatch(postDetail, /findStagingPostMirror/);
  assert.match(
    readFileSync(
      new URL("../src/components/app/PostCard.tsx", import.meta.url),
      "utf8"
    ),
    /<StadtstackPostJourney/
  );
});

test("makes the real signed promotion writer idempotent by source post", () => {
  assert.match(workbenchServer, /publishSignedPromotionOnce/);
  assert.match(workbenchServer, /status: "already_promoted"/);
});

test("replays exact promotion and suggestion envelopes until their receipts complete", () => {
  assert.match(participantTopicTracer, /openDurableJsonOperation/);
  assert.match(
    participantTopicTracer,
    /key: `promotion:\$\{input\.sourcePostId\.toLowerCase\(\)\}`/,
  );
  assert.match(
    participantTopicTracer,
    /key: `suggestion:\$\{input\.discussionRootEvent\.id\}`/,
  );
  assert.match(participantTopicTracer, /operation\.serializedBody/);
  assert.match(participantTopicTracer, /operation\.complete\(\)/);
  assert.match(postPromotion, /resumeStagingParticipantSourcePostPromotion/);
  assert.match(discussion, /resumeStagingParticipantTopicSuggestion/);
  assert.match(durableParticipantOperation, /current !== input\.raw/);
  assert.match(
    durableParticipantOperation,
    /staging_participant_durable_operation_changed/,
  );
});

test("lets explicit @Mecky mentions answer inside an ordinary app thread without auto-promotion", () => {
  assert.doesNotMatch(appPage, /<StadtstackStagingFeed/);
  assert.match(appPage, /<PostComposer[^>]+defaultFeedType="main"/);
  assert.match(
    postComposer,
    /stagingParticipant\.createPost\(submittedContent\)/
  );
  assert.match(postComposer, /mirrorStagingParticipantMeckyPost/);
  assert.match(
    postComposer,
    /router\.push\(`\/app\/posts\/\$\{result\.data\.id\}`\)/
  );
  assert.match(postPromotion, /selectedReply\.replyEvent/);
  assert.match(postPromotion, /staging_participant_mecky_reply_required/);
  assert.match(postComposer, /requestAppMeckyConversationAnswer/);
  assert.match(commentSection, /data-mecky-conversation-reply/);
  assert.match(commentSection, /Geprüfter Nachweis \{index \+ 1\}/);
  assert.match(commentSection, /data-mecky-authority-binding="none"/);
  assert.equal(
    (commentSection.match(/<MeckyAuthorityNotice \/>/g) ?? []).length,
    2
  );
  assert.match(postPromotion, /promoteStagingParticipantSourcePost/);
  assert.match(postPromotion, /\/app\/diskussion\//);
});

test("invites a signed-out reader into the same public post conversation", () => {
  assert.match(commentSection, /<ConnectCta/);
  assert.match(commentSection, /Anmelden und mitreden/);
  assert.match(
    commentSection,
    /Kommentare und Mecky-Antworten bleiben öffentlich lesbar/
  );
});

test("restores each source-bound Mecky request after a reload", () => {
  assert.match(commentSection, /meckyConversation\?\.requests/);
  assert.match(commentSection, /request\.state === "pending"/);
  assert.match(commentSection, /Erneut nach Mecky sehen/);
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
  assert.match(discussion, /Diskussionsgrundlage für die Anfrage/);
  assert.match(discussion, /Argumentzweige, keine Stimmen/);
  assert.match(discussion, /Zur Prüfung angefragt/);
  assert.match(discussion, /thread\?\.suggestion\?\.draft\.title/);
  assert.match(discussion, /thread\?\.suggestion\?\.draft\.summary/);
  assert.match(discussion, /Keine Verwaltungsfreigabe/);
  assert.match(discussion, /kein bindender kommunaler Beschluss/);
  assert.match(discussion, /Citizen Brief/);
  assert.match(discussion, /Beratendes Meinungsbild/);
  assert.match(discussion, /Keine echte Abstimmung/);
  assert.match(discussion, /keine\s+Auszahlung/i);
});

test("shows reviewed administration progress inside the same Civic Journey", () => {
  assert.match(discussion, /loadStadtstackAdministrationProgress/);
  assert.doesNotMatch(discussion, /stagingPost<unknown>\("\/view"/);
  assert.match(discussion, /administrationRequestId\.current !== requestId/);
  assert.match(discussion, /administrationProgress\.acceptedCount/);
  assert.match(discussion, /<StadtstackAdministrationProgress/);
  assert.match(civicTopic, /loadStadtstackAdministrationProgress/);
  assert.match(civicTopic, /detail\.caseBinding/);
  assert.match(civicTopic, /<StadtstackAdministrationProgress/);
  assert.match(civicTopic, /caseBindingConflict/);
  assert.match(administrationProgress, /Öffentliche Verwaltungssicht/);
  assert.match(
    administrationProgress,
    /Noch keine öffentlich geprüfte Antwort/
  );
  assert.match(administrationProgress, /Bereit für den Case Steward/);
  assert.match(administrationProgress, /Arbeitspaket/);
  assert.match(administrationProgress, /packageChecksum/);
  assert.match(administrationProgress, /Keine Entscheidungswirkung/);
  assert.match(administrationProgress, /Keine Treasury-Wirkung/);
  assert.doesNotMatch(administrationProgress, /review_pending|review_rejected/);
});

test("lets the topic author sign a draft without inventing a CivicCase", () => {
  assert.match(discussion, /thread\.topic\?\.title/);
  assert.match(discussion, /thread\.caseBinding/);
  assert.match(discussion, /thread\.sourceAppPostId/);
  assert.match(discussion, /Zum ursprünglichen Beitrag/);
  assert.match(discussion, /Noch kein CivicCase/);
  assert.match(discussion, /signParticipantTopicSuggestion/);
  assert.match(discussion, /signStagingParticipantTopicSuggestion/);
  assert.match(discussion, /thread\.sourceConversationWitnesses/);
  assert.match(discussion, /conversationWitnesses:/);
  assert.match(discussion, /mentionEvent: witnesses\.mentionEvent/);
  assert.match(discussion, /replyEvent: witnesses\.replyEvent/);
  assert.match(participantTopicTracer, /entryState: "citizen_adoption_required"/);
  assert.match(
    discussion,
    /else if \(syntheticLegacyMode\)[\s\S]*?intent: "suggestion"/,
  );
  assert.match(
    discussion,
    /participantTracerMode \? "Entwurf" : "Vorschlag"\} prüfen und signieren/,
  );
  assert.match(discussion, /Bürgerübernahme erforderlich/);
  assert.match(discussion, /kein CivicCase automatisch angelegt/);
  assert.match(discussion, /Menschliche Aufnahme als CivicCase/);
  assert.match(discussion, /Diese öffentliche App kann die Aufnahme nicht auslösen/);
  assert.doesNotMatch(discussion, /stagingPost<[^>]+>\("\/admit"/);
  assert.doesNotMatch(discussion, /stagingPost<[^>]+>\("\/complete"/);
});

test("promotes the displayed signed discussion without publishing or polling a duplicate", () => {
  assert.match(discussion, /sourceDiscussion: thread\.rootEvent/);
  assert.match(discussion, /sourceAnswer: thread\.mecky\.event/);
  assert.match(discussion, /signStagingParticipantTopicSuggestion/);
  assert.match(discussion, /syntheticLegacyMode/);
  assert.doesNotMatch(discussion, /stagingPost<[^>]+>\("\/discussion"/);
  assert.doesNotMatch(discussion, /\/reply\?parent=/);
  assert.match(discussion, /thread\.sourceConversation/);
  assert.match(discussion, /Aus einem ausdrücklich ausgewählten @Mecky-Austausch/);
});

test("shows the reviewed Citizen Brief in Mitmachen without merging it into formal governance", () => {
  assert.match(proposalsPage, /StadtstackAdvisoryParticipation/);
  assert.match(
    proposalsPage,
    /new URLSearchParams\(window\.location\.search\)/
  );
  assert.match(proposalsPage, /caseId=\{stadtstackCaseId\}/);
  assert.match(proposalsPage, /topicId=\{stadtstackTopicId\}/);
  assert.match(proposalsPage, /Formale Governance · technisch und rechtlich/);
  assert.match(advisoryParticipation, /Beratendes Mitmachen · Staging/);
  assert.match(advisoryParticipation, /loadStadtstackAdvisoryCase/);
  assert.match(advisoryParticipation, /caseId/);
  assert.match(advisoryParticipation, /Zurück zum Bürger-Thema/);
  assert.match(advisoryParticipation, /Beteiligung vorbereitet/);
  assert.match(advisoryParticipation, /Noch nicht geöffnet/);
  assert.match(advisoryParticipation, /keine Stimmen, kein Ergebnis/);
  assert.match(advisoryParticipation, /participationState === "brief_ready"/);
  assert.doesNotMatch(advisoryParticipation, /stagingPost/);
  assert.match(advisoryParticipation, /Geprüfter Budgetkontext/);
  assert.match(advisoryParticipation, /Keine formale Abstimmung/);
  assert.match(advisoryParticipation, /Keine Treasury-Wirkung/);
  assert.doesNotMatch(
    advisoryParticipation,
    /castVote|createProposal|executeProposal/
  );
  assert.match(civicTopic, /participationHref/);
  assert.match(administrationProgress, /Im Mitmachen-Bereich ansehen/);
});
