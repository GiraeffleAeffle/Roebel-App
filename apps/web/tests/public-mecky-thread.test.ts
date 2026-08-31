import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  mergePublicMeckyThread,
  publicMeckyReplyCounts,
} from "../src/lib/public-mecky-thread";
import type { PostComment } from "../src/types/post";
import { publicEvidenceDestinationLabel } from "../src/lib/public-evidence-url";

const POST_ID = "735187dc-d737-4e6c-bdd9-fe0792fec498";
const EVENT_ID = "a".repeat(64);

function human(id: string, createdAt: string): PostComment {
  return {
    id,
    post_id: POST_ID,
    wallet_address: "0x1234",
    account_id: null,
    content: "Bürgerbeitrag",
    media_urls: [],
    video_url: null,
    status: "published",
    created_at: createdAt,
    author_username: "Anna",
    author_profile_picture_url: null,
  };
}

function projection(overrides: Record<string, unknown> = {}) {
  return {
    event_id: EVENT_ID,
    source_post_id: POST_ID,
    source_comment_id: null,
    agent_pubkey: "b".repeat(64),
    content: "Die geprüfte Quelle nennt zwei Varianten.",
    evidence_refs: [
      {
        digest: `sha256:${"c".repeat(64)}`,
        url: "https://stadtstack.example/evidence/1",
      },
    ],
    event_created_at: "2026-08-21T12:01:00.000Z",
    authority_binding: "none",
    ...overrides,
  };
}

describe("normal Röbel comment thread with Public Mecky", () => {
  it("merges the signed projection chronologically before applying pagination", () => {
    const page = mergePublicMeckyThread({
      humanComments: [
        human("human-1", "2026-08-21T12:00:00.000Z"),
        human("human-2", "2026-08-21T12:02:00.000Z"),
      ],
      projectedRows: [projection()],
      postId: POST_ID,
      offset: 1,
      limit: 1,
    });

    assert.equal(page.length, 1);
    assert.equal(page[0]?.id, EVENT_ID);
    assert.deepEqual(page[0]?.agent, {
      kind: "public_mecky",
      pubkey: "b".repeat(64),
      authorityBinding: "none",
      evidenceRefs: [
        {
          digest: `sha256:${"c".repeat(64)}`,
          url: "https://stadtstack.example/evidence/1",
        },
      ],
    });
  });

  it("drops cross-post, elevated-authority and credential-bearing projections", () => {
    const page = mergePublicMeckyThread({
      humanComments: [human("human-1", "2026-08-21T12:00:00.000Z")],
      projectedRows: [
        projection({ source_post_id: "d".repeat(64) }),
        projection({ event_id: "e".repeat(64), authority_binding: "formal" }),
        projection({
          event_id: "f".repeat(64),
          evidence_refs: [
            {
              digest: `sha256:${"c".repeat(64)}`,
              url: "https://user:secret@stadtstack.example/evidence/1",
            },
          ],
        }),
      ],
      postId: POST_ID,
      offset: 0,
      limit: 20,
    });

    assert.deepEqual(page.map((entry) => entry.id), ["human-1"]);
  });

  it("keeps canonical Nostr and ALLRIS citations while exposing their destinations", () => {
    const nostrUrl = `https://index.roebel.app/events?ids=${"d".repeat(64)}`;
    const allrisUrl =
      "https://roebelmueritz.sitzung-mv.de/public/vo020?TOLFDNR=1014873&VOLFDNR=1002054&refresh=false";
    const page = mergePublicMeckyThread({
      humanComments: [],
      projectedRows: [projection({
        evidence_refs: [
          { digest: `sha256:${"c".repeat(64)}`, url: nostrUrl },
          { digest: `sha256:${"d".repeat(64)}`, url: allrisUrl },
        ],
      })],
      postId: POST_ID,
      offset: 0,
      limit: 20,
    });

    assert.deepEqual(page[0]?.agent?.evidenceRefs.map((entry) => entry.url), [
      nostrUrl,
      allrisUrl,
    ]);
    assert.equal(publicEvidenceDestinationLabel(nostrUrl), "index.roebel.app");
    assert.equal(
      publicEvidenceDestinationLabel(allrisUrl),
      "roebelmueritz.sitzung-mv.de",
    );
  });

  it("counts unique zero-authority replies only for posts on the feed page", () => {
    const counts = publicMeckyReplyCounts(
      [
        projection(),
        projection(),
        projection({ event_id: "e".repeat(64), authority_binding: "formal" }),
        projection({ event_id: "f".repeat(64), source_post_id: "d".repeat(64) }),
      ],
      new Set([POST_ID])
    );

    assert.equal(counts.get(POST_ID), 1);
    assert.equal(counts.size, 1);
  });

  it("wires the read model into the normal feed and labels its authority boundary", () => {
    const actions = readFileSync(
      new URL("../src/app/actions/posts.ts", import.meta.url),
      "utf8"
    );
    const comments = readFileSync(
      new URL("../src/components/app/CommentSection.tsx", import.meta.url),
      "utf8"
    );

    assert.match(actions, /PUBLIC_MECKY_REPLIES_TABLE = "public_mecky_replies"/);
    assert.match(actions, /PUBLIC_MECKY_OPTIONAL_READ_TIMEOUT_MS = 1_500/);
    assert.match(actions, /Promise\.race\(\[/);
    assert.match(actions, /mergePublicMeckyThread\(\{/);
    assert.match(actions, /publicMeckyCounts\.get\(row\.id as string\)/);
    assert.match(comments, /data-public-mecky-reply/);
    assert.match(comments, /KI · geprüfte Quellen/);
    assert.match(comments, /data-mecky-authority-binding="none"/);
    assert.match(
      comments,
      /Beratende KI-Antwort · keine Verwaltungs- oder Entscheidungsbefugnis/
    );
    assert.equal(
      (comments.match(/<MeckyAuthorityNotice \/>/g) ?? []).length,
      2
    );
    assert.match(
      comments,
      /Nachweis \{index \+ 1\} · \{publicEvidenceDestinationLabel\(evidence\.url\)\}/,
    );
    assert.match(comments, /!projectedReplyIds\.has\(reply\.id\)/);
  });
});
