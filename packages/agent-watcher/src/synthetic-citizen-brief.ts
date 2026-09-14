import { createHash } from "node:crypto";
import { readSyntheticBriefResponse, syntheticBriefPath, type SyntheticCitizenBriefBinding } from "@roebel/stadtstack-federation-client";
import type { PublicEvidence, PublicEvidenceQuery, PublicEvidenceSourceAdapter } from "./public-evidence";

type Config = SyntheticCitizenBriefBinding & { environment: "staging"; publicOrigin: string };

/** Explicit deployment opt-in. No public query can select a Case or URL. */
export function syntheticBriefConfig(env: Record<string, string | undefined>): Config | undefined {
  const raw = env.MECKY_SYNTHETIC_BRIEF_CONFIG, enabled = env.MECKY_ALLOW_SYNTHETIC_BRIEF;
  if (raw === undefined && enabled === undefined) return undefined;
  if (enabled !== "true" || !raw || raw.length > 4096) throw Error("synthetic_brief_configuration_invalid");
  try {
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).sort().join() !== "caseId,discussionId,environment,publicOrigin,topicId" || value.environment !== "staging") throw Error();
    const url = new URL(value.publicOrigin);
    if (url.origin !== value.publicOrigin || url.protocol !== "https:" || url.username || url.password ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || url.hostname.endsWith(".local") ||
      !/^urn:stadtstack:synthetic-case:municipality:[a-z0-9-]+:[0-9a-f-]{36}$/.test(value.caseId) ||
      !/^urn:stadtstack:topic:municipality:[a-z0-9-]+:[a-z0-9-]+$/.test(value.topicId)) throw Error();
    syntheticBriefPath(value.discussionId);
    return Object.freeze(value) as Config;
  } catch { throw Error("synthetic_brief_configuration_invalid"); }
}

export function createSyntheticBriefEvidenceAdapter(config: Config, fetcher: typeof fetch = fetch): PublicEvidenceSourceAdapter {
  // Validate injected config through the same closed deployment boundary.
  const pinned = syntheticBriefConfig({ MECKY_ALLOW_SYNTHETIC_BRIEF: "true", MECKY_SYNTHETIC_BRIEF_CONFIG: JSON.stringify(config) })!;
  const municipality = pinned.caseId.split(":")[4]!;
  const url = pinned.publicOrigin + syntheticBriefPath(pinned.discussionId);
  return Object.freeze({
    sourceKind: "synthetic_citizen_brief" as const,
    async load(query: PublicEvidenceQuery): Promise<readonly PublicEvidence[]> {
      if (query.municipalityId !== municipality) throw Error("synthetic_brief_municipality_mismatch");
      const response = await fetcher(url, { method: "GET", credentials: "omit", redirect: "error", cache: "no-store",
        headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
      const returned = await readSyntheticBriefResponse(response, pinned);
      if (!returned.brief || returned.status !== "current") return [];
      const brief = returned.brief;
      return brief.responses.map(item => {
        const reviewedAt = brief.provenance.packageBindings.find(p => p.departmentId === item.departmentId)!.reviewedAt;
        return {
          evidenceId: `sha256:${createHash("sha256").update(JSON.stringify([returned.returnChecksum, brief.briefChecksum, item.departmentId])).digest("hex")}`,
          municipalityId: returned.municipalityId, sourceKind: "synthetic_citizen_brief", authority: "synthetic_demo",
          title: `Synthetischer Test: ${brief.title} · ${item.departmentId}`,
          summary: `Geprüfte Testantwort, keine tatsächliche fachamtliche Stellungnahme: ${item.publicSummary}`,
          publishedAt: reviewedAt, reviewedAt, admissionState: "admitted", lifecycle: "current",
          caseId: returned.caseId, caseUrl: url, briefChecksum: brief.briefChecksum, testOnly: true,
        };
      });
    },
  });
}
