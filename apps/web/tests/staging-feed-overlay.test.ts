import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const feedClient = readFileSync(
  new URL("../src/lib/supabase/feed-server.ts", import.meta.url),
  "utf8"
);
const postsAction = readFileSync(
  new URL("../src/app/actions/posts.ts", import.meta.url),
  "utf8"
);
const comments = readFileSync(
  new URL("../src/components/app/CommentSection.tsx", import.meta.url),
  "utf8"
);

function functionBody(name: string, nextName: string): string {
  const pattern = new RegExp(
    `export async function ${name}\\([\\s\\S]*?(?=export async function ${nextName}\\()`,
    "u"
  );
  const body = postsAction.match(pattern)?.[0];
  assert.ok(body, `${name} source boundary missing`);
  return body;
}

test("only feed/detail/comment readers can select the staging overlay", () => {
  assert.match(feedClient, /ROEBEL_FEED_SUPABASE_URL/u);
  assert.match(feedClient, /ROEBEL_FEED_SUPABASE_ANON_KEY/u);
  assert.match(feedClient, /return createDefaultServerClient\(\)/u);
  assert.match(feedClient, /\.svc\.cluster\.local/u);
  assert.match(feedClient, /parsed\.pathname !== "\/"/u);
  assert.doesNotMatch(feedClient, /SERVICE_ROLE/u);

  assert.match(
    functionBody("getPostsForFeed", "getPostById"),
    /createFeedServerClient\(\)/u
  );
  assert.match(
    functionBody("getPostById", "createPost"),
    /createFeedServerClient\(\)/u
  );
  assert.match(
    functionBody("getComments", "createComment"),
    /createFeedServerClient\(\)/u
  );
  assert.doesNotMatch(
    functionBody("createPost", "deletePost"),
    /createFeedServerClient\(\)/u
  );
  assert.doesNotMatch(
    functionBody("createComment", "reportPost"),
    /createFeedServerClient\(\)/u
  );
});

test("both signed Mecky reply renderers state the no-authority boundary", () => {
  assert.match(comments, /data-mecky-authority-binding="none"/u);
  assert.match(
    comments,
    /Beratende KI-Antwort · keine Verwaltungs- oder Entscheidungsbefugnis/u
  );
  assert.equal(
    (comments.match(/<MeckyAuthorityNotice \/>/gu) ?? []).length,
    2
  );
});
