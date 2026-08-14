import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const feed = readFileSync(
  new URL("../src/components/app/StadtstackStagingFeed.tsx", import.meta.url),
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

test("keeps the staging workflow native to the Röbel feed and discussion routes", () => {
  assert.match(appPage, /StadtstackStagingFeed/);
  assert.doesNotMatch(appPage, /StadtstackStagingLabCard/);
  assert.match(feed, /\/app\/diskussion\//);
  assert.match(feed, /useCitizenSession/);
  assert.match(feed, /signiertes Nostr/);
  assert.match(feed, /synthetische Testprofile/);
  assert.match(feed, /dein verbundenes Konto/);
  assert.doesNotMatch(feed, /href=\{.*stadtstack-test/);
  assert.match(discussion, /Argumentbaum/);
  assert.match(discussion, /Sunburst/);
  assert.match(discussion, /@Mecky/);
});

test("renders discussions inside the normal feed controls and distinguishes mentions from answers", () => {
  assert.ok(
    appPage.indexOf("<FeedFilters") < appPage.indexOf("<StadtstackStagingFeed")
  );
  assert.match(
    appPage,
    /stadtstackStagingLab &&\s*\(activeFilter === "all" \|\|\s*activeFilter === "latest" \|\|\s*activeFilter === "posts"\)/
  );
  assert.doesNotMatch(feed, /Diskussion → Mecky → Verbesserungsvorschlag/);
  assert.match(feed, /Staging-Testspur im normalen Feed/);
  assert.match(feed, /Bürger-Thema/);
  assert.match(feed, /signierte Aktivitäten/);
  assert.match(feed, /Mecky hat signiert\s+geantwortet/);
  assert.match(feed, /Antwort ausstehend/);
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
  assert.ok(
    appPage.indexOf("<StadtstackStagingFeed") > appPage.indexOf("alerts.map")
  );
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
