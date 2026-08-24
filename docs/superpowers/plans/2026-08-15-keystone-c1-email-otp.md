# Keystone-owned Email-OTP Login (Phase C1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a second authentication mode to the `apps/roebel-id` keystone — `AUTH_MODE=sovereign` — in which the keystone itself issues and verifies email one-time codes over its own SMTP, mints an opaque `usr_…` subject, and records verified email/phone/social identifiers in its own Postgres, with **zero thirdweb in the login path** and **zero change to the existing `AUTH_MODE=thirdweb` behaviour**.

**Architecture:** Mode is a per-instance configuration fact (`AUTH_MODE`), never a per-request branch (spec §4). `loadConfig()` returns a discriminated union — `ThirdwebConfig | SovereignConfig` — and `wireApp()` branches on `config.authMode`. The thirdweb branch is the current wiring, verbatim (SIWE bridge → wallet-address `sub`). The sovereign branch wires a keystone-owned OTP service (crypto codes, HMAC-at-rest, attempt caps, per-identifier + per-IP rate limits, 10-minute single-use expiry), a nodemailer/SMTP mailer, a Postgres-backed user/identity store, and a sovereign claims resolver that reads only the keystone's own store (no Supabase, no Gnosis). Both branches finish the OIDC interaction through one shared helper (`finishLoginInteraction`) so consent/resource-grant logic exists once. The two OTP endpoints live **inside an OIDC interaction** (`/interaction/:uid/otp/{start,verify}`) — there is no standalone login API and no way to get a session without an interaction to finish (spec §5).

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), `oidc-provider` v8 (panva), Express 4, `pg` (node-postgres), `nodemailer`, Node `crypto`, Vitest + supertest + openid-client for the e2e conformance proof. Deploy target: Fly (same Docker image as `roebel-id`/`ortis-id`).

**Spec:** [`docs/superpowers/specs/2026-08-12-netizen-sovereign-account-identity-core-design.md`](../specs/2026-08-12-netizen-sovereign-account-identity-core-design.md) — the approved C1 design and the source of truth. Kickoff context: [`docs/NETIZEN_IDENTITY_KICKOFF.md`](../../NETIZEN_IDENTITY_KICKOFF.md) §1b (I2b).

## Global Constraints

Every task's requirements implicitly include this section.

- **`roebel-id` (and `ortis-id`) must not change behaviour.** They run `AUTH_MODE=thirdweb`; `sub` stays the lowercase wallet address; CitizenNFT/Circles/votes/Nextcloud/Matrix all keep resolving (spec §3.1). Two tests are the golden guard and **must stay green, unchanged**: `test/login-page.test.ts` (byte-for-byte `renderLoginPage` — the thirdweb SIWE page) and `test/e2e-flow.test.ts` (the full authorization_code + PKCE flow through the thirdweb router). Do **not** edit `src/interaction/login-page.ts`.
- **English for all code, identifiers, comments, filenames, routes.** German **only** for strings a person reads (login-page copy, OTP email). **Max reviews every user-facing German string** — mark each with a `// MAX REVIEW:` comment; do not invent final wording beyond the drafts here.
- **No passkeys.** Recorded decision, out of scope (spec §8; kickoff "Ausblick").
- **Security contract is not optional** (spec §5.1): 6-digit code from `crypto.randomInt`; code hashed at rest; constant-time comparison; 10-minute TTL, single use; **max 5 attempts then burn**; rate limit per identifier **and** per IP; `/otp/start` responds identically for known and unknown addresses; **codes never in logs, audit records, or error messages**. Each row gets a test.
- **`sub` is an opaque `usr_…` id** the keystone mints — random, stable forever (spec §2, §4.1). Email/phone/social are verified `identities` rows attached to a user, never the subject itself.
- **New users and new communities only.** No migration of existing Röbel citizens; no attempt to reproduce their wallet address (spec §2). A sovereign email login for an address that already exists as a thirdweb citizen is a *different* account by design.
- **Delivery:** nodemailer over the node's own SMTP; Mailhog in dev (spec §5). No third-party email vendor sees the code or the address list.
- **`pnpm` only.** After editing any `package.json`, run `pnpm install` from the repo root (workspace) or `pnpm --filter @roebel/roebel-id install`.
- **Do the deploy split explicitly.** Every step is labelled **[CODE]** (an executor writes/tests it) or **[OPS — MAX]** (a secret, DNS, DB provisioning, or `fly deploy` that only Max runs — see the final "Operational runbook"). Never run a Fly deploy or set a production secret in this plan.

---

## File Structure

New files (all under `apps/roebel-id/`), each with one responsibility:

| Path | Responsibility |
|---|---|
| `src/sovereign/subject.ts` | `mintSubject()` — opaque `usr_…` id. |
| `src/sovereign/normalize.ts` | `normalizeEmail()` — lowercase + trim. |
| `src/sovereign/otp-crypto.ts` | `generateCode()`, `hashCode()`, `codesMatch()` — the code's cryptography. |
| `src/sovereign/stores.ts` | `UserStore` / `OtpStore` interfaces + `Identity` / `OtpChallenge` types + in-memory implementations (dev + test double). |
| `src/sovereign/mailer.ts` | `Mailer` interface + nodemailer/SMTP impl + capturing impl (dev/test). German email copy. |
| `src/sovereign/otp-service.ts` | The security core: `startChallenge()` / `verifyChallenge()`. |
| `src/claims/sovereign-resolver.ts` | Claims from the keystone's own store (no Supabase/Gnosis). |
| `src/interaction/finish-login.ts` | Shared consent + resource-grant + `interactionResult` — extracted from the thirdweb router. |
| `src/interaction/sovereign-login-page.ts` | Branded email-OTP login HTML (no thirdweb, no chain). |
| `src/interaction/sovereign-router.ts` | GET login page + `POST /otp/start` + `POST /otp/verify`. |
| `src/store/pg-pool.ts` | `pg` Pool factory + schema guard + `Queryable` interface. |
| `src/store/pg-oidc-adapter.ts` | Postgres-backed `oidc-provider` Adapter (sovereign replacement for the Supabase adapter). |
| `src/sovereign/pg-stores.ts` | Postgres `UserStore` / `OtpStore` implementations. |
| `migrations/002_sovereign_identity.sql` | `netizen_id` schema: `users`, `identities`, `otp_challenges`, `oidc_payloads`. |

Modified files:

| Path | Change |
|---|---|
| `src/config.ts` | `AUTH_MODE` + discriminated-union `Config`; sovereign env vars. |
| `src/wire.ts` | Branch on `config.authMode`; sovereign wiring; `WireOverrides.otpService`. |
| `src/interaction/router.ts` | Delegate consent/grant to `finishLoginInteraction` (behaviour-preserving). |
| `package.json` | Add `pg`, `nodemailer`, `@types/pg`, `@types/nodemailer`. |
| `README.md`, `.env.example` | Sovereign env schema + Fly runbook. |
| `test/e2e-flow.test.ts`, `test/interaction-login.test.ts` | Add `authMode: 'thirdweb'` to their typed `Config` literals (assertions unchanged). |

---

## Task 1: Config — `AUTH_MODE` + discriminated union

**Files:**
- Modify: `src/config.ts`
- Modify: `test/e2e-flow.test.ts` (add `authMode: 'thirdweb'` to the `Config` literal ~line 148), `test/interaction-login.test.ts` (add `authMode: 'thirdweb'` to the `Config` literal ~line 130)
- Test: `test/config.test.ts`

**Interfaces:**
- Produces: `type Config = ThirdwebConfig | SovereignConfig`; both extend `CommonConfig { authMode; issuer; port; cookieKeys; relyingParties; signerResourceUrl? }`. `ThirdwebConfig` adds `{ authMode: 'thirdweb'; gnosisRpcUrl; chainId; citizenNftAddress; attesterNftAddress; supabaseUrl; supabaseServiceKey; thirdwebClientId }` (all current fields). `SovereignConfig` adds `{ authMode: 'sovereign'; databaseUrl?: string; dbSchema: string; otpPepper: string; mailFrom: string; smtpUrl?: string }`. `RelyingPartyConfig` / `BrandingConfig` unchanged.

- [ ] **Step 1: Write the failing tests.** Append to `test/config.test.ts` (its `afterEach` already deletes any `_CLIENT_*` var; add `AUTH_MODE`, `DATABASE_URL`, `DB_SCHEMA`, `OTP_PEPPER`, `MAIL_FROM`, `SMTP_URL` to the cleanup loop's key list first):

```ts
describe('AUTH_MODE (mode is a per-instance config fact, spec §4)', () => {
  it('defaults to thirdweb when AUTH_MODE is unset — existing instances unchanged', () => {
    withEnv({})
    const cfg = loadConfig()
    expect(cfg.authMode).toBe('thirdweb')
    if (cfg.authMode === 'thirdweb') expect(cfg.supabaseUrl).toBe('https://supabase.example')
  })

  it('sovereign mode boots with SUPABASE_URL and SUPABASE_SERVICE_KEY unset (DoD §9.7)', () => {
    // A sovereign instance must NOT require another community's Supabase service key.
    withEnvNoNextcloud({
      AUTH_MODE: 'sovereign',
      ORTIS_CLIENT_ID: 'ortis', ORTIS_CLIENT_SECRET: 'ortis-secret',
      ORTIS_REDIRECT_URIS: 'https://app.ortis.app/api/auth/callback',
      DATABASE_URL: 'postgres://u:p@db.internal:5432/id',
      OTP_PEPPER: 'pepper-value', MAIL_FROM: 'login@id.ortis.app',
    })
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_KEY
    delete process.env.THIRDWEB_CLIENT_ID
    const cfg = loadConfig()
    expect(cfg.authMode).toBe('sovereign')
    if (cfg.authMode === 'sovereign') {
      expect(cfg.databaseUrl).toBe('postgres://u:p@db.internal:5432/id')
      expect(cfg.otpPepper).toBe('pepper-value')
      expect(cfg.mailFrom).toBe('login@id.ortis.app')
      expect(cfg.dbSchema).toBe('netizen_id') // default
    }
  })

  it('sovereign mode still requires OTP_PEPPER and MAIL_FROM', () => {
    withEnvNoNextcloud({
      AUTH_MODE: 'sovereign',
      ORTIS_CLIENT_ID: 'ortis', ORTIS_CLIENT_SECRET: 'ortis-secret',
      ORTIS_REDIRECT_URIS: 'https://app.ortis.app/api/auth/callback',
      MAIL_FROM: 'login@id.ortis.app',
    })
    expect(() => loadConfig()).toThrow(/OTP_PEPPER/)
  })

  it('rejects an unknown AUTH_MODE loudly at boot', () => {
    withEnv({ AUTH_MODE: 'magic' })
    expect(() => loadConfig()).toThrow(/AUTH_MODE/)
  })
})
```

- [ ] **Step 2: Run to verify they fail.** Run: `pnpm --filter @roebel/roebel-id test -- config` → Expected: FAIL (`authMode` undefined / no such branch).

- [ ] **Step 3: Implement the union in `src/config.ts`.** Split `Config` and branch `loadConfig()`. Keep the RP-loading block (`OPTIONAL_FIRST_PARTY_PREFIXES`, `FIRST_PARTY_RPS`, the zero-RP throw) exactly as it is — it is shared. Replace only the `Config` interface and the final `return`:

```ts
interface CommonConfig {
  authMode: 'thirdweb' | 'sovereign'
  issuer: string
  port: number
  cookieKeys: string[]
  relyingParties: RelyingPartyConfig[]
  signerResourceUrl?: string
}
export interface ThirdwebConfig extends CommonConfig {
  authMode: 'thirdweb'
  gnosisRpcUrl: string
  chainId: number
  citizenNftAddress: `0x${string}`
  attesterNftAddress: `0x${string}`
  supabaseUrl: string
  supabaseServiceKey: string
  thirdwebClientId: string
}
export interface SovereignConfig extends CommonConfig {
  authMode: 'sovereign'
  /** Unset → in-memory stores (dev only; sub is NOT stable across restarts). Set → Postgres. */
  databaseUrl?: string
  /** Postgres schema the sovereign tables live in. Validated: [a-z_][a-z0-9_]*. */
  dbSchema: string
  /** HMAC key the OTP code is hashed with at rest. Never stored in the DB. */
  otpPepper: string
  /** From-address for the OTP email. */
  mailFrom: string
  /** nodemailer transport URL (e.g. smtp://user:pass@host:587, or smtp://localhost:1025 for Mailhog). Unset → capturing dev mailer. */
  smtpUrl?: string
}
export type Config = ThirdwebConfig | SovereignConfig
```

Then in `loadConfig()`, after the RP block and above the old `return`:

```ts
  const common: CommonConfig = {
    authMode: 'thirdweb', // overwritten below
    issuer: required('ISSUER_URL'),
    port: Number(process.env.PORT ?? 3010),
    cookieKeys: csv(required('COOKIE_KEYS')),
    relyingParties,
    signerResourceUrl: optionalAbsoluteUrl('SIGNER_RESOURCE_URL'),
  }

  const mode = process.env.AUTH_MODE ?? 'thirdweb'
  if (mode === 'thirdweb') {
    return {
      ...common,
      authMode: 'thirdweb',
      gnosisRpcUrl: required('GNOSIS_RPC_URL'),
      chainId: Number(process.env.CHAIN_ID ?? 100),
      citizenNftAddress: required('CITIZEN_NFT_ADDRESS') as `0x${string}`,
      attesterNftAddress: required('ATTESTER_NFT_ADDRESS') as `0x${string}`,
      supabaseUrl: required('SUPABASE_URL'),
      supabaseServiceKey: required('SUPABASE_SERVICE_KEY'),
      thirdwebClientId: required('THIRDWEB_CLIENT_ID'),
    }
  }
  if (mode === 'sovereign') {
    const dbSchema = process.env.DB_SCHEMA ?? 'netizen_id'
    if (!/^[a-z_][a-z0-9_]*$/.test(dbSchema)) {
      throw new Error(`Invalid DB_SCHEMA: '${dbSchema}' (expected a plain lowercase identifier)`)
    }
    return {
      ...common,
      authMode: 'sovereign',
      databaseUrl: process.env.DATABASE_URL?.trim() || undefined,
      dbSchema,
      otpPepper: required('OTP_PEPPER'),
      mailFrom: required('MAIL_FROM'),
      smtpUrl: process.env.SMTP_URL?.trim() || undefined,
    }
  }
  throw new Error(`Invalid AUTH_MODE: '${mode}' (expected 'thirdweb' or 'sovereign')`)
```

Delete the old single `return { issuer: ..., supabaseUrl: ..., ... }` block.

- [ ] **Step 4: Fix the two typed test literals.** In `test/e2e-flow.test.ts` add `authMode: 'thirdweb',` as the first field of the `const testConfig: Config = {` literal. In `test/interaction-login.test.ts` add the same to its `const testConfig: Config = {` literal. Do not touch any assertion. (`test/discovery.test.ts` uses `const config: any` — leave it.)

- [ ] **Step 5: Run the FULL suite — thirdweb must be byte-stable.** Run: `pnpm --filter @roebel/roebel-id test` and `pnpm --filter @roebel/roebel-id build`. Expected: PASS, including the new config tests, `login-page.test.ts`, and `e2e-flow.test.ts` unchanged. This step is the no-op guard for the config refactor.

- [ ] **Step 6: Commit.**

```bash
git add src/config.ts test/config.test.ts test/e2e-flow.test.ts test/interaction-login.test.ts
git commit -m "feat(roebel-id): AUTH_MODE + discriminated-union Config (thirdweb|sovereign)"
```

---

## Task 2: Opaque subject + email normalization

**Files:**
- Create: `src/sovereign/subject.ts`, `src/sovereign/normalize.ts`
- Test: `test/sovereign/subject.test.ts`, `test/sovereign/normalize.test.ts`

**Interfaces:**
- Produces: `mintSubject(): string` (returns `usr_` + 32 lowercase hex chars); `normalizeEmail(raw: string): string`.

- [ ] **Step 1: Write the failing tests.**

```ts
// test/sovereign/subject.test.ts
import { describe, it, expect } from 'vitest'
import { mintSubject } from '../../src/sovereign/subject.js'

describe('mintSubject', () => {
  it('mints an opaque usr_ id of the documented shape', () => {
    expect(mintSubject()).toMatch(/^usr_[0-9a-f]{32}$/)
  })
  it('is unique across calls (no PII, no address derivation)', () => {
    const seen = new Set(Array.from({ length: 1000 }, () => mintSubject()))
    expect(seen.size).toBe(1000)
  })
})
```

```ts
// test/sovereign/normalize.test.ts
import { describe, it, expect } from 'vitest'
import { normalizeEmail } from '../../src/sovereign/normalize.js'

describe('normalizeEmail', () => {
  it('lowercases and trims', () => {
    expect(normalizeEmail('  Bob@Example.DE ')).toBe('bob@example.de')
  })
})
```

- [ ] **Step 2: Run to verify they fail.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign/subject sovereign/normalize` → Expected: FAIL (modules not found).

- [ ] **Step 3: Implement.**

```ts
// src/sovereign/subject.ts
import { randomBytes } from 'node:crypto'

/** The opaque, stable-forever subject the keystone mints in sovereign mode (spec §2, §4.1).
 *  NOT derived from email/phone/address — those are verified `identities` rows attached to it. */
export function mintSubject(): string {
  return `usr_${randomBytes(16).toString('hex')}`
}
```

```ts
// src/sovereign/normalize.ts
/** Canonical form stored in `identities.value` for kind='email' (spec §4.1). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase()
}
```

- [ ] **Step 4: Run to verify they pass.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign/subject sovereign/normalize` → Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/sovereign/subject.ts src/sovereign/normalize.ts test/sovereign/subject.test.ts test/sovereign/normalize.test.ts
git commit -m "feat(roebel-id): opaque usr_ subject minting + email normalization"
```

---

## Task 3: OTP cryptography — generate / hash / compare

**Files:**
- Create: `src/sovereign/otp-crypto.ts`
- Test: `test/sovereign/otp-crypto.test.ts`

**Interfaces:**
- Produces: `generateCode(): string` (6 digits, leading zeros preserved, from `crypto.randomInt`); `hashCode(code: string, pepper: string): string` (HMAC-SHA256 hex); `codesMatch(code: string, storedHash: string, pepper: string): boolean` (constant-time).

Covers security contract rows 1–3 (spec §5.1): crypto RNG, hashed at rest, constant-time comparison.

- [ ] **Step 1: Write the failing tests.**

```ts
// test/sovereign/otp-crypto.test.ts
import { describe, it, expect } from 'vitest'
import { generateCode, hashCode, codesMatch } from '../../src/sovereign/otp-crypto.js'

describe('generateCode', () => {
  it('is always exactly 6 digits, including leading zeros', () => {
    for (let i = 0; i < 5000; i++) expect(generateCode()).toMatch(/^\d{6}$/)
  })
})

describe('hashCode', () => {
  it('never returns the code itself (hashed at rest, spec §5.1)', () => {
    expect(hashCode('123456', 'pepper')).not.toContain('123456')
  })
  it('is deterministic for the same code+pepper', () => {
    expect(hashCode('000042', 'pepper')).toBe(hashCode('000042', 'pepper'))
  })
  it('depends on the pepper — a DB leak without the pepper cannot reproduce the hash', () => {
    expect(hashCode('123456', 'pepper-a')).not.toBe(hashCode('123456', 'pepper-b'))
  })
})

describe('codesMatch', () => {
  it('accepts the right code and rejects a wrong one', () => {
    const stored = hashCode('654321', 'pepper')
    expect(codesMatch('654321', stored, 'pepper')).toBe(true)
    expect(codesMatch('654320', stored, 'pepper')).toBe(false)
  })
  it('rejects rather than throws on a malformed stored hash (length mismatch)', () => {
    expect(codesMatch('654321', 'not-a-hash', 'pepper')).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify they fail.** Run: `pnpm --filter @roebel/roebel-id test -- otp-crypto` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement.**

```ts
// src/sovereign/otp-crypto.ts
import { randomInt, createHmac, timingSafeEqual } from 'node:crypto'

/** 6-digit code from a CSPRNG. Math.random is predictable; a guessable code is no code (spec §5.1). */
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

/** HMAC-SHA256 of the code under a server-held pepper. Stored in otp_challenges.code_hash.
 *  The pepper lives only in an env secret (OTP_PEPPER), never in the DB, so a database leak
 *  yields no live codes. */
export function hashCode(code: string, pepper: string): string {
  return createHmac('sha256', pepper).update(code).digest('hex')
}

/** Constant-time compare of a submitted code against the stored hash. A length mismatch
 *  (malformed/short stored value) returns false rather than throwing — timingSafeEqual
 *  throws on unequal-length buffers. */
export function codesMatch(code: string, storedHash: string, pepper: string): boolean {
  const computed = Buffer.from(hashCode(code, pepper), 'hex')
  const stored = Buffer.from(storedHash, 'hex')
  if (computed.length !== stored.length || stored.length === 0) return false
  return timingSafeEqual(computed, stored)
}
```

- [ ] **Step 4: Run to verify they pass.** Run: `pnpm --filter @roebel/roebel-id test -- otp-crypto` → Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/sovereign/otp-crypto.ts test/sovereign/otp-crypto.test.ts
git commit -m "feat(roebel-id): OTP code crypto (randomInt code, HMAC-at-rest, constant-time compare)"
```

---

## Task 4: Store interfaces + in-memory implementations

**Files:**
- Create: `src/sovereign/stores.ts`
- Test: `test/sovereign/stores.test.ts`

**Interfaces:**
- Produces the domain types and interfaces every later task depends on:

```ts
export interface Identity { kind: string; value: string; verifiedAt: number }
export interface OtpChallenge {
  id: string; value: string; codeHash: string
  expiresAt: number; attempts: number; consumedAt: number | null
  ip: string | null; createdAt: number
}
export interface UserStore {
  findUserIdByEmail(email: string): Promise<string | null>
  createUserWithEmailIdentity(subject: string, email: string, now: number): Promise<void>
  getIdentities(subject: string): Promise<Identity[]>
}
export interface OtpStore {
  burnActiveForValue(value: string, now: number): Promise<void>
  create(challenge: OtpChallenge): Promise<void>
  findActiveByValue(value: string, now: number): Promise<OtpChallenge | null>
  recordAttempt(id: string): Promise<void>
  markConsumed(id: string, now: number): Promise<void>
  countSince(where: { value?: string; ip?: string; since: number }): Promise<number>
}
export function createInMemoryUserStore(): UserStore
export function createInMemoryOtpStore(): OtpStore
```

The in-memory implementations are the dev default (mirrors the existing `createMemoryNonceStore`) and the test double for Tasks 6–7 and the sovereign e2e. **Note in a comment: in-memory does NOT persist across restarts, so `sub` stability (DoD §9.2) holds only within a process — production uses the Postgres stores from Task 8.**

- [ ] **Step 1: Write the failing tests.**

```ts
// test/sovereign/stores.test.ts
import { describe, it, expect } from 'vitest'
import { createInMemoryUserStore, createInMemoryOtpStore } from '../../src/sovereign/stores.js'
import type { OtpChallenge } from '../../src/sovereign/stores.js'

const T0 = 1_000_000
const chal = (over: Partial<OtpChallenge> = {}): OtpChallenge => ({
  id: 'c1', value: 'bob@example.de', codeHash: 'h', expiresAt: T0 + 600_000,
  attempts: 0, consumedAt: null, ip: '1.2.3.4', createdAt: T0, ...over,
})

describe('in-memory UserStore', () => {
  it('find-or-create yields a stable subject for the same email', async () => {
    const s = createInMemoryUserStore()
    expect(await s.findUserIdByEmail('bob@example.de')).toBeNull()
    await s.createUserWithEmailIdentity('usr_abc', 'bob@example.de', T0)
    expect(await s.findUserIdByEmail('bob@example.de')).toBe('usr_abc')
    expect(await s.getIdentities('usr_abc')).toEqual([
      { kind: 'email', value: 'bob@example.de', verifiedAt: T0 },
    ])
  })
})

describe('in-memory OtpStore', () => {
  it('findActiveByValue returns an unconsumed, unexpired challenge and skips consumed/expired ones', async () => {
    const s = createInMemoryOtpStore()
    await s.create(chal({ id: 'c1' }))
    expect((await s.findActiveByValue('bob@example.de', T0))?.id).toBe('c1')
    await s.markConsumed('c1', T0)
    expect(await s.findActiveByValue('bob@example.de', T0)).toBeNull()
    await s.create(chal({ id: 'c2', expiresAt: T0 - 1 }))
    expect(await s.findActiveByValue('bob@example.de', T0)).toBeNull()
  })

  it('recordAttempt increments; burnActiveForValue consumes prior active challenges', async () => {
    const s = createInMemoryOtpStore()
    await s.create(chal({ id: 'c1' }))
    await s.recordAttempt('c1')
    expect((await s.findActiveByValue('bob@example.de', T0))?.attempts).toBe(1)
    await s.burnActiveForValue('bob@example.de', T0)
    expect(await s.findActiveByValue('bob@example.de', T0)).toBeNull()
  })

  it('countSince counts by value and by ip within the window (rate-limit source)', async () => {
    const s = createInMemoryOtpStore()
    await s.create(chal({ id: 'c1', createdAt: T0 }))
    await s.create(chal({ id: 'c2', createdAt: T0 + 10, value: 'eve@example.de' }))
    expect(await s.countSince({ value: 'bob@example.de', since: T0 - 1000 })).toBe(1)
    expect(await s.countSince({ ip: '1.2.3.4', since: T0 - 1000 })).toBe(2)
    expect(await s.countSince({ ip: '1.2.3.4', since: T0 + 5 })).toBe(1)
  })
})
```

- [ ] **Step 2: Run to verify they fail.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign/stores` → Expected: FAIL.

- [ ] **Step 3: Implement `src/sovereign/stores.ts`** with the interfaces above plus:

```ts
export function createInMemoryUserStore(): UserStore {
  const emailToSubject = new Map<string, string>()
  const identities = new Map<string, Identity[]>()
  return {
    async findUserIdByEmail(email) { return emailToSubject.get(email) ?? null },
    async createUserWithEmailIdentity(subject, email, now) {
      emailToSubject.set(email, subject)
      identities.set(subject, [{ kind: 'email', value: email, verifiedAt: now }])
    },
    async getIdentities(subject) { return identities.get(subject) ?? [] },
  }
}

export function createInMemoryOtpStore(): OtpStore {
  const rows = new Map<string, OtpChallenge>()
  return {
    async burnActiveForValue(value, now) {
      for (const c of rows.values()) {
        if (c.value === value && c.consumedAt === null && c.expiresAt > now) c.consumedAt = now
      }
    },
    async create(challenge) { rows.set(challenge.id, { ...challenge }) },
    async findActiveByValue(value, now) {
      let best: OtpChallenge | null = null
      for (const c of rows.values()) {
        if (c.value === value && c.consumedAt === null && c.expiresAt > now) {
          if (!best || c.createdAt > best.createdAt) best = c
        }
      }
      return best ? { ...best } : null
    },
    async recordAttempt(id) { const c = rows.get(id); if (c) c.attempts += 1 },
    async markConsumed(id, now) { const c = rows.get(id); if (c) c.consumedAt = now },
    async countSince({ value, ip, since }) {
      let n = 0
      for (const c of rows.values()) {
        if (c.createdAt < since) continue
        if (value !== undefined && c.value !== value) continue
        if (ip !== undefined && c.ip !== ip) continue
        n++
      }
      return n
    },
  }
}
```

- [ ] **Step 4: Run to verify they pass.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign/stores` → Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/sovereign/stores.ts test/sovereign/stores.test.ts
git commit -m "feat(roebel-id): sovereign UserStore/OtpStore interfaces + in-memory impls"
```

---

## Task 5: Mailer — nodemailer/SMTP + capturing test double

**Files:**
- Modify: `package.json` (add `nodemailer` + `@types/nodemailer`)
- Create: `src/sovereign/mailer.ts`
- Test: `test/sovereign/mailer.test.ts`

**Interfaces:**
- Consumes: `BrandingPreset` from `src/config.ts`.
- Produces:

```ts
export interface OtpEmail { to: string; code: string; preset: BrandingPreset; context?: string }
export interface Mailer { sendOtpEmail(email: OtpEmail): Promise<void> }
export interface CapturingMailer extends Mailer { readonly sent: OtpEmail[]; last(): OtpEmail | undefined }
export function createCapturingMailer(): CapturingMailer
export function createNodemailerMailer(opts: { smtpUrl: string; from: string }): Mailer
export function renderOtpEmail(email: OtpEmail): { subject: string; text: string } // pure, testable German copy
```

- [ ] **Step 1: Add the dependency.** In `apps/roebel-id/package.json`, add to `dependencies`: `"nodemailer": "^6.9.14"`; to `devDependencies`: `"@types/nodemailer": "^6.4.15"`. Then run `pnpm --filter @roebel/roebel-id install`.

- [ ] **Step 2: Write the failing tests.**

```ts
// test/sovereign/mailer.test.ts
import { describe, it, expect } from 'vitest'
import { createCapturingMailer, renderOtpEmail } from '../../src/sovereign/mailer.js'

describe('capturing mailer', () => {
  it('records what it was asked to send (dev/test rail)', async () => {
    const m = createCapturingMailer()
    await m.sendOtpEmail({ to: 'bob@example.de', code: '123456', preset: 'ortis', context: 'Amt X' })
    expect(m.last()).toEqual({ to: 'bob@example.de', code: '123456', preset: 'ortis', context: 'Amt X' })
    expect(m.sent).toHaveLength(1)
  })
})

describe('renderOtpEmail (German copy — MAX REVIEW)', () => {
  it('puts the code in the body and states a 10-minute validity', () => {
    const { subject, text } = renderOtpEmail({ to: 'bob@example.de', code: '123456', preset: 'ortis' })
    expect(subject.length).toBeGreaterThan(0)
    expect(text).toContain('123456')
    expect(text).toMatch(/10 Minuten/)
  })
  it('never mentions Röbel in the ortis preset (a visiting mayor must not see Röbel branding)', () => {
    const { subject, text } = renderOtpEmail({ to: 'bob@example.de', code: '123456', preset: 'ortis' })
    expect(`${subject} ${text}`).not.toMatch(/r(ö|oe)bel/i)
  })
})
```

- [ ] **Step 3: Run to verify they fail.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign/mailer` → Expected: FAIL.

- [ ] **Step 4: Implement `src/sovereign/mailer.ts`.**

```ts
import nodemailer from 'nodemailer'
import type { BrandingPreset } from '../config.js'

export interface OtpEmail { to: string; code: string; preset: BrandingPreset; context?: string }
export interface Mailer { sendOtpEmail(email: OtpEmail): Promise<void> }
export interface CapturingMailer extends Mailer { readonly sent: OtpEmail[]; last(): OtpEmail | undefined }

const BRAND_NAME: Record<BrandingPreset, string> = { roebel: 'Röbel ID', ortis: 'Ortis' }

/** German user-facing copy. MAX REVIEW: subject + body wording before first production send. */
export function renderOtpEmail(email: OtpEmail): { subject: string; text: string } {
  const brand = BRAND_NAME[email.preset]
  const contextLine = email.context ? `${email.context}\n\n` : ''
  // MAX REVIEW ↓
  const subject = `Dein Anmeldecode für ${brand}`
  const text =
    `${contextLine}Dein Anmeldecode lautet: ${email.code}\n\n` +
    `Der Code ist 10 Minuten gültig und kann nur einmal verwendet werden.\n` +
    `Wenn du dich nicht anmelden wolltest, kannst du diese E-Mail ignorieren.`
  // MAX REVIEW ↑
  return { subject, text }
}

export function createCapturingMailer(): CapturingMailer {
  const sent: OtpEmail[] = []
  return {
    sent,
    last: () => sent[sent.length - 1],
    async sendOtpEmail(email) { sent.push(email) },
  }
}

export function createNodemailerMailer(opts: { smtpUrl: string; from: string }): Mailer {
  const transport = nodemailer.createTransport(opts.smtpUrl)
  return {
    async sendOtpEmail(email) {
      const { subject, text } = renderOtpEmail(email)
      // Never log `text` or `email.code` — the audit trail must not become the credential store (spec §5.1).
      await transport.sendMail({ from: opts.from, to: email.to, subject, text })
    },
  }
}
```

- [ ] **Step 5: Run to verify they pass + typecheck.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign/mailer` and `pnpm --filter @roebel/roebel-id build` → Expected: PASS.

- [ ] **Step 6: Commit.**

```bash
git add package.json ../../pnpm-lock.yaml src/sovereign/mailer.ts test/sovereign/mailer.test.ts
git commit -m "feat(roebel-id): OTP mailer (nodemailer/SMTP + capturing double, German copy)"
```

---

## Task 6: OTP service — the security core

**Files:**
- Create: `src/sovereign/otp-service.ts`
- Test: `test/sovereign/otp-service.test.ts`

**Interfaces:**
- Consumes: `UserStore`, `OtpStore`, `OtpChallenge` (Task 4); `Mailer`, `OtpEmail` (Task 5); `generateCode`, `hashCode`, `codesMatch` (Task 3); `normalizeEmail` (Task 2); `mintSubject` (Task 2); `BrandingPreset`.
- Produces:

```ts
export interface OtpServiceOptions {
  userStore: UserStore; otpStore: OtpStore; mailer: Mailer; pepper: string
  now?: () => number; ttlMs?: number; maxAttempts?: number
  rateWindowMs?: number; maxPerIdentifier?: number; maxPerIp?: number
  newId?: () => string; newCode?: () => string; newSubject?: () => string
}
export interface OtpService {
  startChallenge(input: { email: string; ip?: string; preset: BrandingPreset; context?: string }): Promise<void>
  verifyChallenge(input: { email: string; code: string }): Promise<{ subject: string }>
}
export function createOtpService(opts: OtpServiceOptions): OtpService
export class OtpVerifyError extends Error {} // message is a stable code label, never the OTP code
```

Defaults: `ttlMs = 10*60_000`, `maxAttempts = 5`, `rateWindowMs = 15*60_000`, `maxPerIdentifier = 3`, `maxPerIp = 10`. The `new*` seams exist so tests inject a fixed code/subject/id deterministically (no live code ever hardcoded in a fixture — the injected code lives only in the isolated test process, DoD §9.4).

- [ ] **Step 1: Write the failing tests.**

```ts
// test/sovereign/otp-service.test.ts
import { describe, it, expect } from 'vitest'
import { createOtpService, OtpVerifyError } from '../../src/sovereign/otp-service.js'
import { createInMemoryUserStore, createInMemoryOtpStore } from '../../src/sovereign/stores.js'
import { createCapturingMailer } from '../../src/sovereign/mailer.js'

function build(over: Partial<Parameters<typeof createOtpService>[0]> = {}) {
  const userStore = createInMemoryUserStore()
  const otpStore = createInMemoryOtpStore()
  const mailer = createCapturingMailer()
  let t = 1_000_000
  const svc = createOtpService({
    userStore, otpStore, mailer, pepper: 'test-pepper',
    now: () => t, newSubject: () => 'usr_fixed', ...over,
  })
  return { svc, userStore, otpStore, mailer, tick: (ms: number) => { t += ms }, at: () => t }
}

describe('startChallenge', () => {
  it('sends a 6-digit code and returns nothing revealing', async () => {
    const { svc, mailer } = build()
    await svc.startChallenge({ email: 'Bob@Example.de', ip: '1.1.1.1', preset: 'ortis' })
    expect(mailer.last()?.to).toBe('bob@example.de') // normalized
    expect(mailer.last()?.code).toMatch(/^\d{6}$/)
  })

  it('responds identically for a known and an unknown address — no membership oracle (spec §5.1)', async () => {
    const { svc } = build()
    // known: seed a user first
    await svc.startChallenge({ email: 'known@example.de', ip: '1.1.1.1', preset: 'ortis' })
    const a = await svc.startChallenge({ email: 'known@example.de', ip: '1.1.1.2', preset: 'ortis' })
    const b = await svc.startChallenge({ email: 'nobody@example.de', ip: '1.1.1.3', preset: 'ortis' })
    expect(a).toBeUndefined()
    expect(b).toBeUndefined() // both resolve void, indistinguishable to the caller
  })

  it('per-identifier rate limit: the 4th start in the window sends no mail, still resolves void', async () => {
    const { svc, mailer } = build({ maxPerIdentifier: 3 })
    for (let i = 0; i < 3; i++) await svc.startChallenge({ email: 'bob@example.de', ip: `9.9.9.${i}`, preset: 'ortis' })
    const before = mailer.sent.length
    await svc.startChallenge({ email: 'bob@example.de', ip: '9.9.9.9', preset: 'ortis' })
    expect(mailer.sent.length).toBe(before) // suppressed
  })

  it('per-IP rate limit: the (max+1)th start from one IP sends no mail', async () => {
    const { svc, mailer } = build({ maxPerIp: 2 })
    await svc.startChallenge({ email: 'a@example.de', ip: '7.7.7.7', preset: 'ortis' })
    await svc.startChallenge({ email: 'b@example.de', ip: '7.7.7.7', preset: 'ortis' })
    const before = mailer.sent.length
    await svc.startChallenge({ email: 'c@example.de', ip: '7.7.7.7', preset: 'ortis' })
    expect(mailer.sent.length).toBe(before)
  })
})

describe('verifyChallenge', () => {
  it('verifies the emailed code, mints a usr_ subject, and is stable on the next login (DoD §9.1, §9.2)', async () => {
    const { svc, mailer } = build()
    await svc.startChallenge({ email: 'bob@example.de', ip: '1.1.1.1', preset: 'ortis' })
    const code1 = mailer.last()!.code
    const { subject } = await svc.verifyChallenge({ email: 'bob@example.de', code: code1 })
    expect(subject).toMatch(/^usr_/)
    // second login, fresh challenge, same person → same subject
    await svc.startChallenge({ email: 'Bob@Example.de', ip: '1.1.1.1', preset: 'ortis' })
    const code2 = mailer.last()!.code
    const again = await svc.verifyChallenge({ email: 'bob@example.de', code: code2 })
    expect(again.subject).toBe(subject)
  })

  it('five wrong codes burn the challenge; a sixth attempt with the CORRECT code fails (DoD §9.4)', async () => {
    const { svc, mailer } = build({ maxAttempts: 5 })
    await svc.startChallenge({ email: 'bob@example.de', ip: '1.1.1.1', preset: 'ortis' })
    const correct = mailer.last()!.code
    const wrong = correct === '000000' ? '111111' : '000000'
    for (let i = 0; i < 5; i++) {
      await expect(svc.verifyChallenge({ email: 'bob@example.de', code: wrong })).rejects.toBeInstanceOf(OtpVerifyError)
    }
    await expect(svc.verifyChallenge({ email: 'bob@example.de', code: correct })).rejects.toBeInstanceOf(OtpVerifyError)
  })

  it('rejects an expired code (10-minute TTL, spec §5.1)', async () => {
    const { svc, mailer, tick } = build({ ttlMs: 600_000 })
    await svc.startChallenge({ email: 'bob@example.de', ip: '1.1.1.1', preset: 'ortis' })
    const code = mailer.last()!.code
    tick(600_001)
    await expect(svc.verifyChallenge({ email: 'bob@example.de', code })).rejects.toBeInstanceOf(OtpVerifyError)
  })

  it('a used code cannot be replayed (single use)', async () => {
    const { svc, mailer } = build()
    await svc.startChallenge({ email: 'bob@example.de', ip: '1.1.1.1', preset: 'ortis' })
    const code = mailer.last()!.code
    await svc.verifyChallenge({ email: 'bob@example.de', code })
    await expect(svc.verifyChallenge({ email: 'bob@example.de', code })).rejects.toBeInstanceOf(OtpVerifyError)
  })

  it('never puts the OTP code in the thrown error message (spec §5.1)', async () => {
    const { svc, mailer } = build()
    await svc.startChallenge({ email: 'bob@example.de', ip: '1.1.1.1', preset: 'ortis' })
    const code = mailer.last()!.code
    const wrong = code === '000000' ? '111111' : '000000'
    await svc.verifyChallenge({ email: 'bob@example.de', code: wrong }).catch((e: Error) => {
      expect(e.message).not.toContain(wrong)
      expect(e.message).not.toContain(code)
    })
  })
})
```

- [ ] **Step 2: Run to verify they fail.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign/otp-service` → Expected: FAIL.

- [ ] **Step 3: Implement `src/sovereign/otp-service.ts`.**

```ts
import { randomUUID } from 'node:crypto'
import type { UserStore, OtpStore, OtpChallenge } from './stores.js'
import type { Mailer } from './mailer.js'
import type { BrandingPreset } from '../config.js'
import { generateCode, hashCode, codesMatch } from './otp-crypto.js'
import { normalizeEmail } from './normalize.js'
import { mintSubject } from './subject.js'

/** Stable label codes — safe to surface, and never contain the OTP itself (spec §5.1). */
export class OtpVerifyError extends Error {
  constructor(public code: 'no_active_challenge' | 'too_many_attempts' | 'invalid_code') {
    super(code)
    this.name = 'OtpVerifyError'
  }
}

export interface OtpServiceOptions {
  userStore: UserStore; otpStore: OtpStore; mailer: Mailer; pepper: string
  now?: () => number; ttlMs?: number; maxAttempts?: number
  rateWindowMs?: number; maxPerIdentifier?: number; maxPerIp?: number
  newId?: () => string; newCode?: () => string; newSubject?: () => string
}

export interface OtpService {
  startChallenge(input: { email: string; ip?: string; preset: BrandingPreset; context?: string }): Promise<void>
  verifyChallenge(input: { email: string; code: string }): Promise<{ subject: string }>
}

export function createOtpService(opts: OtpServiceOptions): OtpService {
  const now = opts.now ?? Date.now
  const ttlMs = opts.ttlMs ?? 10 * 60_000
  const maxAttempts = opts.maxAttempts ?? 5
  const rateWindowMs = opts.rateWindowMs ?? 15 * 60_000
  const maxPerIdentifier = opts.maxPerIdentifier ?? 3
  const maxPerIp = opts.maxPerIp ?? 10
  const newId = opts.newId ?? randomUUID
  const newCode = opts.newCode ?? generateCode
  const newSubject = opts.newSubject ?? mintSubject
  const { userStore, otpStore, mailer, pepper } = opts

  return {
    async startChallenge({ email, ip, preset, context }) {
      const value = normalizeEmail(email)
      const since = now() - rateWindowMs
      const byId = await otpStore.countSince({ value, since })
      const byIp = ip ? await otpStore.countSince({ ip, since }) : 0
      // Rate limited → return the SAME (void) result and send nothing. The caller (and an
      // attacker) cannot tell a suppressed send from a real one (spec §5.1).
      if (byId >= maxPerIdentifier || byIp >= maxPerIp) return

      await otpStore.burnActiveForValue(value, now())
      const code = newCode()
      const challenge: OtpChallenge = {
        id: newId(), value, codeHash: hashCode(code, pepper),
        expiresAt: now() + ttlMs, attempts: 0, consumedAt: null,
        ip: ip ?? null, createdAt: now(),
      }
      await otpStore.create(challenge)
      await mailer.sendOtpEmail({ to: value, code, preset, context })
    },

    async verifyChallenge({ email, code }) {
      const value = normalizeEmail(email)
      const ch = await otpStore.findActiveByValue(value, now())
      if (!ch) throw new OtpVerifyError('no_active_challenge')
      if (ch.attempts >= maxAttempts) {
        await otpStore.markConsumed(ch.id, now())
        throw new OtpVerifyError('too_many_attempts')
      }
      if (!codesMatch(code, ch.codeHash, pepper)) {
        await otpStore.recordAttempt(ch.id)
        if (ch.attempts + 1 >= maxAttempts) await otpStore.markConsumed(ch.id, now()) // burn on the 5th wrong
        throw new OtpVerifyError('invalid_code')
      }
      await otpStore.markConsumed(ch.id, now()) // single use
      let subject = await userStore.findUserIdByEmail(value)
      if (!subject) {
        subject = newSubject()
        await userStore.createUserWithEmailIdentity(subject, value, now())
      }
      return { subject }
    },
  }
}
```

- [ ] **Step 4: Run to verify they pass.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign/otp-service` → Expected: PASS (all security-contract rows).

- [ ] **Step 5: Commit.**

```bash
git add src/sovereign/otp-service.ts test/sovereign/otp-service.test.ts
git commit -m "feat(roebel-id): keystone OTP service (attempt caps, rate limits, TTL, find-or-create usr_)"
```

---

## Task 7: Sovereign claims resolver

**Files:**
- Create: `src/claims/sovereign-resolver.ts`
- Test: `test/sovereign/sovereign-resolver.test.ts`

**Interfaces:**
- Consumes: `UserStore` (Task 4); `NetizenClaims` (`src/claims/types.ts`); `memberHandle` (`src/claims/resolver.ts`).
- Produces: `createSovereignClaimsResolver(userStore: UserStore): (subject: string) => Promise<NetizenClaims>`.

Claims in sovereign mode come from the keystone's own store — no Supabase, no Gnosis (spec §6.1, DoD §9.7). `groups` is `[]` (a fresh sovereign account holds no CitizenNFT/AttesterNFT; Ortis derives its own roles from its own tables — kickoff I4 trust rule). `preferred_username` stays pseudonymous (never the email or the raw `sub`).

- [ ] **Step 1: Write the failing tests.**

```ts
// test/sovereign/sovereign-resolver.test.ts
import { describe, it, expect } from 'vitest'
import { createSovereignClaimsResolver } from '../../src/claims/sovereign-resolver.js'
import { createInMemoryUserStore } from '../../src/sovereign/stores.js'

describe('sovereign claims resolver', () => {
  it('serves email + email_verified from the keystone store, groups empty, human actor', async () => {
    const store = createInMemoryUserStore()
    await store.createUserWithEmailIdentity('usr_abc', 'bob@example.de', 1_000_000)
    const claims = await createSovereignClaimsResolver(store)('usr_abc')
    expect(claims.sub).toBe('usr_abc')
    expect(claims.email).toBe('bob@example.de')
    expect(claims.email_verified).toBe(true)
    expect(claims.groups).toEqual([])
    expect(claims['netizen:actor_type']).toBe('human')
  })

  it('preferred_username is pseudonymous — never the email or the raw sub', async () => {
    const store = createInMemoryUserStore()
    await store.createUserWithEmailIdentity('usr_abc', 'bob@example.de', 1_000_000)
    const claims = await createSovereignClaimsResolver(store)('usr_abc')
    expect(claims.preferred_username).not.toBe('usr_abc')
    expect(claims.preferred_username).not.toContain('bob@example.de')
    expect(claims.preferred_username && claims.preferred_username.length).toBeGreaterThan(0)
  })

  it('an unknown subject yields no email but still resolves (no throw)', async () => {
    const claims = await createSovereignClaimsResolver(createInMemoryUserStore())('usr_missing')
    expect(claims.sub).toBe('usr_missing')
    expect(claims.email).toBeUndefined()
    expect(claims.email_verified).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run to verify they fail.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign-resolver` → Expected: FAIL.

- [ ] **Step 3: Implement `src/claims/sovereign-resolver.ts`.**

```ts
import type { NetizenClaims } from './types.js'
import { memberHandle } from './resolver.js'
import type { UserStore } from '../sovereign/stores.js'

/** Sovereign-mode claims: sourced ENTIRELY from the keystone's own store — no Supabase read,
 *  no Gnosis call (spec §6.1, DoD §9.7). A fresh sovereign account holds no on-chain NFT, so
 *  `groups` is empty; relying parties derive authorization from their OWN tables. */
export function createSovereignClaimsResolver(userStore: UserStore): (subject: string) => Promise<NetizenClaims> {
  return async (subject: string): Promise<NetizenClaims> => {
    const identities = await userStore.getIdentities(subject)
    const email = identities.find((i) => i.kind === 'email')?.value
    return {
      sub: subject,
      email,
      email_verified: email ? true : undefined,
      preferred_username: memberHandle(subject), // pseudonymous digest of the sub, never the email
      groups: [],
      'netizen:citizen': false,
      'netizen:attester': false,
      'netizen:actor_type': 'human',
    }
  }
}
```

- [ ] **Step 4: Run to verify they pass.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign-resolver` → Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/claims/sovereign-resolver.ts test/sovereign/sovereign-resolver.test.ts
git commit -m "feat(roebel-id): sovereign claims resolver (own store only, no Supabase/Gnosis)"
```

---

## Task 8: Postgres store backing (pool + OIDC adapter + user/otp stores) + migration

**Files:**
- Modify: `package.json` (add `pg` + `@types/pg`)
- Create: `src/store/pg-pool.ts`, `src/store/pg-oidc-adapter.ts`, `src/sovereign/pg-stores.ts`, `migrations/002_sovereign_identity.sql`
- Test: `test/store/pg-oidc-adapter.test.ts`, `test/sovereign/pg-stores.test.ts`

**Interfaces:**
- Produces: `Queryable { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> }`; `createPgPool(opts: { databaseUrl: string; schema: string }): Queryable & { end(): Promise<void> }`; `qualified(schema: string, table: string): string`; `makePgAdapterFactory(deps: { db: Queryable; schema: string }): (name: string) => Adapter`; `createPgUserStore(deps: { db: Queryable; schema: string }): UserStore`; `createPgOtpStore(deps: { db: Queryable; schema: string }): OtpStore`.

Tested DB-less with a recording-fake `Queryable` (mirrors how `test/supabase-adapter.test.ts` drives the Supabase adapter through a fake). The real Postgres run is validated operationally against the migration (OPS — Max applies `002_sovereign_identity.sql`).

- [ ] **Step 1: Add the dependency.** In `apps/roebel-id/package.json` add `"pg": "^8.12.0"` to `dependencies` and `"@types/pg": "^8.11.6"` to `devDependencies`. Run `pnpm --filter @roebel/roebel-id install`.

- [ ] **Step 2: Write the migration `migrations/002_sovereign_identity.sql`.**

```sql
-- Sovereign-mode (AUTH_MODE=sovereign) identity store. Lives in its OWN schema so it shares
-- no tables with any community's app data — the tenant-independence gap from Phase A (spec §4.1).
-- Apply this to the Postgres named by DATABASE_URL. NOT applied to Röbel's Supabase.
create schema if not exists netizen_id;

create table if not exists netizen_id.users (
  id          text primary key,                    -- usr_… opaque subject
  created_at  timestamptz not null default now()
);

create table if not exists netizen_id.identities (
  user_id      text not null references netizen_id.users(id) on delete cascade,
  kind         text not null,                       -- 'email' | 'phone' | 'oauth:google' | ...
  value        text not null,                       -- normalised (email lowercased, phone E.164)
  verified_at  timestamptz not null default now(),
  primary key (user_id, kind, value),
  unique (kind, value)                              -- one identifier belongs to exactly one person
);

create table if not exists netizen_id.otp_challenges (
  id           text primary key,
  kind         text not null default 'email',
  value        text not null,
  code_hash    text not null,                       -- HMAC-SHA256(code, OTP_PEPPER); pepper NOT in DB
  expires_at   timestamptz not null,
  attempts     integer not null default 0,
  consumed_at  timestamptz,
  ip           text,
  created_at   timestamptz not null default now()
);
create index if not exists otp_challenges_value_created on netizen_id.otp_challenges (value, created_at);
create index if not exists otp_challenges_ip_created    on netizen_id.otp_challenges (ip, created_at);

-- Same OIDC payload store as migrations/001, but in the sovereign schema so a sovereign
-- instance needs no Supabase at all (DoD §9.7).
create table if not exists netizen_id.oidc_payloads (
  id text not null,
  type text not null,
  payload jsonb not null,
  grant_id text,
  user_code text,
  uid text,
  expires_at timestamptz,
  primary key (type, id)
);
create index if not exists oidc_payloads_uid       on netizen_id.oidc_payloads (uid);
create index if not exists oidc_payloads_user_code on netizen_id.oidc_payloads (user_code);
create index if not exists oidc_payloads_grant_id  on netizen_id.oidc_payloads (grant_id);
```

- [ ] **Step 3: Write the failing adapter + store tests** (recording-fake `Queryable`):

```ts
// test/store/pg-oidc-adapter.test.ts
import { describe, it, expect } from 'vitest'
import { makePgAdapterFactory } from '../../src/store/pg-oidc-adapter.js'

function recordingDb(rowsFor: (sql: string) => any[] = () => []) {
  const calls: { text: string; params?: unknown[] }[] = []
  return {
    calls,
    db: { async query(text: string, params?: unknown[]) { calls.push({ text, params }); return { rows: rowsFor(text) } } },
  }
}

describe('pg oidc adapter', () => {
  it('upserts into the schema-qualified oidc_payloads with the panva payload columns', async () => {
    const { db, calls } = recordingDb()
    const adapter = makePgAdapterFactory({ db, schema: 'netizen_id' })('Session')
    await adapter.upsert('id-1', { uid: 'u1', accountId: 'usr_x' } as any, 1200)
    expect(calls[0].text).toMatch(/insert into netizen_id\.oidc_payloads/i)
    expect(calls[0].text).toMatch(/on conflict/i)
    expect(calls[0].params).toContain('id-1')
    expect(calls[0].params).toContain('u1')
  })

  it('find returns the stored payload, findByUid queries the uid column', async () => {
    const { db, calls } = recordingDb((sql) =>
      /where uid/i.test(sql) ? [{ payload: { uid: 'u1' } }] : [{ payload: { accountId: 'usr_x' } }])
    const adapter = makePgAdapterFactory({ db, schema: 'netizen_id' })('Session')
    expect(await adapter.find('id-1')).toEqual({ accountId: 'usr_x' })
    expect((await adapter.findByUid('u1'))).toEqual({ uid: 'u1' })
    expect(calls.some((c) => /where uid = \$1/i.test(c.text))).toBe(true)
  })
})
```

```ts
// test/sovereign/pg-stores.test.ts
import { describe, it, expect } from 'vitest'
import { createPgUserStore, createPgOtpStore } from '../../src/sovereign/pg-stores.js'

function recordingDb(rowsFor: (sql: string) => any[] = () => []) {
  const calls: { text: string; params?: unknown[] }[] = []
  return { calls, db: { async query(text: string, params?: unknown[]) { calls.push({ text, params }); return { rows: rowsFor(text) } } } }
}

describe('pg user store', () => {
  it('finds a subject by email by joining identities', async () => {
    const { db, calls } = recordingDb(() => [{ user_id: 'usr_x' }])
    const store = createPgUserStore({ db, schema: 'netizen_id' })
    expect(await store.findUserIdByEmail('bob@example.de')).toBe('usr_x')
    expect(calls[0].text).toMatch(/netizen_id\.identities/i)
    expect(calls[0].params).toEqual(['email', 'bob@example.de'])
  })

  it('create inserts a user row and an email identity row', async () => {
    const { db, calls } = recordingDb()
    const store = createPgUserStore({ db, schema: 'netizen_id' })
    await store.createUserWithEmailIdentity('usr_x', 'bob@example.de', 1_000_000)
    expect(calls.some((c) => /insert into netizen_id\.users/i.test(c.text))).toBe(true)
    expect(calls.some((c) => /insert into netizen_id\.identities/i.test(c.text))).toBe(true)
  })
})

describe('pg otp store', () => {
  it('countSince builds a value-scoped count over the window', async () => {
    const { db, calls } = recordingDb(() => [{ n: '2' }])
    const store = createPgOtpStore({ db, schema: 'netizen_id' })
    expect(await store.countSince({ value: 'bob@example.de', since: 1_000_000 })).toBe(2)
    expect(calls[0].text).toMatch(/count\(\*\)/i)
    expect(calls[0].text).toMatch(/netizen_id\.otp_challenges/i)
  })
})
```

- [ ] **Step 4: Run to verify they fail.** Run: `pnpm --filter @roebel/roebel-id test -- pg-oidc-adapter pg-stores` → Expected: FAIL.

- [ ] **Step 5: Implement `src/store/pg-pool.ts`.**

```ts
import { Pool } from 'pg'

export interface Queryable { query(text: string, params?: unknown[]): Promise<{ rows: any[] }> }

/** Schema-qualify a table name safely. The schema is validated at config load
 *  (DB_SCHEMA matches /^[a-z_][a-z0-9_]*$/), so interpolation here is injection-safe. */
export function qualified(schema: string, table: string): string {
  return `${schema}.${table}`
}

export function createPgPool(opts: { databaseUrl: string; schema: string }): Queryable & { end(): Promise<void> } {
  const pool = new Pool({ connectionString: opts.databaseUrl })
  return {
    query: (text, params) => pool.query(text, params as unknown[]),
    end: () => pool.end(),
  }
}
```

- [ ] **Step 6: Implement `src/store/pg-oidc-adapter.ts`** — the panva `Adapter` contract over Postgres, mirroring `src/store/supabase-adapter.ts` semantics (same columns, `findByUid`/`findByUserCode` unscoped by type, `consume` sets `payload.consumed` while preserving `expires_at`):

```ts
import type { Adapter, AdapterPayload } from 'oidc-provider'
import type { Queryable } from './pg-pool.js'
import { qualified } from './pg-pool.js'

export function makePgAdapterFactory(deps: { db: Queryable; schema: string }): (name: string) => Adapter {
  const table = qualified(deps.schema, 'oidc_payloads')
  const { db } = deps
  return (name: string): Adapter => ({
    async upsert(id, payload, expiresIn) {
      const expiresAt = expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null
      await db.query(
        `insert into ${table} (id, type, payload, grant_id, user_code, uid, expires_at)
         values ($1,$2,$3,$4,$5,$6,$7)
         on conflict (type, id) do update set payload = excluded.payload,
           grant_id = excluded.grant_id, user_code = excluded.user_code,
           uid = excluded.uid, expires_at = excluded.expires_at`,
        [id, name, payload, (payload as AdapterPayload).grantId ?? null,
         (payload as AdapterPayload).userCode ?? null, (payload as AdapterPayload).uid ?? null, expiresAt],
      )
    },
    async find(id) {
      const { rows } = await db.query(`select payload from ${table} where type = $1 and id = $2`, [name, id])
      return rows[0] ? (rows[0].payload as AdapterPayload) : undefined
    },
    async findByUid(uid) {
      const { rows } = await db.query(`select payload from ${table} where uid = $1`, [uid])
      return rows[0] ? (rows[0].payload as AdapterPayload) : undefined
    },
    async findByUserCode(userCode) {
      const { rows } = await db.query(`select payload from ${table} where user_code = $1`, [userCode])
      return rows[0] ? (rows[0].payload as AdapterPayload) : undefined
    },
    async consume(id) {
      const { rows } = await db.query(`select payload from ${table} where type = $1 and id = $2`, [name, id])
      if (!rows[0]) return
      const payload = { ...rows[0].payload, consumed: Math.floor(Date.now() / 1000) }
      await db.query(`update ${table} set payload = $3 where type = $1 and id = $2`, [name, id, payload])
    },
    async destroy(id) { await db.query(`delete from ${table} where type = $1 and id = $2`, [name, id]) },
    async revokeByGrantId(grantId) { await db.query(`delete from ${table} where grant_id = $1`, [grantId]) },
  })
}
```

- [ ] **Step 7: Implement `src/sovereign/pg-stores.ts`.**

```ts
import type { Queryable } from '../store/pg-pool.js'
import { qualified } from '../store/pg-pool.js'
import type { UserStore, OtpStore, Identity, OtpChallenge } from './stores.js'

const iso = (ms: number) => new Date(ms).toISOString()
const ms = (ts: string | null) => (ts ? new Date(ts).getTime() : 0)

export function createPgUserStore(deps: { db: Queryable; schema: string }): UserStore {
  const users = qualified(deps.schema, 'users')
  const identities = qualified(deps.schema, 'identities')
  const { db } = deps
  return {
    async findUserIdByEmail(email) {
      const { rows } = await db.query(
        `select user_id from ${identities} where kind = $1 and value = $2`, ['email', email])
      return rows[0]?.user_id ?? null
    },
    async createUserWithEmailIdentity(subject, email, now) {
      await db.query(`insert into ${users} (id, created_at) values ($1, $2)`, [subject, iso(now)])
      await db.query(
        `insert into ${identities} (user_id, kind, value, verified_at) values ($1,$2,$3,$4)`,
        [subject, 'email', email, iso(now)])
    },
    async getIdentities(subject) {
      const { rows } = await db.query(
        `select kind, value, verified_at from ${identities} where user_id = $1`, [subject])
      return rows.map((r): Identity => ({ kind: r.kind, value: r.value, verifiedAt: ms(r.verified_at) }))
    },
  }
}

export function createPgOtpStore(deps: { db: Queryable; schema: string }): OtpStore {
  const t = qualified(deps.schema, 'otp_challenges')
  const { db } = deps
  return {
    async burnActiveForValue(value, now) {
      await db.query(
        `update ${t} set consumed_at = $2 where value = $1 and consumed_at is null and expires_at > $2`,
        [value, iso(now)])
    },
    async create(c: OtpChallenge) {
      await db.query(
        `insert into ${t} (id, kind, value, code_hash, expires_at, attempts, consumed_at, ip, created_at)
         values ($1,'email',$2,$3,$4,$5,$6,$7,$8)`,
        [c.id, c.value, c.codeHash, iso(c.expiresAt), c.attempts,
         c.consumedAt ? iso(c.consumedAt) : null, c.ip, iso(c.createdAt)])
    },
    async findActiveByValue(value, now) {
      const { rows } = await db.query(
        `select * from ${t} where value = $1 and consumed_at is null and expires_at > $2
         order by created_at desc limit 1`, [value, iso(now)])
      const r = rows[0]
      if (!r) return null
      return {
        id: r.id, value: r.value, codeHash: r.code_hash, expiresAt: ms(r.expires_at),
        attempts: r.attempts, consumedAt: r.consumed_at ? ms(r.consumed_at) : null,
        ip: r.ip, createdAt: ms(r.created_at),
      }
    },
    async recordAttempt(id) { await db.query(`update ${t} set attempts = attempts + 1 where id = $1`, [id]) },
    async markConsumed(id, now) { await db.query(`update ${t} set consumed_at = $2 where id = $1`, [id, iso(now)]) },
    async countSince({ value, ip, since }) {
      const col = value !== undefined ? 'value' : 'ip'
      const arg = value !== undefined ? value : ip
      const { rows } = await db.query(
        `select count(*)::int as n from ${t} where ${col} = $1 and created_at >= $2`, [arg, iso(since)])
      return Number(rows[0]?.n ?? 0)
    },
  }
}
```

- [ ] **Step 8: Run to verify they pass + build.** Run: `pnpm --filter @roebel/roebel-id test -- pg-oidc-adapter pg-stores` and `pnpm --filter @roebel/roebel-id build` → Expected: PASS.

- [ ] **Step 9: Commit.**

```bash
git add package.json ../../pnpm-lock.yaml migrations/002_sovereign_identity.sql src/store/pg-pool.ts src/store/pg-oidc-adapter.ts src/sovereign/pg-stores.ts test/store/pg-oidc-adapter.test.ts test/sovereign/pg-stores.test.ts
git commit -m "feat(roebel-id): Postgres backing for sovereign mode (pool, OIDC adapter, user/otp stores) + migration 002"
```

---

## Task 9: Extract the shared `finishLoginInteraction` helper (thirdweb byte-stable)

**Files:**
- Create: `src/interaction/finish-login.ts`
- Modify: `src/interaction/router.ts`
- Test: `test/e2e-flow.test.ts` (unchanged — the guard), plus a small unit test `test/interaction/finish-login.test.ts`

**Interfaces:**
- Consumes: `NETIZEN_RESOURCE_SCOPE` (`src/oidc/resource.ts`); `Provider` (oidc-provider); Express `Request`/`Response`.
- Produces: `class UnsupportedClientError extends Error {}`; `finishLoginInteraction(deps: { provider: Provider; req: Request; res: Response; subject: string; firstPartyClientIds: Set<string> }): Promise<{ redirectTo: string }>`.

The consent + resource-grant logic is identical for both auth modes; only the subject differs (wallet address vs `usr_…`). Extract it once so the sovereign router reuses it verbatim. The existing `test/e2e-flow.test.ts` fully covers the thirdweb path and is the proof this refactor changed no behaviour.

- [ ] **Step 1: Write the failing unit test.**

```ts
// test/interaction/finish-login.test.ts
import { describe, it, expect } from 'vitest'
import { finishLoginInteraction, UnsupportedClientError } from '../../src/interaction/finish-login.js'

describe('finishLoginInteraction', () => {
  it('throws UnsupportedClientError for a client_id outside the first-party set (fail closed)', async () => {
    const provider: any = {
      interactionDetails: async () => ({ params: { client_id: 'stranger', scope: 'openid' } }),
    }
    await expect(finishLoginInteraction({
      provider, req: {} as any, res: {} as any, subject: 'usr_x',
      firstPartyClientIds: new Set(['ortis']),
    })).rejects.toBeInstanceOf(UnsupportedClientError)
  })

  it('grants the OIDC scope and returns the resume redirect for a first-party client', async () => {
    const saved: any = {}
    class Grant {
      constructor(public a: any) { saved.grant = this.a }
      addOIDCScope(s: string) { saved.scope = s }
      addResourceScope() {}
      async save() { return 'grant-1' }
    }
    const provider: any = {
      Grant,
      interactionDetails: async () => ({ params: { client_id: 'ortis', scope: 'openid email' } }),
      interactionResult: async (_q: any, _s: any, result: any) => { saved.result = result; return '/resume/xyz' },
    }
    const out = await finishLoginInteraction({
      provider, req: {} as any, res: {} as any, subject: 'usr_x',
      firstPartyClientIds: new Set(['ortis']),
    })
    expect(out.redirectTo).toBe('/resume/xyz')
    expect(saved.grant).toEqual({ accountId: 'usr_x', clientId: 'ortis' })
    expect(saved.scope).toBe('openid email')
    expect(saved.result).toEqual({ login: { accountId: 'usr_x' }, consent: { grantId: 'grant-1' } })
  })
})
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @roebel/roebel-id test -- finish-login` → Expected: FAIL.

- [ ] **Step 3: Implement `src/interaction/finish-login.ts`** — lift the body of the current `router.ts` POST `/login` handler (lines ~41–111) that runs *after* `verifyLogin`, parameterized by `subject`:

```ts
import type { Request, Response } from 'express'
import type Provider from 'oidc-provider'
import { NETIZEN_RESOURCE_SCOPE } from '../oidc/resource.js'

/** A client_id outside the first-party set reached a login finisher. By construction this
 *  cannot fire (the provider rejects unknown client_ids before an interaction exists), but the
 *  fail-closed guard stays so wiring a non-first-party client in some future flow is a
 *  conscious act, not a silent auto-grant. Callers map this to HTTP 400 unsupported_client. */
export class UnsupportedClientError extends Error {
  constructor() { super('unsupported_client'); this.name = 'UnsupportedClientError' }
}

/** Finish the pending OIDC interaction for `subject`, pre-granting the requested scope (and,
 *  if present, the signer resource scope) so a first-party login resolves in one round trip.
 *  Shared by both AUTH_MODEs — the only difference between them is what `subject` is (a wallet
 *  address in thirdweb mode, a usr_… id in sovereign mode). See src/oidc/router comments for
 *  the resource-scope intersection rationale. */
export async function finishLoginInteraction(deps: {
  provider: Provider; req: Request; res: Response; subject: string; firstPartyClientIds: Set<string>
}): Promise<{ redirectTo: string }> {
  const { provider, req, res, subject, firstPartyClientIds } = deps
  const details = await provider.interactionDetails(req, res)
  const { params } = details
  if (!firstPartyClientIds.has(String(params.client_id))) throw new UnsupportedClientError()

  const grant = new provider.Grant({ accountId: subject, clientId: String(params.client_id) })
  if (typeof params.scope === 'string' && params.scope.length > 0) grant.addOIDCScope(params.scope)
  if (
    typeof params.resource === 'string' && params.resource.length > 0 &&
    typeof params.scope === 'string' && params.scope.length > 0
  ) {
    const available = new Set(NETIZEN_RESOURCE_SCOPE.split(' '))
    const resourceScope = params.scope.split(' ').filter((s) => available.has(s)).join(' ')
    if (resourceScope) grant.addResourceScope(params.resource, resourceScope)
  }
  const grantId = await grant.save()
  const redirectTo = await provider.interactionResult(
    req, res, { login: { accountId: subject }, consent: { grantId } }, { mergeWithLastSubmission: false },
  )
  return { redirectTo: String(redirectTo) }
}
```

- [ ] **Step 4: Refactor `src/interaction/router.ts` POST `/login`** to call the helper. Replace the body from the `const details = await provider.interactionDetails(...)` line down to the `res.json({ redirectTo })` with:

```ts
  router.post('/interaction/:uid/login', express.json(), async (req, res) => {
    try {
      const { address } = await bridge.verifyLogin({ message: req.body.message, signature: req.body.signature })
      const { redirectTo } = await finishLoginInteraction({ provider, req, res, subject: address, firstPartyClientIds })
      res.json({ redirectTo })
    } catch (e) {
      if (e instanceof UnsupportedClientError) { res.status(400).json({ error: 'unsupported_client' }); return }
      const message = e instanceof Error ? e.message : String(e)
      // eslint-disable-next-line no-console
      console.error('interaction login failed:', message)
      res.status(401).json({ error: 'authentication_failed' })
    }
  })
```

Add `import { finishLoginInteraction, UnsupportedClientError } from './finish-login.js'` at the top and delete the now-duplicated `NETIZEN_RESOURCE_SCOPE` import if it is no longer referenced elsewhere in the file (the GET/nonce handlers do not use it). Keep the GET handler, the `/nonce` handler, `brandingByClientId`, and `firstPartyClientIds` exactly as they are.

- [ ] **Step 5: Run the FULL suite — thirdweb must be byte-stable.** Run: `pnpm --filter @roebel/roebel-id test` and `pnpm --filter @roebel/roebel-id build` → Expected: PASS, with `e2e-flow.test.ts` and `login-page.test.ts` unchanged and green. This is the golden guard for the extraction.

- [ ] **Step 6: Commit.**

```bash
git add src/interaction/finish-login.ts src/interaction/router.ts test/interaction/finish-login.test.ts
git commit -m "refactor(roebel-id): extract shared finishLoginInteraction (thirdweb behaviour unchanged)"
```

---

## Task 10: Sovereign login page (branded email-OTP HTML, no thirdweb)

**Files:**
- Create: `src/interaction/sovereign-login-page.ts`
- Test: `test/interaction/sovereign-login-page.test.ts`

**Interfaces:**
- Consumes: `BrandingConfig` (`src/config.ts`); `PRESETS` (`src/interaction/login-page.ts`) for title/heading/intro/colors (reuse, do not duplicate the palette).
- Produces: `renderSovereignLoginPage(uid: string, branding: BrandingConfig): string`.

A dependency-free page: an email field posting to `/interaction/:uid/otp/start`, then a code field posting to `/interaction/:uid/otp/verify`. No thirdweb, no `esm.sh`, no SIWE, no chain. German copy — MAX REVIEW. The existing thirdweb `renderLoginPage` and its golden test are untouched.

- [ ] **Step 1: Write the failing tests.**

```ts
// test/interaction/sovereign-login-page.test.ts
import { describe, it, expect } from 'vitest'
import { renderSovereignLoginPage } from '../../src/interaction/sovereign-login-page.js'

const ROEBEL_TRACE = /r(ö|oe)bel/i

describe('renderSovereignLoginPage', () => {
  it('has an email step and a code step posting to the OTP endpoints for this uid', () => {
    const html = renderSovereignLoginPage('uid-9', { preset: 'ortis' })
    expect(html).toContain('/interaction/uid-9/otp/start')
    expect(html).toContain('/interaction/uid-9/otp/verify')
    expect(html).toContain('type="email"')
  })

  it('contains NO thirdweb / esm.sh / SIWE / wallet code — the keystone owns this login', () => {
    const html = renderSovereignLoginPage('uid-9', { preset: 'ortis' })
    expect(html).not.toContain('thirdweb')
    expect(html).not.toContain('esm.sh')
    expect(html.toLowerCase()).not.toContain('siwe')
    expect(html.toLowerCase()).not.toContain('wallet')
  })

  it('ortis preset carries zero Röbel trace and no navy', () => {
    const html = renderSovereignLoginPage('uid-9', { preset: 'ortis' })
    expect(html).toContain('<h1>Ortis</h1>')
    expect(html).not.toMatch(ROEBEL_TRACE)
    expect(html).not.toContain('#00498B')
  })

  it('roebel preset renders Röbel branding and the navy color', () => {
    const html = renderSovereignLoginPage('uid-9', { preset: 'roebel' })
    expect(html).toContain('<h1>Röbel ID</h1>')
    expect(html).toContain('#00498B')
  })

  it('HTML-escapes the optional context line', () => {
    const html = renderSovereignLoginPage('uid-9', { preset: 'ortis', context: '<b>x</b>' })
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('<b>x</b>')
  })
})
```

- [ ] **Step 2: Run to verify they fail.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign-login-page` → Expected: FAIL.

- [ ] **Step 3: Implement `src/interaction/sovereign-login-page.ts`.**

```ts
import type { BrandingConfig } from '../config.js'
import { PRESETS } from './login-page.js'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** Sovereign-mode login page: keystone-owned email OTP, no thirdweb/SIWE/wallet/chain in it.
 *  Reuses the per-RP branding palette from PRESETS so an Ortis client never renders Röbel copy.
 *  German copy below is MAX REVIEW. */
export function renderSovereignLoginPage(uid: string, branding: BrandingConfig): string {
  const copy = PRESETS[branding.preset]
  const contextLine = branding.context
    ? `\n  <p style="color:${copy.secondaryColor};font-size:14px;margin:0 0 12px">${escapeHtml(branding.context)}</p>`
    : ''
  // MAX REVIEW: all visible German strings below.
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${copy.title}</title>
<style>
  body{font-family:system-ui;background:#fff;color:${copy.primaryColor};display:grid;place-items:center;min-height:100vh;margin:0}
  main{text-align:center;max-width:340px;width:90%}
  .col{display:flex;flex-direction:column;gap:10px}
  button{background:${copy.primaryColor};color:#fff;border:0;border-radius:12px;padding:13px 20px;font-size:16px;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  input{border:1px solid #B4B8C1;border-radius:12px;padding:12px 14px;font-size:16px;font-family:inherit}
  #status{color:${copy.secondaryColor};font-size:14px;min-height:20px}
</style>
</head><body>
<main>
  <h1>${copy.heading}</h1>${contextLine}
  <p>${copy.intro}</p>
  <div class="col">
    <input id="email" type="email" autocomplete="email" placeholder="E-Mail-Adresse" />
    <button id="sendCode">Code senden</button>
    <div id="codeBox" class="col" hidden>
      <input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="Bestätigungscode" />
      <button id="verify">Anmelden</button>
    </div>
  </div>
  <p id="status"></p>
</main>
<script>
  var status = document.getElementById('status');
  var $ = function (id) { return document.getElementById(id); };
  var setBusy = function (b) { var l = document.querySelectorAll('button'); for (var i = 0; i < l.length; i++) l[i].disabled = b; };

  $('sendCode').onclick = function () {
    var email = $('email').value.trim();
    if (!email) { status.textContent = 'Bitte E-Mail-Adresse eingeben'; return; }
    setBusy(true); status.textContent = 'Code wird gesendet…';
    fetch('/interaction/${uid}/otp/start', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: email }) })
      .then(function () { $('codeBox').hidden = false; status.textContent = 'Code gesendet — bitte prüfe deine E-Mails'; setBusy(false); })
      .catch(function () { status.textContent = 'Senden fehlgeschlagen'; setBusy(false); });
  };

  $('verify').onclick = function () {
    setBusy(true); status.textContent = 'Anmeldung wird geprüft…';
    fetch('/interaction/${uid}/otp/verify', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: $('email').value.trim(), code: $('code').value.trim() }) })
      .then(function (res) { if (!res.ok) throw new Error('verify'); return res.json(); })
      .then(function (j) { location.href = j.redirectTo; })
      .catch(function () { status.textContent = 'Code ungültig oder abgelaufen'; setBusy(false); });
  };
</script>
</body></html>`
}
```

- [ ] **Step 4: Run to verify they pass + confirm the thirdweb golden test is unaffected.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign-login-page login-page` → Expected: PASS (both the new sovereign page tests and the untouched `login-page.test.ts`).

- [ ] **Step 5: Commit.**

```bash
git add src/interaction/sovereign-login-page.ts test/interaction/sovereign-login-page.test.ts
git commit -m "feat(roebel-id): sovereign email-OTP login page (branded, no thirdweb)"
```

---

## Task 11: Sovereign interaction router

**Files:**
- Create: `src/interaction/sovereign-router.ts`
- Test: `test/interaction/sovereign-router.test.ts`

**Interfaces:**
- Consumes: `Provider`; `OtpService` (Task 6); `OtpVerifyError` (Task 6); `RelyingPartyConfig`/`BrandingConfig` (config); `renderSovereignLoginPage` (Task 10); `finishLoginInteraction`/`UnsupportedClientError` (Task 9).
- Produces: `createSovereignInteractionRouter(deps: { provider: Provider; otpService: OtpService; relyingParties: RelyingPartyConfig[] }): express.Router`.

Routes (spec §5): GET `/interaction/:uid` (branded sovereign page); POST `/interaction/:uid/otp/start` (`{ email }` → 202, identical body; **an unknown/expired uid is rejected before any challenge is created or mail sent** — DoD §9.8); POST `/interaction/:uid/otp/verify` (`{ email, code }` → verify → `finishLoginInteraction(subject)` → `{ redirectTo }`).

- [ ] **Step 1: Write the failing tests** (stub provider + supertest, following `test/interaction-branding.test.ts`'s style):

```ts
// test/interaction/sovereign-router.test.ts
import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { createSovereignInteractionRouter } from '../../src/interaction/sovereign-router.js'
import type { OtpService } from '../../src/sovereign/otp-service.js'
import { OtpVerifyError } from '../../src/sovereign/otp-service.js'

const RP = [{ name: 'ortis', clientId: 'ortis', clientSecret: 's', redirectUris: [], postLogoutRedirectUris: [], branding: { preset: 'ortis' as const } }]

function appWith(provider: any, otpService: OtpService) {
  const app = express()
  app.use(createSovereignInteractionRouter({ provider, otpService, relyingParties: RP as any }))
  return app
}

describe('sovereign interaction router', () => {
  it('GET renders the sovereign page for a valid login interaction', async () => {
    const provider: any = { interactionDetails: async () => ({ uid: 'u1', prompt: { name: 'login' }, params: { client_id: 'ortis' } }) }
    const otpService: any = {}
    const res = await request(appWith(provider, otpService)).get('/interaction/u1')
    expect(res.status).toBe(200)
    expect(res.text).toContain('<h1>Ortis</h1>')
    expect(res.headers['cache-control']).toContain('no-store')
  })

  it('POST /otp/start returns 202 and calls the service for a valid interaction', async () => {
    let called = 0
    const provider: any = { interactionDetails: async () => ({ params: { client_id: 'ortis' } }) }
    const otpService: any = { startChallenge: async () => { called++ } }
    const res = await request(appWith(provider, otpService)).post('/interaction/u1/otp/start').send({ email: 'bob@example.de' })
    expect(res.status).toBe(202)
    expect(called).toBe(1)
  })

  it('POST /otp/start on an UNKNOWN/expired uid sends no mail and creates no challenge (DoD §9.8)', async () => {
    let called = 0
    const provider: any = { interactionDetails: async () => { throw new Error('invalid_request: interaction session not found') } }
    const otpService: any = { startChallenge: async () => { called++ } }
    const res = await request(appWith(provider, otpService)).post('/interaction/nope/otp/start').send({ email: 'bob@example.de' })
    expect(res.status).toBe(400)
    expect(called).toBe(0)
  })

  it('POST /otp/verify finishes the interaction with the usr_ subject', async () => {
    const provider: any = {
      interactionDetails: async () => ({ params: { client_id: 'ortis', scope: 'openid' } }),
      Grant: class { constructor() {} addOIDCScope() {} addResourceScope() {} async save() { return 'g1' } },
      interactionResult: async () => '/resume/abc',
    }
    const otpService: any = { verifyChallenge: async () => ({ subject: 'usr_x' }) }
    const res = await request(appWith(provider, otpService)).post('/interaction/u1/otp/verify').send({ email: 'bob@example.de', code: '123456' })
    expect(res.status).toBe(200)
    expect(res.body.redirectTo).toBe('/resume/abc')
  })

  it('POST /otp/verify answers 401 (no code leak) on a verify failure', async () => {
    const provider: any = { interactionDetails: async () => ({ params: { client_id: 'ortis' } }) }
    const otpService: any = { verifyChallenge: async () => { throw new OtpVerifyError('invalid_code') } }
    const res = await request(appWith(provider, otpService)).post('/interaction/u1/otp/verify').send({ email: 'bob@example.de', code: '000000' })
    expect(res.status).toBe(401)
    expect(JSON.stringify(res.body)).not.toContain('000000')
  })
})
```

- [ ] **Step 2: Run to verify they fail.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign-router` → Expected: FAIL.

- [ ] **Step 3: Implement `src/interaction/sovereign-router.ts`.**

```ts
import express from 'express'
import type { Request } from 'express'
import type Provider from 'oidc-provider'
import type { BrandingConfig, RelyingPartyConfig } from '../config.js'
import type { OtpService } from '../sovereign/otp-service.js'
import { renderSovereignLoginPage } from './sovereign-login-page.js'
import { finishLoginInteraction, UnsupportedClientError } from './finish-login.js'

const FALLBACK_BRANDING: BrandingConfig = { preset: 'roebel' }

/** Best-effort client IP for per-IP rate limiting. Reads the Fly-set forwarded header first,
 *  falling back to the socket address; the app does not need trust-proxy enabled for this. */
function clientIp(req: Request): string | undefined {
  const fwd = req.headers['x-forwarded-for']
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim()
  return req.ip
}

export function createSovereignInteractionRouter(deps: {
  provider: Provider; otpService: OtpService; relyingParties: RelyingPartyConfig[]
}): express.Router {
  const router = express.Router()
  const { provider, otpService, relyingParties } = deps
  const brandingByClientId = new Map(relyingParties.map((rp) => [rp.clientId, rp.branding]))
  const firstPartyClientIds = new Set(relyingParties.map((rp) => rp.clientId))

  router.get('/interaction/:uid', async (req, res, next) => {
    try {
      const details = await provider.interactionDetails(req, res)
      if (details.prompt.name !== 'login' && details.prompt.name !== 'consent') return next()
      const branding = brandingByClientId.get(String(details.params.client_id)) ?? FALLBACK_BRANDING
      res.set('cache-control', 'no-store').send(renderSovereignLoginPage(details.uid, branding))
    } catch (e) { next(e) }
  })

  // Reject an unknown/expired interaction BEFORE any challenge is created or mail is sent, so
  // the endpoint never sends on behalf of a login nobody started (spec §5, DoD §9.8).
  router.post('/interaction/:uid/otp/start', express.json(), async (req, res) => {
    let details
    try { details = await provider.interactionDetails(req, res) }
    catch { res.status(400).json({ error: 'invalid_interaction' }); return }
    const branding = brandingByClientId.get(String(details.params.client_id)) ?? FALLBACK_BRANDING
    const email = typeof req.body?.email === 'string' ? req.body.email : ''
    // Always answer 202 with an identical body — known and unknown addresses are indistinguishable.
    if (email) {
      await otpService.startChallenge({ email, ip: clientIp(req), preset: branding.preset, context: branding.context })
    }
    res.status(202).json({ ok: true })
  })

  router.post('/interaction/:uid/otp/verify', express.json(), async (req, res) => {
    try {
      const email = typeof req.body?.email === 'string' ? req.body.email : ''
      const code = typeof req.body?.code === 'string' ? req.body.code : ''
      const { subject } = await otpService.verifyChallenge({ email, code })
      const { redirectTo } = await finishLoginInteraction({ provider, req, res, subject, firstPartyClientIds })
      res.json({ redirectTo })
    } catch (e) {
      if (e instanceof UnsupportedClientError) { res.status(400).json({ error: 'unsupported_client' }); return }
      // Generic failure — never surface the OtpVerifyError label detail or the code (spec §5.1).
      res.status(401).json({ error: 'authentication_failed' })
    }
  })

  return router
}
```

- [ ] **Step 4: Run to verify they pass.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign-router` → Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add src/interaction/sovereign-router.ts test/interaction/sovereign-router.test.ts
git commit -m "feat(roebel-id): sovereign interaction router (OTP start/verify inside the OIDC interaction)"
```

---

## Task 12: Wire sovereign mode + full sovereign e2e proof

**Files:**
- Modify: `src/wire.ts`
- Test: `test/sovereign/sovereign-e2e.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `WireOverrides` gains `otpService?: OtpService`. `wireApp` branches on `config.authMode`; the thirdweb branch is the current body verbatim; the sovereign branch wires Postgres-or-in-memory stores → mailer → OTP service → sovereign resolver → `buildProvider` → sovereign router.

- [ ] **Step 1: Write the failing sovereign e2e** (mirrors `test/e2e-flow.test.ts`: real interaction router + panva provider via `wireApp`'s DI seam; capturing mailer + in-memory stores; drives authorization_code + PKCE end to end):

```ts
// test/sovereign/sovereign-e2e.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { createServer as createNetServer } from 'node:net'
import type { Server } from 'node:http'
import { Issuer, generators } from 'openid-client'
import { generateKeyPair, exportJWK } from 'jose'
import type { Adapter, AdapterPayload } from 'oidc-provider'
import { wireApp } from '../../src/wire.js'
import type { Config } from '../../src/config.js'
import { createInMemoryUserStore, createInMemoryOtpStore } from '../../src/sovereign/stores.js'
import { createCapturingMailer } from '../../src/sovereign/mailer.js'
import { createOtpService } from '../../src/sovereign/otp-service.js'
import { createSovereignClaimsResolver } from '../../src/claims/sovereign-resolver.js'

const REDIRECT_URI = 'http://localhost:8080/ortis/callback'
const ROEBEL_TRACE = /r(ö|oe)bel/i

// (reuse the CookieJar + rawRequest + getEphemeralPort + inMemoryAdapterFactory helpers from
//  test/e2e-flow.test.ts — copy them into this file or extract to test/helpers/oidc-e2e.ts)

describe('sovereign email-OTP end-to-end (Ortis-as-relying-party, no thirdweb)', () => {
  let server: Server; let issuer: string
  const userStore = createInMemoryUserStore()
  const mailer = createCapturingMailer()

  beforeAll(async () => {
    const port = await getEphemeralPort()
    issuer = `http://localhost:${port}`
    const { privateKey } = await generateKeyPair('RS256', { extractable: true })
    const jwk = await exportJWK(privateKey); jwk.kid = 'sov-e2e'; jwk.use = 'sig'; jwk.alg = 'RS256'
    process.env.JWKS_JSON = JSON.stringify({ keys: [jwk] })

    const config: Config = {
      authMode: 'sovereign', issuer, port, cookieKeys: ['sov-e2e-cookie'],
      dbSchema: 'netizen_id', otpPepper: 'e2e-pepper', mailFrom: 'login@id.ortis.app',
      relyingParties: [{
        name: 'ortis', clientId: 'ortis', clientSecret: 'ortis-secret',
        redirectUris: [REDIRECT_URI], postLogoutRedirectUris: [], branding: { preset: 'ortis' },
      }],
    }
    const otpService = createOtpService({ userStore, otpStore: createInMemoryOtpStore(), mailer, pepper: 'e2e-pepper' })
    const { app } = wireApp(config, {
      otpService,
      resolveClaims: createSovereignClaimsResolver(userStore),
      adapterFactory: inMemoryAdapterFactory(),
    })
    server = await new Promise<Server>((resolve) => { const s = app.listen(port, () => resolve(s)) })
  })
  afterAll(async () => { delete process.env.JWKS_JSON; await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))) })

  async function login(): Promise<string> {
    const discovered = await Issuer.discover(issuer)
    const client = new discovered.Client({ client_id: 'ortis', client_secret: 'ortis-secret', redirect_uris: [REDIRECT_URI], response_types: ['code'], token_endpoint_auth_method: 'client_secret_basic' })
    const verifier = generators.codeVerifier(); const challenge = generators.codeChallenge(verifier); const state = generators.state()
    const url = client.authorizationUrl({ scope: 'openid email profile', code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: REDIRECT_URI, state })
    const jar = new CookieJar()
    let res = await rawRequest(url); jar.capture(res.headers['set-cookie'])
    const interactionUrl = new URL(res.headers.location!, issuer); const uid = interactionUrl.pathname.split('/').pop()!
    res = await rawRequest(interactionUrl.toString(), { headers: { cookie: jar.header() } }); jar.capture(res.headers['set-cookie'])
    expect(res.body).toContain('<h1>Ortis</h1>'); expect(res.body).not.toMatch(ROEBEL_TRACE)
    await rawRequest(`${issuer}/interaction/${uid}/otp/start`, { method: 'POST', headers: { cookie: jar.header(), 'content-type': 'application/json' }, body: JSON.stringify({ email: 'bob@example.de' }) })
    const code = mailer.last()!.code
    res = await rawRequest(`${issuer}/interaction/${uid}/otp/verify`, { method: 'POST', headers: { cookie: jar.header(), 'content-type': 'application/json' }, body: JSON.stringify({ email: 'bob@example.de', code }) }); jar.capture(res.headers['set-cookie'])
    const { redirectTo } = JSON.parse(res.body) as { redirectTo: string }
    res = await rawRequest(new URL(redirectTo, issuer).toString(), { headers: { cookie: jar.header() } }); jar.capture(res.headers['set-cookie'])
    const cb = new URL(res.headers.location!)
    const tokenSet = await client.callback(REDIRECT_URI, client.callbackParams(cb.toString()), { code_verifier: verifier, state })
    return String(tokenSet.claims().sub)
  }

  it('signs in with an email code, no thirdweb in the path, sub is a usr_ id (DoD §9.1)', async () => {
    const sub = await login()
    expect(sub).toMatch(/^usr_[0-9a-f]{32}$/)
  })

  it('the same person signing in again gets the same sub (DoD §9.2)', async () => {
    const first = await login(); const second = await login()
    expect(second).toBe(first)
  })
})
```

- [ ] **Step 2: Run to verify it fails.** Run: `pnpm --filter @roebel/roebel-id test -- sovereign-e2e` → Expected: FAIL (`wireApp` has no sovereign branch / no `otpService` override).

- [ ] **Step 3: Implement the sovereign branch in `src/wire.ts`.** Add `otpService?` to `WireOverrides`, and branch on `config.authMode`. Keep the existing thirdweb wiring verbatim inside the `if (config.authMode === 'thirdweb')` arm:

```ts
import { createSovereignInteractionRouter } from './interaction/sovereign-router.js'
import { createSovereignClaimsResolver } from './claims/sovereign-resolver.js'
import { createOtpService, type OtpService } from './sovereign/otp-service.js'
import { createInMemoryUserStore, createInMemoryOtpStore, type UserStore, type OtpStore } from './sovereign/stores.js'
import { createCapturingMailer, createNodemailerMailer, type Mailer } from './sovereign/mailer.js'
import { createPgPool } from './store/pg-pool.js'
import { makePgAdapterFactory } from './store/pg-oidc-adapter.js'
import { createPgUserStore, createPgOtpStore } from './sovereign/pg-stores.js'

export interface WireOverrides {
  bridge?: AuthBridge
  resolveClaims?: (subject: string) => Promise<NetizenClaims>
  adapterFactory?: (name: string) => Adapter
  otpService?: OtpService
}

export function wireApp(config: Config = loadConfig(), overrides: WireOverrides = {}) {
  if (config.authMode === 'sovereign') return wireSovereign(config, overrides)

  // ---- thirdweb mode: UNCHANGED from the original wireApp body ----
  const bridge = overrides.bridge ?? createThirdwebAuthBridge({
    config, nonceStore: createMemoryNonceStore(), verifier: createGnosisVerifier(config),
  })
  const resolveClaims = overrides.resolveClaims ?? createClaimsResolver(createReaders(config))
  const adapterFactory = overrides.adapterFactory ?? makeSupabaseAdapterFactory({
    client: createClient(config.supabaseUrl, config.supabaseServiceKey),
  })
  const provider = buildProvider({ config, adapterFactory, resolveClaims })
  const interactionRouter = createInteractionRouter({
    provider, bridge, thirdwebClientId: config.thirdwebClientId, chainId: config.chainId,
    relyingParties: config.relyingParties,
  })
  const app = createApp({ provider, interactionRouter, relyingParties: config.relyingParties })
  return { app, provider, bridge }
}

function wireSovereign(config: SovereignConfig, overrides: WireOverrides) {
  // Postgres when DATABASE_URL is set (production, sub stable across restarts); in-memory otherwise
  // (local dev only — NOT persistent). Same shape as the existing createMemoryNonceStore fallback.
  let userStore: UserStore, otpStore: OtpStore, adapterFactory: (name: string) => Adapter
  if (config.databaseUrl) {
    const db = createPgPool({ databaseUrl: config.databaseUrl, schema: config.dbSchema })
    userStore = createPgUserStore({ db, schema: config.dbSchema })
    otpStore = createPgOtpStore({ db, schema: config.dbSchema })
    adapterFactory = overrides.adapterFactory ?? makePgAdapterFactory({ db, schema: config.dbSchema })
  } else {
    userStore = createInMemoryUserStore()
    otpStore = createInMemoryOtpStore()
    adapterFactory = overrides.adapterFactory ?? makeInMemoryOidcAdapter() // small local helper; or require adapterFactory in dev
  }
  const mailer: Mailer = config.smtpUrl ? createNodemailerMailer({ smtpUrl: config.smtpUrl, from: config.mailFrom }) : createCapturingMailer()
  const otpService = overrides.otpService ?? createOtpService({ userStore, otpStore, mailer, pepper: config.otpPepper })
  const resolveClaims = overrides.resolveClaims ?? createSovereignClaimsResolver(userStore)
  const provider = buildProvider({ config, adapterFactory, resolveClaims })
  const interactionRouter = createSovereignInteractionRouter({ provider, otpService, relyingParties: config.relyingParties })
  const app = createApp({ provider, interactionRouter, relyingParties: config.relyingParties })
  return { app, provider }
}
```

Notes for the implementer: import `SovereignConfig` from `./config.js`. For the in-memory OIDC adapter fallback (`makeInMemoryOidcAdapter`), reuse the `inMemoryAdapterFactory` pattern from `test/e2e-flow.test.ts` — either lift it into `src/store/memory-oidc-adapter.ts` (preferred, one source) or require callers to pass `adapterFactory` in dev. The sovereign e2e passes `adapterFactory` explicitly, so it does not depend on that choice.

- [ ] **Step 4: Run to verify it passes + full suite + build.** Run: `pnpm --filter @roebel/roebel-id test` and `pnpm --filter @roebel/roebel-id build` → Expected: PASS, including the sovereign e2e (usr_ sub, stable sub) AND every thirdweb test unchanged.

- [ ] **Step 5: Commit.**

```bash
git add src/wire.ts test/sovereign/sovereign-e2e.test.ts src/store/memory-oidc-adapter.ts
git commit -m "feat(roebel-id): wire sovereign mode + full email-OTP e2e (usr_ sub, no thirdweb)"
```

---

## Task 13: Documentation — env schema, `.env.example`, Fly runbook

**Files:**
- Modify: `README.md`, `.env.example`

No automated test (documentation). This task packages the operational contract so Max can deploy.

- [ ] **Step 1: Add sovereign vars to `.env.example`** (after the JWKS line), commented since `roebel-id` itself stays thirdweb:

```
# --- Sovereign mode (a NEW community instance; roebel-id/ortis-id stay AUTH_MODE=thirdweb) ---
# AUTH_MODE=sovereign
# DATABASE_URL=postgres://user:pass@host:5432/dbname   # required in prod; unset = in-memory dev only
# DB_SCHEMA=netizen_id                                  # default netizen_id
# OTP_PEPPER=__set_in_fly_secrets__                     # HMAC key for OTP codes; NEVER in the DB
# MAIL_FROM=login@id.example.app
# SMTP_URL=smtp://user:pass@smtp.host:587               # unset in dev = capturing mailer (no real send); Mailhog: smtp://localhost:1025
# In sovereign mode SUPABASE_URL / SUPABASE_SERVICE_KEY / THIRDWEB_CLIENT_ID / GNOSIS_RPC_URL /
# CITIZEN_NFT_ADDRESS / ATTESTER_NFT_ADDRESS are NOT read and need not be set.
```

- [ ] **Step 2: Add a README "Environment variables → Sovereign mode" subsection** documenting `AUTH_MODE`, `DATABASE_URL`, `DB_SCHEMA`, `OTP_PEPPER`, `MAIL_FROM`, `SMTP_URL`, and stating which core vars become unnecessary. State the security invariants (OTP_PEPPER never in the DB; codes never logged).

- [ ] **Step 3: Add a README "Running a sovereign-mode instance" runbook** modeled on the existing "Running a second instance for another community" section, but for `AUTH_MODE=sovereign`. It MUST list the operational steps (all **OPS — MAX**):
  1. Provision the sovereign Postgres (or a `netizen_id` schema on Ortis's Postgres) and confirm it is **reachable from Fly** (spec §4.1 — if not reachable, use a dedicated Postgres). Set `DATABASE_URL`.
  2. Apply the migration: `psql "$DATABASE_URL" -f migrations/002_sovereign_identity.sql`.
  3. `fly secrets set AUTH_MODE=sovereign DATABASE_URL=... OTP_PEPPER=<strong-random> MAIL_FROM=... SMTP_URL=... ISSUER_URL=... COOKIE_KEYS=... JWKS_JSON=... <ORTIS_* or the relying-party block> -a <app>` (do NOT set SUPABASE_*/THIRDWEB_*/GNOSIS_*).
  4. Stand up / point at the node's SMTP (Mailhog for local dev).
  5. `cd apps/roebel-id && fly deploy -c <config>`; then DNS/cert exactly as the ortis-id runbook.
  6. Verify: `curl https://<host>/healthz`, then a real email-OTP login end to end.

- [ ] **Step 4: Add a "What is NOT needed" note** killing the stale I2b thirdweb-dashboard gate: under C1, thirdweb is removed from the login path entirely, so **no thirdweb Custom Auth / dashboard configuration is required** (this supersedes `NETIZEN_IDENTITY_KICKOFF.md` §I2b). Sovereign accounts are the signer's EOAs; the signer is not called during login (spec §4, §6.3) — this plan does not touch the signer.

- [ ] **Step 5: Build + full suite (docs must not break the build's type refs) and commit.**

```bash
pnpm --filter @roebel/roebel-id test && pnpm --filter @roebel/roebel-id build
git add README.md .env.example
git commit -m "docs(roebel-id): sovereign AUTH_MODE env schema + Fly runbook (supersedes I2b thirdweb path)"
```

---

## Operational runbook (OPS — MAX; not executed by this plan)

| Gate | What | Why it is not a code step |
|---|---|---|
| Postgres | Provision the sovereign DB (or `netizen_id` schema on Ortis's Postgres) **and confirm reachability from Fly** (spec §4.1 hedge). Set `DATABASE_URL`. | Infra provisioning + network reachability; the biggest unknown (see risks). |
| Migration | `psql "$DATABASE_URL" -f apps/roebel-id/migrations/002_sovereign_identity.sql`. | Runs against a live DB. |
| Secrets | `fly secrets set AUTH_MODE=sovereign OTP_PEPPER=<strong> MAIL_FROM=… SMTP_URL=… DATABASE_URL=… ISSUER_URL/COOKIE_KEYS/JWKS_JSON + RP block`. | Production secrets; Max owns Fly (kickoff §3). |
| SMTP | Node's own SMTP endpoint (Mailhog for local dev). | Infra. |
| Deploy + DNS/cert | `fly deploy -c <cfg>`; `fly certs add <host>`; DNS as in the ortis-id runbook. | Deploy is Max's (kickoff §3). |
| thirdweb dashboard | **Nothing.** C1 removes thirdweb from the path — the I2b Custom-Auth gate no longer applies. | Recorded correction (see risks). |

## Spec coverage map (self-review)

| Spec / DoD item | Task |
|---|---|
| §2 opaque `usr_…` subject | 2, 6 |
| §4 mode = config fact (`AUTH_MODE`), no runtime branch | 1, 12 |
| §4.1 users / identities / otp_challenges model | 4, 8 |
| §4.1 own Postgres, separate schema; drop mandatory SUPABASE_* | 1, 8, 12 |
| §5 endpoints inside the OIDC interaction; reject unknown uid | 11 |
| §5 delivery via nodemailer/SMTP, Mailhog in dev | 5, 12 |
| §5.1 all 8 security-contract rows (each a test) | 3, 6, 11 |
| §6.1 Ortis unchanged; claims from own store | 7, 12 (no `apps/ortis` change) |
| §6.3 signer not called during login (this plan doesn't touch the signer) | (boundary noted, 13) |
| §3.1 / DoD §9.3 roebel-id byte-identical; golden tests green | 1, 9, 10 |
| DoD §9.1 email login → usr_ sub, no thirdweb | 6, 12 |
| DoD §9.2 same person → same sub | 6, 12 |
| DoD §9.4 5 wrong burns, 6th correct fails; identical known/unknown response; no live code in fixtures/logs | 6 |
| DoD §9.7 boots with SUPABASE unset; no Supabase read | 1, 7, 8, 12 |
| DoD §9.8 unknown uid → no mail, no challenge | 11 |

## Out of scope for THIS plan (deliberate)

- **Public client / PKCE-without-secret for Autar (spec §6.2, DoD §9.5).** Autar's community door is "explicitly second" (§6.2) and needs no OTP work — it is a config-only change (let an RP declare `token_endpoint_auth_method: "none"`). Track it as a sibling C1 slice; this plan is the email-OTP login track named in the brief. PKCE is already required for every client (`pkce: { required: () => true }`).
- **Social federation (Google/Apple/Facebook) — C2; SMS OTP — C3; QR app-connect — C4/I3.** `identities` makes each a new row kind, not a new model (spec §8).
- **Autar client-side `nostrIdentity()` custody path (§6.3), bring-your-own-npub `local` method (§6.4)** — live in the netizen_labs / Autar repos, not `apps/roebel-id`.
- **Kernel v3 smart account (Phase B); agent members (§7); migrating existing Röbel citizens; passkeys/WalletConnect.**

## Risks / unknowns

1. **Postgres reachability from Fly (biggest unknown).** Spec §4.1 proposes Ortis's existing Postgres under a `netizen_id` schema but explicitly hedges: confirm Fly→Postgres reachability first; if the instance isn't reachable, sovereign mode needs its own Postgres and the shared-schema plan is moot. The plan is deliberately DB-agnostic (`DATABASE_URL` + `DB_SCHEMA`) so either target works — but provisioning + reachability is an OPS gate Max must clear before the sovereign e2e can run against a real DB.
2. **`sub` stability requires persistence.** DoD §9.2 (same sub on the next login) holds across restarts only with the Postgres stores; the in-memory fallback is dev-only and must never run in production. The plan states this in code comments and the runbook.
3. **OTP_PEPPER rotation.** Rotating the pepper invalidates all in-flight codes (acceptable — 10-minute TTL) but the pepper must be treated as a long-lived secret; losing it does not expose past logins (codes are single-use and already consumed).
</content>
</invoke>
