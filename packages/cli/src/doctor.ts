import type { NetizenManifest } from "@netizen-labs/protocol";
import { collectSecretRefs, plan, type Step } from "./render.js";

/**
 * `netizen doctor` — the pure preflight report for a manifest: what secrets must
 * be supplied, which endpoints `up` will verify, the ordered plan, and warnings.
 * Pure (no I/O) so it is fully unit-testable; the CLI layer optionally fetches the
 * endpoints to check reachability.
 */

export interface DoctorEndpoint {
  name: string;
  url: string;
}

export interface DoctorReport {
  node: string;
  secretRefs: string[];
  endpoints: DoctorEndpoint[];
  plan: Step[];
  warnings: string[];
}

export function doctor(m: NetizenManifest): DoctorReport {
  const endpoints: DoctorEndpoint[] = [];
  const add = (name: string, url?: string) => {
    if (url) endpoints.push({ name, url });
  };
  add("idp discovery", m.identity.idp.discovery);
  add("nextcloud", m.services.workspace?.nextcloud);
  add("matrix homeserver", m.services.chat?.matrix?.homeserver);
  add("mas", m.services.chat?.matrix?.mas);
  add("element", m.services.chat?.matrix?.element);

  const warnings: string[] = [];
  if (!m.services.backend) warnings.push("no data backend declared (services.backend) — the community data layer is unmanaged");
  if (m.ai && m.ai.selfHosted === false)
    warnings.push("AI is not self-hosted — model calls egress off-node; confirm ai.sovereignty.dataEgressPolicy");
  if (m.identity.authBridge.provider === "thirdweb")
    warnings.push("authBridge.provider is 'thirdweb' — a third-party mints accounts; flip to 'netizen' for full wallet sovereignty");
  if (m.services.chat?.matrix && !m.services.chat?.nostr)
    warnings.push("Matrix present but no Nostr relay — agents-as-members transport unavailable");

  return { node: m.id, secretRefs: collectSecretRefs(m), endpoints, plan: plan(m), warnings };
}

/** Render a DoctorReport as human-readable text for the CLI. */
export function formatDoctorReport(r: DoctorReport): string {
  const lines = [`node: ${r.node}`, ""];
  lines.push(`secrets to supply (${r.secretRefs.length}):`, ...r.secretRefs.map((s) => `  - ${s}`), "");
  lines.push(`endpoints to verify (${r.endpoints.length}):`, ...r.endpoints.map((e) => `  - ${e.name}: ${e.url}`), "");
  lines.push(`plan (${r.plan.length} steps):`, ...r.plan.map((s, i) => `  ${i + 1}. [${s.phase}] ${s.title}`), "");
  lines.push(`warnings (${r.warnings.length}):`, ...r.warnings.map((w) => `  ! ${w}`));
  return lines.join("\n") + "\n";
}

/** A discrepancy between what the manifest declares and what the keystone serves. */
export interface DriftFinding {
  field: string;
  expected: string;
  actual: string;
}

/** The subset of an OIDC discovery document we compare against the manifest. */
export interface LiveDiscovery {
  issuer?: string;
  authorization_endpoint?: string;
  scopes_supported?: string[];
  claims_supported?: string[];
}

/**
 * Compare live OIDC discovery against the manifest.
 *
 * Pure, so it is testable without a network. This catches the class of failure
 * that bit the Röbel node twice — the keystone advertising a different `issuer`
 * than the manifest declares, and a stale registered redirect URI. Both surfaced
 * only as an opaque login error AFTER a human clicked a button; both are visible
 * here in one request.
 */
export function detectIdpDrift(m: NetizenManifest, live: LiveDiscovery | null): DriftFinding[] {
  if (!live) return [{ field: "discovery", expected: m.identity.idp.discovery, actual: "unreachable" }];
  const findings: DriftFinding[] = [];

  if (live.issuer && live.issuer !== m.identity.idp.issuer) {
    findings.push({ field: "issuer", expected: m.identity.idp.issuer, actual: live.issuer });
  }
  // A relying party whose redirect URI the keystone does not know fails with
  // `invalid_redirect_uri` at login time.
  const authHost = live.authorization_endpoint ? safeHost(live.authorization_endpoint) : "";
  const issuerHost = safeHost(m.identity.idp.issuer);
  if (authHost && issuerHost && authHost !== issuerHost) {
    findings.push({ field: "authorization_endpoint host", expected: issuerHost, actual: authHost });
  }
  for (const scope of m.identity.idp.scopes) {
    if (live.scopes_supported && !live.scopes_supported.includes(scope)) {
      findings.push({ field: `scope:${scope}`, expected: "supported", actual: "missing" });
    }
  }
  // `groups` drives workspace authorisation (org:<id>:<role> -> group folders and
  // rooms). If the keystone stops emitting it, access silently degrades.
  for (const claim of m.identity.idp.claims) {
    if (live.claims_supported && !live.claims_supported.includes(claim)) {
      findings.push({ field: `claim:${claim}`, expected: "supported", actual: "missing" });
    }
  }
  return findings;
}

function safeHost(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return "";
  }
}

/** Fetch discovery and report drift. Network-touching wrapper around detectIdpDrift. */
export async function checkIdpDrift(m: NetizenManifest): Promise<DriftFinding[]> {
  let live: LiveDiscovery | null = null;
  try {
    const res = await fetch(m.identity.idp.discovery, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) live = (await res.json()) as LiveDiscovery;
  } catch {
    live = null;
  }
  return detectIdpDrift(m, live);
}
