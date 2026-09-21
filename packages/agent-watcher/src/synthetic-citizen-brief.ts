import { createHash } from "node:crypto";
import { readSyntheticBriefResponse, syntheticBriefPath, departmentLabel, departmentSummaryText, DEPARTMENT_LABELS, type SyntheticCitizenBriefBinding } from "@roebel/stadtstack-federation-client";
import type { PublicEvidence, PublicEvidenceQuery, PublicEvidenceSourceAdapter } from "./public-evidence";
import type { PublicDiscussionContext } from "./public-discussion-context";

type ReadDiscussionContext = (discussionId: string) => Promise<PublicDiscussionContext>;

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
  additionalBindings?: readonly SyntheticCitizenBriefBinding[];
};

/** Explicit deployment opt-in. A query can filter these bindings, never add a URL. */
export function syntheticBriefConfig(env: Record<string, string | undefined>): Config | undefined {
  const raw = env.MECKY_SYNTHETIC_BRIEF_CONFIG, enabled = env.MECKY_ALLOW_SYNTHETIC_BRIEF;
  if (raw === undefined && enabled === undefined) return undefined;
  if (enabled !== "true" || !raw || raw.length > 4096) throw Error("synthetic_brief_configuration_invalid");
  try {
    const value = JSON.parse(raw);
    if (!value || Object.keys(value).sort().join() !== ["caseId", "discussionId", "environment", "publicOrigin", "topicId",
      ...(Object.hasOwn(value, "transport") ? ["transport"] : []), ...(Object.hasOwn(value, "additionalBindings") ? ["additionalBindings"] : [])].sort().join() ||
      value.environment !== "staging" || (Object.hasOwn(value, "transport") && value.transport !== "staging_web_service")) throw Error();
    const url = new URL(value.publicOrigin);
    if (url.origin !== value.publicOrigin || url.protocol !== "https:" || url.username || url.password ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(url.hostname) || url.hostname.endsWith(".local") ||
      !/^urn:stadtstack:synthetic-case:municipality:[a-z0-9-]+:[0-9a-f-]{36}$/.test(value.caseId) ||
      !/^urn:stadtstack:topic:municipality:[a-z0-9-]+:[a-z0-9-]+$/.test(value.topicId)) throw Error();
    syntheticBriefPath(value.discussionId);
    const municipality = value.caseId.split(":")[4];
    if (value.topicId.split(":")[4] !== municipality) throw Error();
    const additional = value.additionalBindings ?? [];
    if (!Array.isArray(additional) || additional.length > 7 || (Object.hasOwn(value, "additionalBindings") && value.additionalBindings === null)) throw Error();
    const caseIds = new Set([value.caseId]), discussions = new Set([value.discussionId]);
    for (const binding of additional) {
      if (!binding || Object.keys(binding).sort().join() !== "caseId,discussionId,topicId" ||
        !/^urn:stadtstack:synthetic-case:municipality:[a-z0-9-]+:[0-9a-f-]{36}$/.test(binding.caseId) ||
        !/^urn:stadtstack:topic:municipality:[a-z0-9-]+:[a-z0-9-]+$/.test(binding.topicId) ||
        binding.caseId.split(":")[4] !== municipality || binding.topicId.split(":")[4] !== municipality ||
        caseIds.has(binding.caseId) || discussions.has(binding.discussionId)) throw Error();
      syntheticBriefPath(binding.discussionId);
      caseIds.add(binding.caseId); discussions.add(binding.discussionId); Object.freeze(binding);
    }
    if (value.additionalBindings) Object.freeze(value.additionalBindings);
    return Object.freeze(value) as Config;
  } catch { throw Error("synthetic_brief_configuration_invalid"); }
}

const GENERIC_TITLE_WORDS = new Set([
  "test", "testablauf", "testfall", "staging", "synthetic", "synthetisch", "synthetischer",
  "demo", "review", "proposal", "prufen", "prufung", "empfehlung", "burgerrat",
  "robel", "muritz", "stadt", "gemeinde", "the", "from", "with", "nach", "vorbild",
  "eine", "einer", "einem", "einen", "diesem", "dieser", "diese", "wird", "wurde", "werden",
  "oder", "soll", "sollen", "kann", "sind", "haben", "auch", "alle", "noch", "nicht",
]);

function titleTerms(value: string): string[] {
  // B 198 and B-198 name the same road. Generic process words must not make
  // an unrelated Case relevant merely because it is the only available Brief.
  return value.toLocaleLowerCase("de-DE").normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/\b([a-z])[-\s]+(\d+)/gu, "$1$2").split(/[^\p{L}\p{N}]+/u)
    .filter(term => term.length >= 4 && !/^\d+$/u.test(term) && !GENERIC_TITLE_WORDS.has(term));
}

function identifiesBrief(query: PublicEvidenceQuery, pinned: Omit<Config, "additionalBindings">, title: string): boolean {
  if (query.discussionId !== undefined) return query.discussionId === pinned.discussionId;
  const question = query.context?.question ?? query.question;
  if ([pinned.discussionId, pinned.caseId, pinned.topicId].some(id => question.includes(id))) return true;
  const requested = new Set(titleTerms(question));
  return titleTerms(title).some(term => requested.has(term) || requested.has(term + "s") ||
    (term.endsWith("s") && requested.has(term.slice(0, -1))));
}

function createPinnedBriefReader(pinned: Omit<Config, "additionalBindings">, fetcher: typeof fetch,
  readDiscussionContext?: ReadDiscussionContext): PublicEvidenceSourceAdapter {
  const municipality = pinned.caseId.split(":")[4]!;
  const url = pinned.publicOrigin + syntheticBriefPath(pinned.discussionId);
  const citationUrl = `${pinned.publicOrigin}/app/diskussion/${pinned.discussionId}`;
  const readUrl = pinned.transport === "staging_web_service"
    ? STAGING_WEB_ORIGIN + syntheticBriefPath(pinned.discussionId) : url;
  return Object.freeze({
    sourceKind: "synthetic_citizen_brief" as const,
    async load(query: PublicEvidenceQuery): Promise<readonly PublicEvidence[]> {
      if (query.municipalityId !== municipality) throw Error("synthetic_brief_municipality_mismatch");
      if (query.discussionId !== undefined && query.discussionId !== pinned.discussionId) return [];
      const response = await fetcher(readUrl, { method: "GET", credentials: "omit", redirect: "error", cache: "no-store",
        headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) });
      const returned = await readSyntheticBriefResponse(response, pinned);
      if (!returned.brief || returned.status !== "current") return [];
      const brief = returned.brief;
      if (!identifiesBrief(query, pinned, brief.title)) {
        if (!readDiscussionContext) return [];
        // A proposal may have a generic title even when citizens know its topic
        // by name. Resolve that name from the existing signature-verifying reader,
        // never from incidental words in responses or a caller-supplied alias.
        const context = await readDiscussionContext(pinned.discussionId);
        const tags = context.rootEvent.tags;
        const exactTag = (name: string, value: string) => {
          const found = tags.filter(tag => tag[0] === name);
          return found.length === 1 && found[0]!.length === 2 && found[0]![1] === value;
        };
        const titles = tags.filter(tag => tag[0] === "topic-title");
        if (context.rootEvent.id !== pinned.discussionId || !exactTag("municipality", municipality) ||
          !exactTag("topic", pinned.topicId) || titles.length !== 1 || titles[0]!.length !== 2 ||
          !identifiesBrief(query, pinned, titles[0]![1]!)) return [];
      }
      const departments = requestedDepartments(query.context?.question ?? query.question);
      return brief.responses.filter(item => !departments.size || departments.has(item.departmentId)).map(item => {
        const reviewedAt = brief.provenance.packageBindings.find(p => p.departmentId === item.departmentId)!.reviewedAt;
        return {
          evidenceId: `sha256:${createHash("sha256").update(JSON.stringify([returned.returnChecksum, brief.briefChecksum, item.departmentId])).digest("hex")}`,
          municipalityId: returned.municipalityId, sourceKind: "synthetic_citizen_brief", authority: "synthetic_demo",
          title: `Fachantwort ${departmentLabel(item.departmentId)} · ${brief.title}`,
          summary: departmentSummaryText(item.publicSummary),
          publishedAt: reviewedAt, reviewedAt, admissionState: "admitted", lifecycle: "current",
          caseId: returned.caseId, caseUrl: citationUrl, briefChecksum: brief.briefChecksum, testOnly: true,
        };
      });
    },
  });
}

/** Each configured Case is read independently so withdrawal or an outage cannot
 * substitute another Case's response or retain a stale cached answer. */
export function createSyntheticBriefEvidenceAdapter(config: Config, fetcher: typeof fetch = fetch,
  readDiscussionContext?: ReadDiscussionContext): PublicEvidenceSourceAdapter {
  const { additionalBindings = [], ...primary } = syntheticBriefConfig({ MECKY_ALLOW_SYNTHETIC_BRIEF: "true",
    MECKY_SYNTHETIC_BRIEF_CONFIG: JSON.stringify(config) })!;
  const readers = [primary, ...additionalBindings.map(binding => ({ ...primary, ...binding }))]
    .map(binding => createPinnedBriefReader(binding, fetcher, readDiscussionContext));
  return Object.freeze({ sourceKind: "synthetic_citizen_brief" as const,
    async load(query: PublicEvidenceQuery): Promise<readonly unknown[]> {
      const results = await Promise.allSettled(readers.map(reader => reader.load(query)));
      const available = results.filter(result => result.status === "fulfilled");
      if (!available.length) throw Error("synthetic_brief_unavailable");
      return available.flatMap(result => result.value);
    },
  });
}
