import assert from "node:assert/strict";
import { test } from "node:test";
import { buildMembershipList } from "../src/lib/dashboard/memberships";
import type { Account } from "../src/types/account";

function account(over: Partial<Account> = {}): Account {
  return {
    id: "acc-1",
    account_type: "organisation",
    sub_type: "verein",
    name: "TSV Röbel",
    bio: null,
    avatar_url: null,
    cover_url: null,
    is_verified: true,
    slug: null,
    is_extern: false,
    extern_status: null,
    extern_reason: null,
    extern_reviewed_by: null,
    extern_reviewed_at: null,
    contact_email: null,
    opening_hours: null,
    created_at: "",
    updated_at: "",
    ...over,
  };
}

test("citizen with no orgs has a single verified citizenship membership", () => {
  const list = buildMembershipList({ isCitizen: true, ownedAccounts: [] });
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, "citizenship");
  assert.equal(list[0].verified, true);
});

test("non-citizen with no orgs has no memberships", () => {
  assert.deepEqual(buildMembershipList({ isCitizen: false, ownedAccounts: [] }), []);
});

test("org accounts become organisation memberships with sub-type label", () => {
  const list = buildMembershipList({
    isCitizen: true,
    ownedAccounts: [account({ id: "o1", name: "TSV Röbel", sub_type: "verein" })],
  });
  const org = list.find((m) => m.id === "o1");
  assert.ok(org);
  assert.equal(org.kind, "organisation");
  assert.equal(org.name, "TSV Röbel");
  assert.equal(org.subtitle, "Verein");
});

test("personal accounts are excluded", () => {
  const list = buildMembershipList({
    isCitizen: false,
    ownedAccounts: [
      account({ id: "p1", account_type: "personal", sub_type: null, name: "Max" }),
    ],
  });
  assert.equal(list.length, 0);
});

test("membership names are display names, never raw wallet addresses", () => {
  const list = buildMembershipList({
    isCitizen: true,
    ownedAccounts: [account({ id: "o1", name: "Stadt Röbel", sub_type: "stadt" })],
  });
  for (const m of list) {
    assert.ok(
      !/^0x[0-9a-fA-F]{6,}/.test(m.name),
      `name must not be a raw wallet: ${m.name}`
    );
  }
});
