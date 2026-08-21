export type CivicDiscussionLinkInput = {
  municipalityId: string;
  sourceCaseId: string;
  canonicalCaseId: string;
  title: string;
};

const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Build the host-owned route into the signed civic discussion composer.
 *
 * This first permanent slice is deliberately Röbel-only. The canonical Case
 * identifier must repeat the same municipality, so neither provider text nor
 * a malformed URL can silently redirect a citizen's signature to another
 * workflow.
 */
export function buildCivicDiscussionDeepLink(
  input: CivicDiscussionLinkInput,
): string {
  const canonical = input.canonicalCaseId.split(":");
  if (
    input.municipalityId !== "roebel-mueritz" ||
    !SLUG.test(input.sourceCaseId) ||
    canonical.length !== 6 ||
    canonical.slice(0, 4).join(":") !==
      "urn:stadtstack:case:municipality" ||
    canonical[4] !== input.municipalityId ||
    !UUID_V7.test(canonical[5] ?? "") ||
    input.title !== input.title.trim() ||
    input.title.length === 0 ||
    input.title.length > 240
  ) {
    throw new Error("civic_discussion_link_invalid");
  }

  const params = new URLSearchParams([
    ["municipality", input.municipalityId],
    ["case", input.sourceCaseId],
    ["stadtstackCase", input.canonicalCaseId],
    ["title", input.title],
  ]);
  return `roebel://civic-discussion?${params.toString()}`;
}
