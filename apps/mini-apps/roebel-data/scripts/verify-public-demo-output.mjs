import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".txt"]);

// These are capability fingerprints, not secrets. Do not include matching
// output text in error messages: a future regression must not echo a token.
const FORBIDDEN_FINGERPRINTS = [
  ["Supabase client reference", /\bsupabase(?:\.co)?\b/i],
  ["Circles client reference", /\b(?:@aboutcircles|circles-sdk|getMuenzenBalance|MuenzenBalance)\b/i],
  ["JWT-shaped credential", /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/],
  ["credential-like token", /\b(?:service_role|anon(?:_key)?|authorization\s*:\s*bearer|access[_-]?token|refresh[_-]?token)\b/i],
  ["wallet capability", /\bwallet(?:Changed|_connect|\.getAccount)?\b/i],
  ["wallet authorization", /\b(?:sdk\.wallet|useWallet|eth_requestAccounts|personal_sign|signTypedData|signMessage)\b/i],
  ["analytics client", /\b(?:analytics|initAnalytics|startHeartbeat|track\(\"app_open\")\b/i],
  ["normal application shell", /\b(?:GovernanceView|EventInviteView|ProposalDetailView|MunicipalDecisionCasesSection)\b/],
  ["normal civic write model", /\b(?:getTreasury|getProposals|getMaciSignups|grantReward)\b/],
  ["Stadtstack runtime endpoint", /\b(?:roebel-stadtstack\.agentcart\.eu|\/api\/demo\/roebel-marienfelder)\b/i],
];

const ABSOLUTE_NETWORK_ENDPOINT = /\b(?:https?|wss?):\/\//i;

async function listTextFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const location = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTextFiles(location)));
    } else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(location);
    }
  }
  return files;
}

export async function verifyPublicDemoOutput(directory) {
  const files = await listTextFiles(directory);
  if (files.length === 0) {
    throw new Error("public demo output contains no inspectable static files");
  }

  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const [label, pattern] of FORBIDDEN_FINGERPRINTS) {
      if (pattern.test(content)) {
        throw new Error(`public demo output contains forbidden ${label}`);
      }
    }

    // Next's shared runtime legitimately contains framework documentation and
    // compatibility URL strings. The route-owned assets are the meaningful
    // application boundary: they must contain no endpoint at all, while the
    // Nginx CSP below forbids every browser connection at runtime.
    const relative = path.relative(directory, file).split(path.sep).join("/");
    const isRouteOwned =
      relative === "index.html" ||
      /^_next\/static\/chunks\/app\/(?:page|layout)-.+\.js$/.test(relative);
    if (isRouteOwned && ABSOLUTE_NETWORK_ENDPOINT.test(content)) {
      throw new Error("public demo route asset contains forbidden absolute network endpoint");
    }
  }

  return { fileCount: files.length };
}

export async function verifyPreviewNginxPolicy(configPath) {
  const config = await readFile(configPath, "utf8");
  for (const required of [
    "Content-Security-Policy",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ]) {
    if (!config.includes(required)) {
      throw new Error("public demo Nginx policy is missing a required read-only directive");
    }
  }
}

const invokedAsScript = process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename;
if (invokedAsScript) {
  const directory = path.resolve(process.argv[2] ?? "out");
  const configPath = process.argv[3] ? path.resolve(process.argv[3]) : null;
  const result = await verifyPublicDemoOutput(directory);
  if (configPath) await verifyPreviewNginxPolicy(configPath);
  process.stdout.write(`public demo static output: PASS (${result.fileCount} text assets inspected)\n`);
}
