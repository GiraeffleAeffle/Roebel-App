import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const baseline = readFileSync(
  new URL(
    "../../../supabase/staging_incluster_tracer_baseline_v1.sql",
    import.meta.url
  ),
  "utf8"
);
const participantMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260825_staging_participant_gateway.sql",
    import.meta.url
  ),
  "utf8"
);
const topicMigration = readFileSync(
  new URL(
    "../../../supabase/migrations/20260825_staging_participant_topic_tracer.sql",
    import.meta.url
  ),
  "utf8"
);
const gatewayPublishWorkflow = readFileSync(
  new URL(
    "../../../.github/workflows/staging-participant-gateway-publish.yml",
    import.meta.url
  ),
  "utf8"
);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("the overlay binds the two already-reviewed participant migrations", () => {
  assert.equal(
    sha256(participantMigration),
    "ad050047a71bf2cc82361c16169627dc0a0a66a7982db804b1612624f0f97eab"
  );
  assert.equal(
    sha256(topicMigration),
    "739cbcb189e3b12913ebf28dae74c931eab3cfae514e476bea4071092aef242e"
  );
  assert.match(
    baseline,
    /20260825_staging_participant_gateway\.sql[\s\S]*ad050047a71bf2cc82361c16169627dc0a0a66a7982db804b1612624f0f97eab/u
  );
  assert.match(
    baseline,
    /20260825_staging_participant_topic_tracer\.sql[\s\S]*739cbcb189e3b12913ebf28dae74c931eab3cfae514e476bea4071092aef242e/u
  );
});

test("the isolated gateway build carries the baseline required by its contract test", () => {
  assert.equal(
    (
      gatewayPublishWorkflow.match(
        /- "supabase\/staging_incluster_tracer_baseline_v1\.sql"/gu
      ) ?? []
    ).length,
    2
  );
  assert.match(
    gatewayPublishWorkflow,
    /cp supabase\/staging_incluster_tracer_baseline_v1\.sql \\\n\s+"\$RUNNER_TEMP\/test-context\/supabase\/"/u
  );
});

test("the baseline creates only the ordinary-feed compatibility surface", () => {
  const createdTables = Array.from(
    baseline.matchAll(/create table public\.([a-z0-9_]+)/giu),
    (match) => match[1]
  ).sort();
  assert.deepEqual(createdTables, [
    "account_owners",
    "app_settings",
    "poll_votes",
    "post_comments",
    "post_likes",
    "post_links",
    "post_polls",
    "post_reports",
    "posts",
    "public_mecky_replies",
    "users",
  ]);
  assert.doesNotMatch(
    baseline,
    /create table public\.(?:proposals|civic_cases|votes|treasury|municipal_decisions)\b/iu
  );
});

test("the baseline satisfies exact participant preconditions without embedding credentials", () => {
  assert.match(
    baseline,
    /create extension if not exists pgcrypto with schema extensions/u
  );
  assert.match(
    baseline,
    /create extension if not exists supabase_vault with schema vault cascade/u
  );
  assert.match(
    baseline,
    /insert into public\.app_settings \(key, value\)[\s\S]*\('roebel_env', 'staging'\)/u
  );
  assert.match(
    baseline,
    /create trigger trg_post_comment_counts[\s\S]*after insert or delete on public\.post_comments[\s\S]*execute function public\.post_comment_counts_sync\(\)/u
  );
  assert.match(baseline, /create function public\.enforce_posting_rules\(\)/u);
  for (const signature of [
    "delete_owned_post",
    "delete_owned_post_comment",
    "delete_owned_experience",
    "pin_own_post",
  ]) {
    assert.match(
      baseline,
      new RegExp(`create function public\\.${signature}\\(`, "u")
    );
  }
  assert.doesNotMatch(
    baseline,
    /(?:password|secret|token|apikey)\s*=\s*['"][^'"]+['"]/iu
  );
});

test("fresh column ACLs are materialized for the pinned PostgreSQL 15 snapshot", () => {
  assert.match(
    baseline,
    /foreach v_table in array array\[\s*'posts', 'post_comments', 'post_likes', 'app_settings'\s*\]/u
  );
  assert.match(
    baseline,
    /grant select \(%s\) on table public\.%I to service_role/u
  );
  assert.doesNotMatch(
    baseline,
    /grant select \([^;]+\) on table [^;]+ to (?:anon|authenticated)/iu
  );
});

test("the public reader gets a mixed ordinary feed and no fixture discussion rows", () => {
  const seededPosts = baseline.match(
    /insert into public\.posts[\s\S]*?on conflict \(id\) do nothing;/u
  )?.[0];
  assert.ok(seededPosts);
  assert.equal((seededPosts.match(/'b057000[1-6]-/gu) ?? []).length, 6);
  assert.equal(
    (seededPosts.match(/'main', 'user', 'published'/gu) ?? []).length,
    6
  );
  assert.doesNotMatch(seededPosts, /discussion|proposal|civiccase/iu);
  assert.match(
    baseline,
    /grant select on table[\s\S]*public\.posts[\s\S]*public\.post_comments[\s\S]*to anon, authenticated/u
  );
  assert.match(baseline, /raise exception 'LEGACY_WRITE_DISABLED'/u);
  assert.doesNotMatch(
    baseline,
    /grant execute on function public\.(?:delete_owned|pin_own_post)/u
  );
});
