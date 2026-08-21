import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflow = readFileSync(new URL("./security-review.yml", import.meta.url), "utf8");
const prJob = workflow.split("  weekly-audit:")[0];
const weeklyJob = workflow.split("  weekly-audit:")[1] ?? "";

test("security workflow always runs the deterministic local boundary", () => {
  assert.match(prJob, /node --test scripts\/review-pr-security-boundary\.test\.mjs/u);
  assert.match(prJob, /node scripts\/review-pr-security-boundary\.mjs "\$BASE_SHA" "\$HEAD_SHA"/u);
  assert.match(prJob, /BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \}\}/u);
  assert.match(prJob, /HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha \}\}/u);
});

test("AI review is optional and missing keys leave an explicit notice", () => {
  assert.match(prJob, /CLAUDE_API_KEY: \$\{\{ secrets\.CLAUDE_API_KEY \}\}/u);
  assert.match(prJob, /if: env\.CLAUDE_API_KEY == ''[\s\S]*skipping the optional AI security review/iu);
  assert.match(prJob, /if: env\.CLAUDE_API_KEY != ''[\s\S]*claude-api-key: \$\{\{ env\.CLAUDE_API_KEY \}\}/u);
  assert.match(weeklyJob, /if: env\.ANTHROPIC_API_KEY == ''[\s\S]*skipping the optional weekly AI audit/iu);
  assert.match(weeklyJob, /if: env\.ANTHROPIC_API_KEY != ''/u);
});

test("third-party actions are immutable and permissions are job-scoped", () => {
  assert.match(workflow, /^permissions: \{\}$/mu);
  assert.match(prJob, /permissions:\n      contents: read\n      pull-requests: write/u);
  assert.match(weeklyJob, /permissions:\n      contents: read\n      issues: write/u);
  const uses = [...workflow.matchAll(/^\s+-?\s*uses:\s+([^\s#]+)/gmu)].map((match) => match[1]);
  assert.ok(uses.length >= 4);
  for (const use of uses) {
    const sha = use.split("@")[1];
    assert.match(sha ?? "", /^[0-9a-f]{40}$/u, `${use} must use an immutable commit`);
  }
  assert.ok(uses.includes("anthropics/claude-code-security-review@0c6a49f1fa56a1d472575da86a94dbc1edb78eda"));
  assert.ok(uses.includes("anthropics/claude-code-action@3f854a8fb5146b39d5cbf8b57f70d80810e1366f"));
});
