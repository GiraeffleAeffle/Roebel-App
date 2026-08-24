/**
 * Captures the pathname the app cold-booted into, exactly once per JS process.
 *
 * `app/_layout.tsx`'s `ThemedLayout` (an ancestor of every screen, mounted once
 * per session) writes `pathname` here during its own render — before React
 * descends into rendering whichever screen the router matched — so by the time
 * that screen's component body runs, `bootState.pathname` is already correct
 * if (and only if) that screen IS the one the app cold-booted into.
 *
 * `app/index.tsx` reads this to tell "cold start resolved to `/`" apart from
 * "the user navigated back to `/` later in the session" without ever mounting
 * the feed screen on the former.
 */
export const bootState: { pathname: string | null; captured: boolean } = {
  pathname: null,
  captured: false,
};
