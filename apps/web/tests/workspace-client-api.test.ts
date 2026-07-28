import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  WORKSPACE_HOP_KEY,
  breadcrumbs,
  buildFilesQuery,
  classifyFilesResponse,
  describeWorkspaceError,
  formatSize,
  hasTriedLoginHop,
  hopMarkerStore,
  loginRedirect,
  markLoginHop,
  parentPath,
  releaseLoginHop,
  workspaceLinkOut,
  type HopMarkerStore,
} from "../src/lib/workspace/client-api";

describe("buildFilesQuery", () => {
  it("omits org parameters for a personal scope", () => {
    assert.equal(buildFilesQuery({ scope: "personal", path: "Dokumente" }), "path=Dokumente");
  });

  it("carries the org identity for an org scope", () => {
    const q = new URLSearchParams(
      buildFilesQuery({
        scope: "org",
        accountId: "acc-7",
        path: "Protokolle",
      }),
    );
    assert.equal(q.get("scope"), "org");
    assert.equal(q.get("accountId"), "acc-7");
    assert.equal(q.get("path"), "Protokolle");
  });

  // The server derives an org's folder identity from accountId alone (see
  // resolveScope's incident writeup) — orgName has no FileScopeParams field
  // to carry it, so there is no way to even construct a query that sends one.
  it("never sends an orgName parameter — there is no field for it", () => {
    const q = new URLSearchParams(
      buildFilesQuery({ scope: "org", accountId: "acc-7", path: "" }),
    );
    assert.equal(q.has("orgName"), false);
  });

  it("encodes a path with spaces and a hash", () => {
    const q = new URLSearchParams(
      buildFilesQuery({ scope: "personal", path: "Meine Akten/Bericht #1.odt" }),
    );
    assert.equal(q.get("path"), "Meine Akten/Bericht #1.odt");
  });
});

describe("breadcrumbs", () => {
  it("starts at the workspace root", () => {
    assert.deepEqual(breadcrumbs(""), [{ label: "Arbeitsbereich", path: "" }]);
  });

  it("accumulates each segment's own path", () => {
    assert.deepEqual(breadcrumbs("Dokumente/2026/Q3"), [
      { label: "Arbeitsbereich", path: "" },
      { label: "Dokumente", path: "Dokumente" },
      { label: "2026", path: "Dokumente/2026" },
      { label: "Q3", path: "Dokumente/2026/Q3" },
    ]);
  });
});

describe("parentPath", () => {
  it("drops the last segment", () => {
    assert.equal(parentPath("Dokumente/2026/Q3"), "Dokumente/2026");
  });

  it("returns the root from a first-level folder", () => {
    assert.equal(parentPath("Dokumente"), "");
  });

  it("stays at the root", () => {
    assert.equal(parentPath(""), "");
  });
});

describe("formatSize", () => {
  it("uses German decimal separators", () => {
    assert.equal(formatSize(1536), "1,5 KB");
    assert.equal(formatSize(5_242_880), "5,0 MB");
  });

  it("shows bytes without a decimal", () => {
    assert.equal(formatSize(512), "512 B");
  });

  it("shows an em dash for a directory's zero size", () => {
    assert.equal(formatSize(0), "—");
  });
});

describe("loginRedirect", () => {
  it("returns to the current page after the OIDC hop", () => {
    assert.equal(
      loginRedirect("/arbeitsbereich/dateien"),
      "/api/workspace/auth/login?returnTo=%2Farbeitsbereich%2Fdateien",
    );
  });
});

describe("describeWorkspaceError", () => {
  it("names an expired session", () => {
    assert.equal(
      describeWorkspaceError(401),
      "Deine Sitzung ist abgelaufen. Bitte lade die Seite neu und melde dich erneut an.",
    );
  });

  it("names a forbidden scope, without deciding access itself", () => {
    assert.equal(describeWorkspaceError(403), "Du hast keinen Zugriff auf diesen Bereich.");
  });

  it("names a locked file", () => {
    assert.equal(
      describeWorkspaceError(423),
      "Die Datei ist gerade gesperrt. Versuche es in Kürze erneut.",
    );
  });

  it("names exhausted storage", () => {
    assert.equal(describeWorkspaceError(507), "Kein Speicherplatz mehr verfügbar.");
  });

  it("falls back to a generic message for anything else", () => {
    assert.equal(
      describeWorkspaceError(500),
      "Das hat leider nicht geklappt. Bitte versuche es erneut.",
    );
    assert.equal(
      describeWorkspaceError(404),
      "Das hat leider nicht geklappt. Bitte versuche es erneut.",
    );
  });
});

// FileBrowser's whole branch table, extracted so it can be tested at all —
// the component itself imports React and cannot run under this harness.
describe("classifyFilesResponse", () => {
  it("routes 503 to the link-out fallback, NOT to the OIDC hop", () => {
    // The merge-day case. /api/workspace/auth/login is exactly as unconfigured
    // as /api/workspace/files, so hopping is a guaranteed dead end — and
    // before the gate existed it was a Next 500 rather than a dead end.
    assert.equal(classifyFilesResponse(503, false), "unconfigured");
    assert.equal(classifyFilesResponse(503, true), "unconfigured");
  });

  it("answers the FIRST 401 with a hop", () => {
    assert.equal(classifyFilesResponse(401, false), "hop");
  });

  // errorResponse maps a Nextcloud 401 to a 401 so a stale session self-heals.
  // But user_oidc rejecting the bearer token produces the same 401, and no
  // amount of re-authenticating fixes it — so the naive rule loops, and each
  // lap INSERTs another workspace_sessions row holding a live refresh token.
  it("answers the SECOND consecutive 401 with an error, not another hop", () => {
    assert.equal(classifyFilesResponse(401, true), "auth-error");
  });

  // 403 is an access decision the server already made (wrong org, or not a
  // verified citizen). Sending that person round the login loop would never
  // change the answer.
  it("never hops on 403, however many hops have been tried", () => {
    assert.equal(classifyFilesResponse(403, false), "error");
    assert.equal(classifyFilesResponse(403, true), "error");
  });

  it("treats the 2xx range as ok", () => {
    for (const status of [200, 201, 204, 207, 299]) {
      assert.equal(classifyFilesResponse(status, false), "ok", `for ${status}`);
    }
  });

  it("folds every other failure into a plain error", () => {
    for (const status of [400, 404, 415, 423, 500, 502, 507]) {
      assert.equal(classifyFilesResponse(status, false), "error", `for ${status}`);
    }
  });
});

describe("the one-shot login hop", () => {
  function fakeStore(): HopMarkerStore & { dump(): Record<string, string> } {
    const map = new Map<string, string>();
    return {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => void map.set(k, v),
      removeItem: (k) => void map.delete(k),
      dump: () => Object.fromEntries(map),
    };
  }

  it("reports no hop tried on a fresh store", () => {
    assert.equal(hasTriedLoginHop(fakeStore()), false);
  });

  it("remembers a hop, so the next 401 classifies as auth-error", () => {
    const store = fakeStore();
    markLoginHop(store);
    assert.equal(hasTriedLoginHop(store), true);
    assert.equal(classifyFilesResponse(401, hasTriedLoginHop(store)), "auth-error");
  });

  // The loop, played out: without release, a hop is never granted twice.
  it("does not grant a second hop while the marker stands", () => {
    const store = fakeStore();
    markLoginHop(store);
    markLoginHop(store);
    assert.equal(hasTriedLoginHop(store), true);
    assert.equal(classifyFilesResponse(401, hasTriedLoginHop(store)), "auth-error");
  });

  // A successful listing proves the whole chain works, so a LATER 401 is a
  // genuinely expired session and has earned its own hop. Without the release
  // the guard would be one hop per tab, forever.
  it("grants a hop again after a successful load released the marker", () => {
    const store = fakeStore();
    markLoginHop(store);
    releaseLoginHop(store);
    assert.equal(hasTriedLoginHop(store), false);
    assert.equal(classifyFilesResponse(401, hasTriedLoginHop(store)), "hop");
  });

  it("releasing a marker that was never set is a no-op, not a throw", () => {
    const store = fakeStore();
    releaseLoginHop(store);
    assert.deepEqual(store.dump(), {});
  });

  it("uses one stable, namespaced key", () => {
    const store = fakeStore();
    markLoginHop(store);
    assert.deepEqual(Object.keys(store.dump()), [WORKSPACE_HOP_KEY]);
    assert.match(WORKSPACE_HOP_KEY, /^roebel_ws/);
  });

  // Safari in private mode throws on sessionStorage ACCESS rather than
  // returning null. A file browser must not fail to render over a
  // storage-permission question, so there is always a store to talk to.
  it("hopMarkerStore always yields a usable store, even with no window", () => {
    const store = hopMarkerStore();
    releaseLoginHop(store);
    assert.equal(hasTriedLoginHop(store), false);
    markLoginHop(store);
    assert.equal(hasTriedLoginHop(store), true);
    releaseLoginHop(store);
    assert.equal(hasTriedLoginHop(store), false);
  });
});

describe("workspaceLinkOut", () => {
  it("is empty when the base url is unset, which hides the card's button", () => {
    for (const raw of [undefined, null, "", "   "]) {
      assert.equal(workspaceLinkOut(raw), "");
    }
  });

  it("trims whitespace and trailing slashes, like the tiles do", () => {
    assert.equal(workspaceLinkOut("  https://cloud.roebel.app///  "), "https://cloud.roebel.app");
  });

  it("leaves an already-clean url alone", () => {
    assert.equal(workspaceLinkOut("https://cloud.roebel.app"), "https://cloud.roebel.app");
  });
});
