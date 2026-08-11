import type { CivicCaseBinding } from '@netizen-labs/nostr';

export type PreparedCivicDiscussionPost = {
  binding: CivicCaseBinding;
  title: string;
  content: string;
};

export type CivicDiscussionRoute = Omit<
  PreparedCivicDiscussionPost,
  'content'
>;

const ROUTE_KEYS = ['case', 'municipality', 'stadtstackCase', 'title'];
const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const UUID_V7 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Turn untrusted deep-link values plus the citizen's words into the one closed
 * payload accepted by the civic Nostr publisher. This module neither reads a
 * wallet nor publishes; the UI owns those effects only after this validation.
 */
export function parseCivicDiscussionRoute(
  routeInput: unknown,
): CivicDiscussionRoute {
  if (
    !routeInput ||
    typeof routeInput !== 'object' ||
    Object.getPrototypeOf(routeInput) !== Object.prototype
  ) {
    throw new Error('civic_discussion_input_invalid');
  }
  const route = routeInput as Record<string, unknown>;
  if (
    Object.keys(route).sort().join('|') !== ROUTE_KEYS.join('|') ||
    typeof route.municipality !== 'string' ||
    typeof route.case !== 'string' ||
    typeof route.stadtstackCase !== 'string' ||
    typeof route.title !== 'string'
  ) {
    throw new Error('civic_discussion_input_invalid');
  }

  const canonical = route.stadtstackCase.split(':');
  if (
    route.municipality !== 'roebel-mueritz' ||
    !SLUG.test(route.case) ||
    canonical.length !== 6 ||
    canonical.slice(0, 4).join(':') !==
      'urn:stadtstack:case:municipality' ||
    canonical[4] !== route.municipality ||
    !UUID_V7.test(canonical[5] ?? '') ||
    route.title !== route.title.trim() ||
    route.title.length === 0 ||
    route.title.length > 240
  ) {
    throw new Error('civic_discussion_input_invalid');
  }

  return {
    binding: {
      municipalityId: route.municipality,
      sourceCaseId: route.case,
      canonicalCaseId: route.stadtstackCase,
    },
    title: route.title,
  };
}

export function prepareCivicDiscussionPost(
  routeInput: unknown,
  question: string,
): PreparedCivicDiscussionPost {
  const parsed = parseCivicDiscussionRoute(routeInput);
  if (
    typeof question !== 'string' ||
    question !== question.trim() ||
    question.length === 0 ||
    question.length > 1_500
  ) {
    throw new Error('civic_discussion_input_invalid');
  }
  return { ...parsed, content: `@Mecky, ${question}` };
}
