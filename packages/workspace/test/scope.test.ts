import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ScopeViolationError,
  orgFolderMount,
  resolvePath,
  scopeRoot,
  type WorkspaceScope,
} from "../src/scope";

const SUB = "0x1111111111111111111111111111111111111111";
const personal: WorkspaceScope = { kind: "personal", sub: SUB, canWrite: true };
const org: WorkspaceScope = {
  kind: "org",
  sub: SUB,
  accountId: "acc-7",
  folderName: "Org Feuerwehr",
  canWrite: true,
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
      () => scopeRoot({ kind: "org", sub: SUB, accountId: "acc-7", canWrite: true }),
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

// resolvePath's input is ALREADY DECODED (parsePropfind decodes every segment
// it returns; URLSearchParams decodes a query parameter once). resolvePath
// therefore only encodes. It used to decode as well — a second decode of an
// already-decoded string — which made a filename containing "%" either
// unreachable or, worse, silently resolve to a different file.
describe("resolvePath — filenames containing a percent sign", () => {
  it("resolves 'Bericht 100%.odt' instead of throwing on invalid percent-encoding", () => {
    assert.equal(
      resolvePath(personal, "Bericht 100%.odt"),
      `/remote.php/dav/files/${SUB}/Bericht%20100%25.odt`,
    );
  });

  it("resolves 'Rabatt %%.odt', where a decode pass sees two malformed escapes", () => {
    assert.equal(
      resolvePath(personal, "Rabatt %%.odt"),
      `/remote.php/dav/files/${SUB}/Rabatt%20%25%25.odt`,
    );
  });

  // The dangerous one: "%41" is a VALID escape for "A", so the old second
  // decode did not throw — it silently produced ".../aA7b.txt", a different
  // file. For DELETE that meant removing something the citizen never named.
  it("resolves 'a%417b.txt' to itself, not to the different file 'aA7b.txt'", () => {
    const resolved = resolvePath(personal, "a%417b.txt");
    assert.equal(resolved, `/remote.php/dav/files/${SUB}/a%25417b.txt`);
    assert.equal(decodeURIComponent(resolved.split("/").pop()!), "a%417b.txt");
    assert.ok(!resolved.includes("aA7b"));
  });

  it("keeps a percent sign inside a nested folder path", () => {
    assert.equal(
      resolvePath(personal, "Berichte 2026/Auslastung 80%.ods"),
      `/remote.php/dav/files/${SUB}/Berichte%202026/Auslastung%2080%25.ods`,
    );
  });

  it("resolves a percent-named file inside an org's group folder too", () => {
    assert.equal(
      resolvePath(org, "Bericht 100%.odt"),
      `/remote.php/dav/files/${SUB}/Org%20Feuerwehr/Bericht%20100%25.odt`,
    );
  });

  // The tolerant decode pass is defence in depth, not the primary check —
  // dropping it must not be mistaken for dropping the traversal guard. Both a
  // literal and a pre-encoded traversal still throw, even now that a malformed
  // escape does not.
  it("still refuses a pre-encoded traversal that also contains a stray percent", () => {
    assert.throws(
      () => resolvePath(personal, "%2e%2e/100%.odt"),
      ScopeViolationError,
    );
  });
});

describe("scopeRoot — component validation", () => {
  // scope.sub and scope.folderName are each meant to be ONE opaque path
  // component. encodeURIComponent does not escape "." — a sub or folderName
  // that IS ".." (or contains a raw "/" or "\") can corrupt the root itself,
  // before resolvePath's containment check ever runs.
  const badComponents = ["..", ".", "foo/bar", "foo\\bar", "foo\0bar"];

  for (const badSub of badComponents) {
    it(`rejects a sub of ${JSON.stringify(badSub)}`, () => {
      assert.throws(
        () => scopeRoot({ kind: "personal", sub: badSub, canWrite: true }),
        ScopeViolationError,
      );
    });
  }

  const badFolderNames = [
    "..",
    ".",
    "../../other-citizen/Privat",
    "foo/bar",
    "foo\\bar",
    "foo\0bar",
  ];

  for (const badFolderName of badFolderNames) {
    it(`rejects a folderName of ${JSON.stringify(badFolderName)}`, () => {
      assert.throws(
        () =>
          scopeRoot({
            kind: "org",
            sub: SUB,
            accountId: "acc-7",
            folderName: badFolderName,
            canWrite: true,
          }),
        ScopeViolationError,
      );
    });
  }
});

describe("resolvePath — component validation", () => {
  // Same attack, exercised through resolvePath (which calls scopeRoot
  // internally) rather than directly, since resolvePath is the entry point
  // real callers use.
  const badComponents = ["..", ".", "foo/bar", "foo\\bar", "foo\0bar"];

  for (const badSub of badComponents) {
    it(`rejects a sub of ${JSON.stringify(badSub)} before resolving any path`, () => {
      assert.throws(
        () => resolvePath({ kind: "personal", sub: badSub, canWrite: true }, "Dokumente/Antrag.odt"),
        ScopeViolationError,
      );
    });
  }

  it("rejects a folderName of '..' before resolving any path", () => {
    assert.throws(
      () =>
        resolvePath(
          { kind: "org", sub: SUB, accountId: "acc-7", folderName: "..", canWrite: true },
          "Protokolle/2026.odt",
        ),
      ScopeViolationError,
    );
  });

  it("rejects a folderName containing a raw slash before resolving any path", () => {
    assert.throws(
      () =>
        resolvePath(
          {
            kind: "org",
            sub: SUB,
            accountId: "acc-7",
            folderName: "../../other-citizen/Privat",
            canWrite: true,
          },
          "steuer.odt",
        ),
      ScopeViolationError,
    );
  });
});

describe("orgFolderMount", () => {
  it("derives the mount point from accountId alone", () => {
    assert.equal(orgFolderMount("acc-7"), "org-acc-7");
  });

  it("is deterministic: the same accountId always yields the same mount point", () => {
    assert.equal(orgFolderMount("acc-7"), orgFolderMount("acc-7"));
  });

  // The whole point of the fix this replaces: two different orgs must never
  // be able to collide on the same mount point, because it is unique by
  // construction (accountId is the accounts table's own primary key) rather
  // than derived from anything a human can rename or duplicate.
  it("gives different accountIds different mount points, even for near-identical ids", () => {
    assert.notEqual(orgFolderMount("acc-7"), orgFolderMount("acc-70"));
    assert.notEqual(orgFolderMount("acc-7"), orgFolderMount("acc-7x"));
  });

  it("does not depend on any org display name — there is no name parameter at all", () => {
    // orgFolderMount takes only an accountId; there is no way to pass a
    // "Feuerwehr" vs "Kleinverein e.V." style name into it, structurally.
    assert.equal(orgFolderMount.length, 1);
  });

  it("rejects an accountId containing a path separator", () => {
    assert.throws(() => orgFolderMount("acc/7"), ScopeViolationError);
    assert.throws(() => orgFolderMount("acc\\7"), ScopeViolationError);
  });

  it("rejects an accountId that is a navigation segment", () => {
    assert.throws(() => orgFolderMount(".."), ScopeViolationError);
    assert.throws(() => orgFolderMount("."), ScopeViolationError);
  });

  it("rejects an accountId containing a null byte", () => {
    assert.throws(() => orgFolderMount("acc\x007"), ScopeViolationError);
  });
});
