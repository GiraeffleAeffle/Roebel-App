#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const FULL_SHA = /^[0-9a-f]{40}$/u;
const HIGH_CONFIDENCE_SECRETS = [
  ["private_key", /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/u],
  ["anthropic_key", /\bsk-ant-[A-Za-z0-9_-]{20,}\b/u],
  ["openai_key", /\bsk-(?:proj-|svcacct-)[A-Za-z0-9_-]{20,}\b/u],
  ["stripe_live_key", /\b[rs]k_live_[A-Za-z0-9]{20,}\b/u],
  ["github_token", /\bgh[oprsu]_[A-Za-z0-9_]{30,}\b/u],
  ["aws_access_key", /\bAKIA[0-9A-Z]{16}\b/u],
  ["slack_token", /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u],
];

function git(args) {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function normalizeDiffPath(raw) {
  if (raw === "/dev/null") return null;
  const path = raw.startsWith("b/") ? raw.slice(2) : raw;
  return path.replace(/^"|"$/gu, "");
}

export function addedLinesFromDiff(diff) {
  const additions = [];
  let path = null;
  let newLine = 0;

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      path = normalizeDiffPath(line.slice(4));
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u.exec(line);
    if (hunk) {
      newLine = Number.parseInt(hunk[1], 10);
      continue;
    }
    if (!path || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      additions.push({ path, line: newLine, text: line.slice(1) });
      newLine += 1;
    } else if (!line.startsWith("-")) {
      newLine += 1;
    }
  }
  return additions;
}

function isCommittedEnvironmentFile(path) {
  const name = path.split("/").at(-1) ?? "";
  if (!name.startsWith(".env")) return false;
  return !(
    name === ".env.example" ||
    name === ".env.sample" ||
    name.endsWith(".example") ||
    name.endsWith(".sample")
  );
}

export function scanAddedLines(diff, changedPaths = []) {
  const violations = [];

  for (const path of changedPaths) {
    if (isCommittedEnvironmentFile(path)) {
      violations.push({ code: "committed_environment_file", path, line: 0 });
    }
  }

  for (const addition of addedLinesFromDiff(diff)) {
    for (const [code, pattern] of HIGH_CONFIDENCE_SECRETS) {
      if (pattern.test(addition.text)) {
        violations.push({ code, path: addition.path, line: addition.line });
      }
    }
    if (
      /\b(?:NEXT_PUBLIC|EXPO_PUBLIC)_[A-Z0-9_]*SERVICE_ROLE[A-Z0-9_]*\b/u.test(addition.text) ||
      /\bSERVICE_ROLE[A-Z0-9_]*\s*[:=].*\b(?:NEXT_PUBLIC|EXPO_PUBLIC)\b/u.test(addition.text)
    ) {
      violations.push({ code: "public_service_role_exposure", path: addition.path, line: addition.line });
    }
  }

  return violations;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function scanMigrationRls(path, sql) {
  const violations = [];
  const creates = [
    ...sql.matchAll(
      /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:"?[a-z_][a-z0-9_]*"?\.)?"?[a-z_][a-z0-9_]*"?)/giu,
    ),
  ];

  for (const match of creates) {
    const table = match[1];
    const rls = new RegExp(
      `alter\\s+table\\s+(?:if\\s+exists\\s+)?${escapeRegex(table)}\\s+enable\\s+row\\s+level\\s+security`,
      "iu",
    );
    if (!rls.test(sql)) violations.push({ code: "new_table_without_rls", path, line: 0 });
  }
  return violations;
}

export function inspectSecurityBoundary({ diff, changedPaths, addedPaths, readText }) {
  const violations = scanAddedLines(diff, changedPaths);
  for (const path of addedPaths) {
    if (!/(?:^|\/)supabase\/migrations\/[^/]+\.sql$/u.test(path)) continue;
    violations.push(...scanMigrationRls(path, readText(path)));
  }
  return violations;
}

function main(argv) {
  if (argv.length !== 2 || !FULL_SHA.test(argv[0]) || !FULL_SHA.test(argv[1])) {
    throw new Error("usage: review-pr-security-boundary.mjs <base-sha> <head-sha>");
  }
  const [base, head] = argv;
  const range = `${base}...${head}`;
  const common = ["--no-ext-diff", "--no-renames", "--no-color"];
  const diff = git(["diff", ...common, "--unified=0", "--diff-filter=ACMR", range, "--"]);
  const changedPaths = git(["diff", ...common, "--name-only", "--diff-filter=ACMR", range, "--"])
    .split("\n")
    .filter(Boolean);
  const addedPaths = git(["diff", ...common, "--name-only", "--diff-filter=A", range, "--"])
    .split("\n")
    .filter(Boolean);
  const violations = inspectSecurityBoundary({
    diff,
    changedPaths,
    addedPaths,
    readText: (path) => readFileSync(path, "utf8"),
  });

  if (violations.length > 0) {
    for (const violation of violations) {
      const at = violation.line > 0 ? `${violation.path}:${violation.line}` : violation.path;
      console.error(`security-boundary: ${violation.code} at ${at}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`security-boundary: PASS (${changedPaths.length} changed files inspected)`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
