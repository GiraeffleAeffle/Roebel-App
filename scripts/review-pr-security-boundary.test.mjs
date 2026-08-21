import assert from "node:assert/strict";
import test from "node:test";

import {
  addedLinesFromDiff,
  inspectSecurityBoundary,
  scanAddedLines,
  scanMigrationRls,
} from "./review-pr-security-boundary.mjs";

function diff(path, lines) {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    ...lines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

test("parses added lines without returning deleted content", () => {
  const patch = [
    "diff --git a/a.ts b/a.ts",
    "--- a/a.ts",
    "+++ b/a.ts",
    "@@ -4,2 +4,2 @@",
    "-const oldValue = 1;",
    "+const newValue = 2;",
    " context();",
  ].join("\n");
  assert.deepEqual(addedLinesFromDiff(patch), [{ path: "a.ts", line: 4, text: "const newValue = 2;" }]);
});

test("rejects high-confidence credentials without echoing their value", () => {
  const token = `sk-ant-${"A".repeat(24)}`;
  const result = scanAddedLines(diff("src/config.ts", [`const token = \"${token}\";`]), ["src/config.ts"]);
  assert.deepEqual(result, [{ code: "anthropic_key", path: "src/config.ts", line: 1 }]);
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token, "u"));
});

test("rejects committed runtime env files but permits examples", () => {
  assert.deepEqual(scanAddedLines("", ["apps/web/.env.local"]), [
    { code: "committed_environment_file", path: "apps/web/.env.local", line: 0 },
  ]);
  assert.deepEqual(scanAddedLines("", ["apps/web/.env.example"]), []);
});

test("rejects service-role credentials exposed through public environment names", () => {
  const publicServiceRole = ["NEXT", "PUBLIC", "SUPABASE", "SERVICE", "ROLE", "KEY"].join("_");
  const result = scanAddedLines(diff("apps/web/config.ts", [`${publicServiceRole}=value`]));
  assert.equal(result[0]?.code, "public_service_role_exposure");
});

test("requires RLS for every table created by a new Supabase migration", () => {
  assert.deepEqual(scanMigrationRls("supabase/migrations/001.sql", "create table public.notes (id uuid);"), [
    { code: "new_table_without_rls", path: "supabase/migrations/001.sql", line: 0 },
  ]);
  assert.deepEqual(
    scanMigrationRls(
      "supabase/migrations/001.sql",
      "create table if not exists public.notes (id uuid); alter table public.notes enable row level security;",
    ),
    [],
  );
});

test("inspects only newly added Supabase migrations for the RLS invariant", () => {
  const path = "apps/expo/supabase/migrations/20260821_notes.sql";
  const result = inspectSecurityBoundary({
    diff: diff(path, ["create table public.notes (id uuid);"]),
    changedPaths: [path],
    addedPaths: [path],
    readText: () => "create table public.notes (id uuid);",
  });
  assert.equal(result[0]?.code, "new_table_without_rls");
});

test("accepts ordinary source changes and RLS-protected migrations", () => {
  const path = "apps/expo/supabase/migrations/20260821_notes.sql";
  const sql = [
    "create table if not exists public.notes (id uuid primary key);",
    "alter table public.notes enable row level security;",
    "create policy notes_read on public.notes for select using (true);",
  ].join("\n");
  assert.deepEqual(
    inspectSecurityBoundary({
      diff: diff(path, sql.split("\n")),
      changedPaths: [path, "apps/web/src/page.tsx"],
      addedPaths: [path],
      readText: () => sql,
    }),
    [],
  );
});
