import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  breadcrumbs,
  buildFilesQuery,
  describeWorkspaceError,
  formatSize,
  loginRedirect,
  parentPath,
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
        orgName: "Feuerwehr",
        path: "Protokolle",
      }),
    );
    assert.equal(q.get("scope"), "org");
    assert.equal(q.get("accountId"), "acc-7");
    assert.equal(q.get("orgName"), "Feuerwehr");
    assert.equal(q.get("path"), "Protokolle");
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
