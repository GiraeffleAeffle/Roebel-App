import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ScopeViolationError,
  orgFolderName,
  resolvePath,
  scopeRoot,
  type WorkspaceScope,
} from "../src/scope";

const SUB = "0x1111111111111111111111111111111111111111";
const personal: WorkspaceScope = { kind: "personal", sub: SUB };
const org: WorkspaceScope = {
  kind: "org",
  sub: SUB,
  accountId: "acc-7",
  folderName: "Org Feuerwehr",
};

describe("scopeRoot", () => {
  it("puts a personal scope at the citizen's own WebDAV home", () => {
    assert.equal(scopeRoot(personal), `/remote.php/dav/files/${SUB}/`);
  });

  it("puts an org scope inside the group folder, url-encoded", () => {
    assert.equal(
      scopeRoot(org),
      `/remote.php/dav/files/${SUB}/Org%20Feuerwehr/`,
    );
  });

  it("refuses an org scope with no folder name rather than falling back to the home", () => {
    assert.throws(
      () => scopeRoot({ kind: "org", sub: SUB, accountId: "acc-7" }),
      ScopeViolationError,
    );
  });
});

describe("resolvePath", () => {
  it("joins a relative path onto the scope root", () => {
    assert.equal(
      resolvePath(personal, "Dokumente/Antrag.odt"),
      `/remote.php/dav/files/${SUB}/Dokumente/Antrag.odt`,
    );
  });

  it("treats an empty path as the root itself", () => {
    assert.equal(resolvePath(personal, ""), scopeRoot(personal));
  });

  it("encodes each segment without encoding the separators", () => {
    assert.equal(
      resolvePath(personal, "Meine Akten/Bericht #1.odt"),
      `/remote.php/dav/files/${SUB}/Meine%20Akten/Bericht%20%231.odt`,
    );
  });

  // The security boundary. Each of these must be rejected, not normalised away.
  for (const attack of [
    "../other-user/secrets.odt",
    "Dokumente/../../escape.odt",
    "..",
    "/etc/passwd",
    "\\\\windows\\\\path",
    "%2e%2e/escape.odt",
    "%2E%2E%2Fescape.odt",
    "Dokumente/\0/null.odt",
    // Additional bypasses beyond the brief's list, found during review:
    "Dokumente/%00/null.odt", // percent-encoded null byte, not a literal one
    "%2Fetc%2Fpasswd", // fully percent-encoded absolute path — no literal leading "/"
  ]) {
    it(`rejects ${JSON.stringify(attack)}`, () => {
      assert.throws(() => resolvePath(personal, attack), ScopeViolationError);
    });
  }

  it("keeps an org path inside the group folder", () => {
    assert.equal(
      resolvePath(org, "Protokolle/2026.odt"),
      `/remote.php/dav/files/${SUB}/Org%20Feuerwehr/Protokolle/2026.odt`,
    );
  });

  it("stops an org path escaping into the citizen's private home", () => {
    assert.throws(() => resolvePath(org, "../Privat/steuer.odt"), ScopeViolationError);
  });
});

describe("orgFolderName", () => {
  it("prefixes the org name so group folders are recognisable in the file list", () => {
    assert.equal(orgFolderName("Feuerwehr"), "Org Feuerwehr");
  });

  it("strips characters that would break a WebDAV path", () => {
    assert.equal(orgFolderName("Verein / Röbel\\Müritz"), "Org Verein Röbel Müritz");
  });
});
