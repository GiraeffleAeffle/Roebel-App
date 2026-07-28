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
  sovereignty: SovereigntyLayer[];
}

/**
 * One layer of the stack and whether this node actually controls it.
 *
 * Sovereignty is otherwise argued about in prose. This turns it into a number
 * you can watch move: an agent (or a human) reads the same manifest and gets the
 * same verdict, so "are we more sovereign than last month" has an answer.
 */
export interface SovereigntyLayer {
  layer: string;
  /** Who runs it today. "self" means on infrastructure the community owns. */
  provider: string;
  /** True only when losing the vendor would NOT take the node down. */
  sovereign: boolean;
  note: string;
}

/**
 * Derive the vendor-dependency posture from the manifest alone.
 *
 * Deliberately pessimistic: a layer counts as sovereign only when the community
 * could keep running it after a vendor withdrew. "We could migrate" is not
 * sovereignty; "it already runs on our hardware" is.
 */
export function sovereigntyReport(m: NetizenManifest): SovereigntyLayer[] {
  const out: SovereigntyLayer[] = [];

  out.push({
    layer: "hosting",
    provider: m.services.host.provider,
    // Rented hardware you can re-provision from a manifest is as sovereign as
    // infrastructure gets short of owning the building.
    sovereign: true,
    note: `own box, ${m.services.host.region}; the installer can rebuild it elsewhere`,
  });

  // Identity is optional: a relay-only node has no issuer and no account minter.
  // Such layers are OMITTED rather than scored false — the score is "layers under
  // own control", so counting a layer the node never claimed to run would penalise
  // it for a choice it made deliberately. Contrast `durability` below, where
  // absence IS the finding.
  if (m.identity) {
    const idpExternal = m.identity.idp.hosted === "external";
    out.push({
      layer: "identity-issuer",
      provider: idpExternal ? "external keystone" : "self",
      sovereign: true,
      note: `${m.identity.idp.issuer} — the node owns its own OIDC issuer`,
    });

    // The account minter is the deepest lock-in: it determines every citizen's
    // ADDRESS, and an address change orphans soulbound memberships and balances.
    const bridge = m.identity.authBridge.provider;
    out.push({
      layer: "identity-keys",
      provider: bridge,
      sovereign: bridge !== "thirdweb",
      note:
        bridge === "thirdweb"
          ? "a third party mints citizen accounts; changing it changes addresses (soulbound NFTs, Circles balances, MACI signups)"
          : "the node mints its own accounts",
    });
  }

  const backend = m.services.backend?.provider;
  out.push({
    layer: "data",
    provider: backend ?? "undeclared",
    sovereign: backend === "postgres",
    note:
      backend === "supabase"
        ? "community data lives in managed SaaS — the spine of the app is not on the node"
        : backend === "postgres"
          ? "data on the node's own Postgres"
          : "no backend declared",
  });

  out.push({
    layer: "workspace",
    provider: m.services.workspace?.nextcloud ? "self" : "none",
    sovereign: !!m.services.workspace?.nextcloud,
    note: m.services.workspace?.nextcloud ? "Nextcloud/Collabora on the node" : "no workspace declared",
  });

  const relay = m.services.chat?.nostr?.relay;
  out.push({
    layer: "comms",
    provider: relay ? "self" : "none",
    sovereign: !!relay,
    note: relay ? `own relay at ${relay}` : "no self-hosted relay declared",
  });

  const aiSelf = m.ai?.selfHosted === true;
  out.push({
    layer: "ai",
    provider: aiSelf ? "self" : (m.ai?.gateway ?? "none"),
    sovereign: aiSelf,
    note: aiSelf
      ? `gateway on the node (${m.ai?.sovereignty?.tier ?? "tier unset"})`
      : `model calls egress off-node; egress policy: ${m.ai?.sovereignty?.dataEgressPolicy ?? "unset"}`,
  });

  // Durability is a sovereignty layer, not an ops afterthought: a node you
  // cannot restore from is less sovereign than the SaaS it replaced.
  const backup = m.operations?.backup;
  const offsite = backup?.offsite && backup.offsite !== "none";
  out.push({
    layer: "durability",
    provider: backup ? (offsite ? "self+offsite" : "self (on-box only)") : "none",
    sovereign: !!backup && !!offsite,
    note: !backup
      ? "NO BACKUPS DECLARED — one disk failure from losing everything"
      : offsite
        ? `nightly ${backup.schedule ?? "02:30"}, ${backup.offsite}; verify ops/status.json reports offsite "ok", not "unconfigured"`
        : "backups exist but never leave the box; a snapshot on the same provider dies with the account",
  });

  return out;
}

export function doctor(m: NetizenManifest): DoctorReport {
  const endpoints: DoctorEndpoint[] = [];
  const add = (name: string, url?: string) => {
    if (url) endpoints.push({ name, url });
  };
  add("idp discovery", m.identity?.idp.discovery);
  add("nextcloud", m.services.workspace?.nextcloud);
  add("matrix homeserver", m.services.chat?.matrix?.homeserver);
  add("mas", m.services.chat?.matrix?.mas);
  add("element", m.services.chat?.matrix?.element);

  const warnings: string[] = [];
  if (!m.services.backend) warnings.push("no data backend declared (services.backend) — the community data layer is unmanaged");
  if (m.ai && m.ai.selfHosted === false)
    warnings.push("AI is not self-hosted — model calls egress off-node; confirm ai.sovereignty.dataEgressPolicy");
  if (m.identity?.authBridge.provider === "thirdweb")
    warnings.push("authBridge.provider is 'thirdweb' — a third-party mints accounts; flip to 'netizen' for full wallet sovereignty");
  if (m.services.chat?.matrix && !m.services.chat?.nostr)
    warnings.push("Matrix present but no Nostr relay — agents-as-members transport unavailable");
  // Durability warnings rank first in severity: everything else is recoverable.
  if (!m.operations?.backup)
    warnings.push("no backups declared (operations.backup) — a node you cannot restore from is less sovereign than the SaaS it replaced");
  else if (!m.operations.backup.offsite || m.operations.backup.offsite === "none")
    warnings.push("backups never leave the box (operations.backup.offsite) — a snapshot on the same provider dies with the account");
  if (!m.operations?.hardening)
    warnings.push("no hardening declared (operations.hardening) — SSH policy and fail2ban are left to whoever remembers");

  return {
    node: m.id,
    secretRefs: collectSecretRefs(m),
    endpoints,
    plan: plan(m),
    warnings,
    sovereignty: sovereigntyReport(m),
  };
}

/** Render a DoctorReport as human-readable text for the CLI. */
export function formatDoctorReport(r: DoctorReport): string {
  const lines = [`node: ${r.node}`, ""];
  lines.push(`secrets to supply (${r.secretRefs.length}):`, ...r.secretRefs.map((s) => `  - ${s}`), "");
  lines.push(`endpoints to verify (${r.endpoints.length}):`, ...r.endpoints.map((e) => `  - ${e.name}: ${e.url}`), "");
  lines.push(`plan (${r.plan.length} steps):`, ...r.plan.map((s, i) => `  ${i + 1}. [${s.phase}] ${s.title}`), "");
  const own = r.sovereignty.filter((s) => s.sovereign).length;
  lines.push(
    `sovereignty (${own}/${r.sovereignty.length} layers under own control):`,
    ...r.sovereignty.map((s) => `  ${s.sovereign ? "✓" : "✗"} ${s.layer}: ${s.provider} — ${s.note}`),
    "",
  );
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
  // A node without an IdP cannot drift from one. Nothing declared, nothing to check.
  if (!m.identity) return [];
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
    if (!m.identity) throw new Error("no idp declared");
    const res = await fetch(m.identity.idp.discovery, { signal: AbortSignal.timeout(15_000) });
    if (res.ok) live = (await res.json()) as LiveDiscovery;
  } catch {
    live = null;
  }
  return detectIdpDrift(m, live);
}
