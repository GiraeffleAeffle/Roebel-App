/**
 * Keep public-feed API requests bounded even when the namespace-local reader
 * loses its connection and never settles. The client has a slightly longer
 * deadline so it can receive this explicit 503 instead of aborting first.
 *
 * The reader is intentionally not cancelled here: the current action readers
 * do not expose an AbortSignal seam. This bounds the HTTP response; a future
 * reader can add cancellation without changing the route contract.
 */
export const PUBLIC_FEED_SERVER_DEADLINE_MS = 7_000;

export type PublicFeedDeadlineResult<T> =
  | { timedOut: false; value: T }
  | { timedOut: true };

export type PublicFeedReader<T> = () => PromiseLike<T> | T;

export async function withPublicFeedServerDeadline<T>(
  operation: PublicFeedReader<T>,
  timeoutMs = PUBLIC_FEED_SERVER_DEADLINE_MS
): Promise<PublicFeedDeadlineResult<T>> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race<PublicFeedDeadlineResult<T>>([
      Promise.resolve()
        .then(operation)
        .then(
          (value) => ({
            timedOut: false as const,
            value,
          }),
          () => ({ timedOut: true as const })
        ),
      new Promise<PublicFeedDeadlineResult<T>>((resolve) => {
        timeout = setTimeout(() => resolve({ timedOut: true }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
