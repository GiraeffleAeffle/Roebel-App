import { createHash } from "node:crypto";
import { readSyntheticBriefResponse, syntheticBriefPath, departmentLabel, DEPARTMENT_LABELS, type SyntheticCitizenBriefBinding } from "@roebel/stadtstack-federation-client";
import type { PublicEvidence, PublicEvidenceQuery, PublicEvidenceSourceAdapter } from "./public-evidence";

const STAGING_WEB_ORIGIN = "http://roebel-web-presentation.stadtstack-roebel-web-preview.svc.cluster.local:8080";

/** An explicit department question should not pick other replies just because
 * their summaries also mention traffic or the common discussion title. */
function requestedDepartments(question: string): Set<string> {
  const selected = new Set<string>();
  const prefixes = /\b(?:fachantwort(?:en)?|fachbereich(?:e|en|s)?|abteilung(?:en)?|was\s+sag(?:t|en))\s+(?:(?:von|vom|der|des|die|dem)\s+)*/giu;
  for (const prefix of question.matchAll(prefixes)) {
    let rest = question.slice(prefix.index! + prefix[0].length);
    while (rest) {
      const match = Object.entries(DEPARTMENT_LABELS).find(([, label]) =>
        rest.toLocaleLowerCase("de-DE").startsWith(label.toLocaleLowerCase("de-DE")) &&
        !/[\p{L}\p{N}]/u.test(rest.charAt(label.length)));
      if (!match) break;
      selected.add(match[0]);
      rest = rest.slice(match[1].length);
      const separator = /^(?:\s*,\s*(?:(?:und|sowie)\s+)?|\s+(?:und|sowie|&)\s+)/iu.exec(rest);
      if (!separator) break;
      rest = rest.slice(separator[0].length);
    }
  }
  return selected;
}
type Config = SyntheticCitizenBriefBinding & {
  environment: "staging"; publicOrigin: string; transport?: "staging_web_service";
};

/** Explicit deployment opt-in. No public query can select a Case or URL. */
export function syntheticBriefConfig(env: Record<string, string | undefined>): Config | undefined {
  const raw = env.MECKY_SYNTHETIC_BRIEF_CONFIG, enabled = env.MECKY_ALLOW_SYNTHETIC_BRIEF;
  if (raw === undefined && enabled === undefined) return undefined;
  if (enabled !== "true" || !raw || raw.length > 4096) throw Error("synthetic_brief_configuration_invalid");
  try {
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).sort().join() !==
      `caseId,discussionId,environment,publicOrigin,topicId${Object.hasOwn(value, "transport") ? ",transport" : ""}` ||
      value.environment !== "staging" || (Object.hasOwn(value, "transport") && value.transport !== "staging_web_service")) throw Error();
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
  const citationUrl = `${pinned.publicOrigin}/app/diskussion/${pinned.discussionId}`;
  const readUrl = pinned.transport === "staging_web_service"
    ? STAGING_WEB_ORIGIN + syntheticBriefPath(pinned.discussionId) : url;
  return Object.freeze({
    sourceKind: "synthetic_citizen_brief" as const,
    async load(query: PublicEvidenceQuery): Promise<readonly PublicEvidence[]> {
      if (query.municipalityId !== municipality) throw Error("synthetic_brief_municipality_mismatch");
      const response = await fetcher(readUrl, { method: "GET", credentials: "omit", redirect: "error", cache: "no-store",
        headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
      const returned = await readSyntheticBriefResponse(response, pinned);
      if (!returned.brief || returned.status !== "current") return [];
      const brief = returned.brief;
      const departments = requestedDepartments(query.question);
      return brief.responses.filter(item => !departments.size || departments.has(item.departmentId)).map(item => {
        const reviewedAt = brief.provenance.packageBindings.find(p => p.departmentId === item.departmentId)!.reviewedAt;
        return {
          evidenceId: `sha256:${createHash("sha256").update(JSON.stringify([returned.returnChecksum, brief.briefChecksum, item.departmentId])).digest("hex")}`,
          municipalityId: returned.municipalityId, sourceKind: "synthetic_citizen_brief", authority: "synthetic_demo",
          title: `Testantwort ${departmentLabel(item.departmentId)} · ${brief.title}`,
          summary: `Geprüfte Testantwort, keine tatsächliche fachamtliche Stellungnahme: ${item.publicSummary}`,
          publishedAt: reviewedAt, reviewedAt, admissionState: "admitted", lifecycle: "current",
          caseId: returned.caseId, caseUrl: citationUrl, briefChecksum: brief.briefChecksum, testOnly: true,
        };
      });
    },
  });
}
