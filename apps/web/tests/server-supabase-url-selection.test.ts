import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const serverClient = readFileSync(
  new URL("../src/lib/supabase/server.ts", import.meta.url),
  "utf8"
);

test("server reads use the server-only Supabase origin ahead of browser URLs", () => {
  assert.match(
    serverClient,
    /process\.env\.ROEBEL_SERVER_SUPABASE_URL\s*\?\?\s*process\.env\.ROEBEL_PUBLIC_SUPABASE_URL\s*\?\?\s*process\.env\.NEXT_PUBLIC_SUPABASE_URL/s
  );
  assert.doesNotMatch(serverClient, /SERVICE_ROLE/);
});
