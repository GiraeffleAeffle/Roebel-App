import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  presentCivicPostJourney,
  resolveCivicPostJourney,
} from "../src/lib/stadtstack/civic-post-journey-policy.ts";
import type { PublicCivicPostLink } from "../src/lib/stadtstack/civic-topic-detail.ts";

const SOURCE_POST_ID = "ec0b3016-ec18-417c-8008-c0fa9feaade0";
const postJourneyComponent = readFileSync(
  new URL("../src/components/app/StadtstackPostJourney.tsx", import.meta.url),
  "utf8",
);

test("a temporary projection outage can recover to a confirmed unlinked source post", async () => {
  let attempts = 0;

  const state = await resolveCivicPostJourney({
    sourceAppPostId: SOURCE_POST_ID,
    loadPostLink: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("public_civic_projection_unavailable");
      return null;
    },
  });

  assert.deepEqual(state, { kind: "unlinked" });
  assert.equal(attempts, 2);
});

test("a sustained projection outage offers an explicit retry without offering promotion", async () => {
  let attempts = 0;

  const state = await resolveCivicPostJourney({
    sourceAppPostId: SOURCE_POST_ID,
    loadPostLink: async () => {
      attempts += 1;
      throw new Error("public_civic_projection_unavailable");
    },
  });

  assert.deepEqual(presentCivicPostJourney(state, true), {
    kind: "unavailable",
    message: "Bürgerprozess gerade nicht erreichbar",
    retryLabel: "Erneut versuchen",
  });
  assert.equal(attempts, 2);
});

test("a confirmed unlinked author post offers promotion", async () => {
  const state = await resolveCivicPostJourney({
    sourceAppPostId: SOURCE_POST_ID,
    loadPostLink: async () => null,
  });

  assert.deepEqual(presentCivicPostJourney(state, true), {
    kind: "promotion",
  });
});

test("an existing civic link shows its journey instead of offering promotion", async () => {
  const link = { marker: "existing-link" } as unknown as PublicCivicPostLink;
  const state = await resolveCivicPostJourney({
    sourceAppPostId: SOURCE_POST_ID,
    loadPostLink: async () => link,
  });

  assert.deepEqual(presentCivicPostJourney(state, true), {
    kind: "journey",
    link,
  });
});

test("the journey lookup effect depends on a stable staging boolean", () => {
  assert.match(
    postJourneyComponent,
    /const enabled = Boolean\(\s*resolveStadtstackStagingLab\(/,
  );
});

test("the compact feed journey keeps citizen adoption between proposal and case", () => {
  assert.match(
    postJourneyComponent,
    /"proposal",\s*"adoption",\s*"case"/,
  );
  assert.match(postJourneyComponent, /aria-current=/);
});
