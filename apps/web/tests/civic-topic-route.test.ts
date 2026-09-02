import assert from "node:assert/strict";
import { test } from "node:test";

import { civicTopicIdFromRouteParam } from "../src/lib/stadtstack/civic-topic-route.ts";

const LIVE_TOPIC_ID =
  "urn:stadtstack:topic:municipality:roebel-mueritz:mecky-welche-oeffentlich-belegten-unverbindlichen-optionen-zur";

test("resolves the encoded feed route segment to its canonical civic topic", () => {
  const routeParam = encodeURIComponent(LIVE_TOPIC_ID);

  assert.equal(civicTopicIdFromRouteParam(routeParam), LIVE_TOPIC_ID);
  assert.equal(civicTopicIdFromRouteParam(LIVE_TOPIC_ID), LIVE_TOPIC_ID);
});
