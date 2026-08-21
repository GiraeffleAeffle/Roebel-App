/**
 * Ancillary home-feed reads must never be able to keep the ordinary post feed
 * in its loading state. Supabase query builders are PromiseLike, so this
 * helper accepts them without coupling the page to a particular client.
 */
export const HOME_FEED_ANCILLARY_TIMEOUT_MS = 5_000;

export async function settleHomeFeedAncillary<T>(
  request: PromiseLike<T>,
  fallback: T,
  timeoutMs = HOME_FEED_ANCILLARY_TIMEOUT_MS
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      Promise.resolve(request),
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } catch {
    return fallback;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
