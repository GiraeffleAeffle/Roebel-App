const DEFAULT_RETURN = "/arbeitsbereich";

// The WHATWG URL parser strips every ASCII tab, CR and LF out of a URL
// string wherever they occur — not just at the ends — before it parses
// anything else. A check that runs on the raw string without doing the same
// can be fooled by a value that only *looks* scoped to a path: the control
// character is invisible to a naive startsWith() test yet is gone by the
// time a browser parses the redirect target, so "/\t/evil.example" becomes
// the protocol-relative "//evil.example".
const URL_CONTROL_CHARS = /[\t\r\n]/g;

/**
 * Constrain returnTo to a path on our own origin.
 *
 * The callback appends this to the app origin, so anything that can escape
 * the path is an open redirect — and one that fires the instant a citizen
 * has authenticated, which is the worst possible moment. A protocol-relative
 * "//host" and a backslash variant ("/\host", which browsers treat the same
 * as "//host") both escape while still starting with "/", so a
 * startsWith("/") check alone is not enough — and both can be hidden behind
 * a stripped control character, so that has to be undone first.
 */
export function safeReturnTo(raw: string | null): string {
  if (!raw) return DEFAULT_RETURN;

  const value = raw.trim().replace(URL_CONTROL_CHARS, "");
  if (value.length === 0) return DEFAULT_RETURN;
  if (!value.startsWith("/")) return DEFAULT_RETURN;

  // A second "/" or a "\" right after the leading "/" is protocol-relative
  // once a browser parses it, even though the string still "starts with /".
  const second = value.charAt(1);
  if (second === "/" || second === "\\") return DEFAULT_RETURN;

  return value;
}
