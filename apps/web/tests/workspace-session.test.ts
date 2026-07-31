import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildAuthorizationUrl, createPkcePair, groupsFrom } from "../src/lib/workspace/oidc";
import {
  CITIZEN_GROUP,
  ORG_ROLES,
  hasOrgAccess,
  isCitizenSession,
  isExpired,
  newSessionId,
  orgGroupId,
  orgRole,
  sessionMatchesWallet,
  type WorkspaceSession,
} from "../src/lib/workspace/session";

const session: WorkspaceSession = {
  sub: "0xAbC0000000000000000000000000000000000001",
  groups: ["citizen", "org:acc-7:member"],
  accessToken: "at",
  refreshToken: "rt",
  expiresAt: 2_000_000_000_000,
};

describe("newSessionId", () => {
  // The cookie carries ONLY this id; the tokens live in Postgres, because
  // Collabora calls the WOPI endpoints with no cookie at all.
  it("is url-safe, so it can sit in a cookie and in a WOPI token", () => {
    assert.match(newSessionId(), /^[A-Za-z0-9_-]+$/);
  });

  it("carries at least 128 bits, since possessing it IS the session", () => {
    // base64url: 4 chars per 3 bytes. 32 bytes -> 43 chars.
    assert.ok(newSessionId().length >= 43);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newSessionId()));
    assert.equal(ids.size, 500);
  });
});

describe("expiry", () => {
  it("is expired once the clock passes expiresAt", () => {
    assert.equal(isExpired(session, 2_000_000_000_001), true);
  });

  // Refreshing slightly early avoids a token that dies mid-request.
  it("is treated as expired inside the 30s skew window", () => {
    assert.equal(isExpired(session, 2_000_000_000_000 - 15_000), true);
    assert.equal(isExpired(session, 2_000_000_000_000 - 45_000), false);
  });
});

describe("wallet binding", () => {
  it("matches case-insensitively, because checksummed and lowercase forms both occur", () => {
    assert.equal(
      sessionMatchesWallet(session, "0xabc0000000000000000000000000000000000001"),
      true,
    );
  });

  // Without this the previous citizen's files would stay on screen after a switch.
  it("does not match a different wallet", () => {
    assert.equal(
      sessionMatchesWallet(session, "0x0000000000000000000000000000000000000002"),
      false,
    );
  });
});

describe("org access", () => {
  it("derives the group id the keystone emits, defaulting to member", () => {
    assert.equal(orgGroupId("acc-7"), "org:acc-7:member");
  });

  it("derives the group id for an explicit role", () => {
    assert.equal(orgGroupId("acc-7", "owner"), "org:acc-7:owner");
    assert.equal(orgGroupId("acc-7", "admin"), "org:acc-7:admin");
    assert.equal(orgGroupId("acc-7", "member"), "org:acc-7:member");
  });

  // The keystone's claims resolver emits org:<accountId>:<role> verbatim
  // from account_owners.role (owner | admin | member — the app-wide
  // OrgRole vocabulary). ensureOrgFolder binds every group in this list so
  // that whichever role a citizen actually holds, their group already
  // reaches the shared folder — an org's creator (role "owner", the DB
  // default) must not be the one role left locked out.
  it("ORG_ROLES covers exactly the account_owners.role vocabulary", () => {
    assert.deepEqual(ORG_ROLES, ["owner", "admin", "member"]);
  });

  it("grants access when the claim is present", () => {
    assert.equal(hasOrgAccess(session, "acc-7"), true);
  });

  it("denies access for an org the citizen has no claim for", () => {
    assert.equal(hasOrgAccess(session, "acc-9"), false);
  });

  it("accepts any role, not only member", () => {
    const owner = { ...session, groups: ["org:acc-9:owner"] };
    assert.equal(hasOrgAccess(owner, "acc-9"), true);
  });

  // The trailing colon in the match prefix is the only thing stopping a claim
  // for org "acc-70" from also unlocking org "acc-7" — a bare prefix match
  // would treat "acc-7" as a substring hit of "acc-70". Drop the colon and
  // this goes green when it must not: one citizen reading another org's
  // shared files.
  it("does not grant access to a numeric prefix of the claimed org (acc-70 claim vs acc-7 request)", () => {
    const superset = { ...session, groups: ["org:acc-70:member"] };
    assert.equal(hasOrgAccess(superset, "acc-7"), false);
  });

  it("does not grant access the other way around either (acc-7 claim vs acc-70 request)", () => {
    assert.equal(hasOrgAccess(session, "acc-70"), false);
  });

  it("does not grant access to a suffix of the claimed org (cc-7 from an acc-7 claim)", () => {
    assert.equal(hasOrgAccess(session, "cc-7"), false);
  });

  it("does not match an accountId differing only in case", () => {
    assert.equal(hasOrgAccess(session, "ACC-7"), false);
  });

  // Without the trailing colon, an empty accountId collapses the prefix to
  // "org:", which every org claim starts with — turning "no org" into "every
  // org this citizen belongs to."
  it("does not match an empty-string accountId", () => {
    assert.equal(hasOrgAccess(session, ""), false);
  });
});

describe("orgRole", () => {
  it("picks the highest role and ignores other orgs", () => {
    const s: WorkspaceSession = {
      ...session,
      groups: ["citizen", "org:a-1:member", "org:a-1:admin", "org:b-2:owner"],
    };
    assert.equal(orgRole(s, "a-1"), "admin");
    assert.equal(orgRole(s, "b-2"), "owner");
    assert.equal(orgRole(s, "c-3"), null);
  });

  it("returns null for an org the session has no claim for", () => {
    assert.equal(orgRole(session, "acc-99"), null);
  });

  it("returns the single role when only one claim exists", () => {
    const s: WorkspaceSession = { ...session, groups: ["org:acc-7:member"] };
    assert.equal(orgRole(s, "acc-7"), "member");
  });
});

describe("pkce + authorization url", () => {
  it("derives an S256 challenge from the verifier", async () => {
    const { verifier, challenge } = await createPkcePair();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    const expected = Buffer.from(new Uint8Array(digest)).toString("base64url");
    assert.equal(challenge, expected);
  });

  it("builds a spec-shaped authorization request", () => {
    const url = new URL(
      buildAuthorizationUrl({
        issuer: "https://id.roebel.app",
        clientId: "roebel-web",
        redirectUri: "https://roebel.app/api/workspace/auth/callback",
        state: "st",
        codeChallenge: "ch",
      }),
    );
    assert.equal(url.origin + url.pathname, "https://id.roebel.app/auth");
    assert.equal(url.searchParams.get("response_type"), "code");
    assert.equal(url.searchParams.get("client_id"), "roebel-web");
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("code_challenge"), "ch");
    assert.equal(url.searchParams.get("state"), "st");
    assert.equal(url.searchParams.get("scope"), "openid profile email roebel");
  });
});

describe("isCitizenSession", () => {
  function withGroups(groups: string[]): WorkspaceSession {
    return {
      sub: "0xabc",
      groups,
      accessToken: "at",
      refreshToken: null,
      expiresAt: 0,
    };
  }

  it("recognises the keystone's exact citizen claim", () => {
    assert.equal(isCitizenSession(withGroups([CITIZEN_GROUP])), true);
    assert.equal(CITIZEN_GROUP, "citizen");
  });

  it("finds it anywhere in the claim list, not only first", () => {
    assert.equal(
      isCitizenSession(withGroups(["attester", "org:acc-7:owner", "citizen"])),
      true,
    );
  });

  it("is false for an empty claim list", () => {
    assert.equal(isCitizenSession(withGroups([])), false);
  });

  // Exact match, no prefix or substring. An org claim is org:<id>:<role> and
  // must never be mistaken for citizenship, in either direction.
  it("refuses look-alike claims", () => {
    for (const group of [
      "citizens",
      "Citizen",
      "CITIZEN",
      " citizen",
      "citizen ",
      "citizen:verified",
      "not-citizen",
      "org:citizen:member",
    ]) {
      assert.equal(isCitizenSession(withGroups([group])), false, `for ${JSON.stringify(group)}`);
    }
  });

  it("an attester who is not also a citizen does not pass the citizen gate", () => {
    assert.equal(isCitizenSession(withGroups(["attester"])), false);
  });
});

describe("groupsFrom", () => {
  it("reads an array claim", () => {
    assert.deepEqual(groupsFrom({ groups: ["citizen", "org:acc-7:member"] }), [
      "citizen",
      "org:acc-7:member",
    ]);
  });

  it("reads a space-delimited string claim", () => {
    assert.deepEqual(groupsFrom({ groups: "citizen org:acc-7:owner" }), [
      "citizen",
      "org:acc-7:owner",
    ]);
  });

  // This is the production failure: the keystone declares `groups` under the
  // `roebel` scope, so with panva's default conformIdTokenClaims the ID Token
  // carries only `sub`. An empty result here is what makes the callback fall
  // back to userinfo instead of treating a citizen as a non-citizen.
  it("returns empty when the claim is absent, which triggers the userinfo fallback", () => {
    assert.deepEqual(groupsFrom({ sub: "0xabc" }), []);
  });

  it("returns empty for a claim of the wrong type rather than throwing", () => {
    assert.deepEqual(groupsFrom({ groups: 42 }), []);
  });
});
