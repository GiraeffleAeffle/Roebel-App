/**
 * Recover the canonical topic identity from a Next.js dynamic route segment.
 *
 * Topic links encode the URN as one safe path segment. Client pages receive
 * that segment still encoded, so decode it exactly once before another client
 * turns the identity into an API path.
 */
export function civicTopicIdFromRouteParam(routeParam: string): string {
  return decodeURIComponent(routeParam);
}
