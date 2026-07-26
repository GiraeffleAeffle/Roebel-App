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
