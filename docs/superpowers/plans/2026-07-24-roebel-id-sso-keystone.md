# Röbel ID — Wallet-Identity SSO Keystone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship "Röbel ID", an owned OIDC Identity Provider whose login step verifies a SIWE message signed by the user's thirdweb smart account (ERC-1271 on Gnosis), so one wallet login provisions and authenticates a real Nextcloud account.

**Architecture:** A standalone TypeScript Node service (`apps/roebel-id`) built on panva `oidc-provider`. Login is an interactive page that connects the wallet via thirdweb (connector only), has the smart account sign a fresh SIWE message, and posts it back; the IdP verifies it via ERC-1271 and issues standard OIDC tokens. thirdweb is confined to one `AuthBridge` module so a non-thirdweb SIWE connector is a drop-in later. Nextcloud is the first client via its `user_oidc` app.

**Tech Stack:** TypeScript, Express, panva `oidc-provider`, `siwe` (EIP-4361), `viem` (ERC-1271/6492 verify on Gnosis), `@supabase/supabase-js` (claims + adapter store), `vitest` + `supertest` + `openid-client` (tests), Docker + Fly.io (hosting).

## Global Constraints

- **Package manager:** pnpm workspaces only — never npm/yarn. New app is a workspace at `apps/roebel-id`.
- **Runtime:** Node service (NOT Next.js/Vercel serverless). Hosted on Fly.io like `apps/coordinator`. Stateful: stable process + persisted signing keys.
- **Chain:** ERC-1271 verification pinned to **Gnosis, chainId `100`**, via a trusted RPC (`GNOSIS_RPC_URL`). Contract addresses come from config, sourced from `packages/blockchain/src/index.ts` (CitizenNFTv2 `0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5`, AttesterNFTv2 `0xC587F383696D3c9DF7A6eE03A9160E40Ae1cdb82`).
- **Subject:** OIDC `sub` = smart-account address, **lowercased**, matching `users.wallet_address` keying.
- **Citizen/attester = chain truth**, never the `users.is_verified_citizen` DB flag (advisory only).
- **Security (mandatory):** PKCE required; exact redirect-URI matching; auth-code TTL ≤ 60s; rotating JWKS; HTTPS-only in prod; signed/encrypted cookies (`COOKIE_KEYS`); all secrets in Fly secrets; SIWE nonce single-use with ≤ 5-min expiry and replay rejection; verifyMessage must accept ERC-6492 (undeployed smart accounts).
- **UI copy:** login page text in **German** (primary); primary color navy `#00498B`.
- **TDD:** every task writes the failing test first, sees it fail, implements minimally, sees it pass, commits.

---

### Task 1: Scaffold the `apps/roebel-id` service

**Files:**
- Create: `apps/roebel-id/package.json`
- Create: `apps/roebel-id/tsconfig.json`
- Create: `apps/roebel-id/vitest.config.ts`
- Create: `apps/roebel-id/src/config.ts`
- Create: `apps/roebel-id/src/app.ts`
- Create: `apps/roebel-id/src/index.ts`
- Test: `apps/roebel-id/test/health.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `createApp(): express.Express` (mounts routes, exported for tests); `loadConfig(): Config` reading env with typed fields used by every later task.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@roebel/roebel-id",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc -p tsconfig.json",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "express": "^4.21.2",
    "oidc-provider": "^8.5.3",
    "siwe": "^3.0.0",
    "viem": "^2.21.0",
    "@supabase/supabase-js": "^2.45.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.19.0",
    "vitest": "^2.1.0",
    "supertest": "^7.0.0",
    "openid-client": "^5.7.0",
    "@types/express": "^4.17.21",
    "@types/node": "^20.14.0",
    "@types/supertest": "^6.0.2"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } })
```

- [ ] **Step 4: Create `src/config.ts`**

```ts
export interface Config {
  issuer: string
  port: number
  cookieKeys: string[]
  gnosisRpcUrl: string
  chainId: number
  citizenNftAddress: `0x${string}`
  attesterNftAddress: `0x${string}`
  supabaseUrl: string
  supabaseServiceKey: string
  thirdwebClientId: string
  nextcloud: { clientId: string; clientSecret: string; redirectUris: string[]; postLogoutRedirectUris: string[] }
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env: ${name}`)
  return v
}

export function loadConfig(): Config {
  return {
    issuer: required('ISSUER_URL'),
    port: Number(process.env.PORT ?? 3010),
    cookieKeys: required('COOKIE_KEYS').split(','),
    gnosisRpcUrl: required('GNOSIS_RPC_URL'),
    chainId: Number(process.env.CHAIN_ID ?? 100),
    citizenNftAddress: required('CITIZEN_NFT_ADDRESS') as `0x${string}`,
    attesterNftAddress: required('ATTESTER_NFT_ADDRESS') as `0x${string}`,
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceKey: required('SUPABASE_SERVICE_KEY'),
    thirdwebClientId: required('THIRDWEB_CLIENT_ID'),
    nextcloud: {
      clientId: required('NEXTCLOUD_CLIENT_ID'),
      clientSecret: required('NEXTCLOUD_CLIENT_SECRET'),
      redirectUris: required('NEXTCLOUD_REDIRECT_URIS').split(','),
      postLogoutRedirectUris: (process.env.NEXTCLOUD_POST_LOGOUT_URIS ?? '').split(',').filter(Boolean),
    },
  }
}
```

- [ ] **Step 5: Create `src/app.ts` with a health route**

```ts
import express from 'express'

export function createApp(): express.Express {
  const app = express()
  app.get('/healthz', (_req, res) => { res.json({ status: 'ok' }) })
  return app
}
```

- [ ] **Step 6: Create `src/index.ts`**

```ts
import { loadConfig } from './config.js'
import { createApp } from './app.js'

const config = loadConfig()
const app = createApp()
app.listen(config.port, () => { console.log(`roebel-id listening on ${config.port}`) })
```

- [ ] **Step 7: Write the failing test `test/health.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/app.js'

describe('health', () => {
  it('returns ok', async () => {
    const res = await request(createApp()).get('/healthz')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })
})
```

- [ ] **Step 8: Install and run the test**

Run: `pnpm --filter @roebel/roebel-id install && pnpm --filter @roebel/roebel-id test`
Expected: PASS (1 test).

- [ ] **Step 9: Commit**

```bash
git add apps/roebel-id/package.json apps/roebel-id/tsconfig.json apps/roebel-id/vitest.config.ts apps/roebel-id/src/config.ts apps/roebel-id/src/app.ts apps/roebel-id/src/index.ts apps/roebel-id/test/health.test.ts pnpm-lock.yaml
git commit -m "feat(roebel-id): scaffold OIDC service with health endpoint"
```

---

### Task 2: SIWE verification + single-use nonce store

**Files:**
- Create: `apps/roebel-id/src/lib/gnosis.ts`
- Create: `apps/roebel-id/src/auth-bridge/nonce-store.ts`
- Create: `apps/roebel-id/src/auth-bridge/verify-siwe.ts`
- Test: `apps/roebel-id/test/verify-siwe.test.ts`

**Interfaces:**
- Consumes: `Config` from Task 1.
- Produces:
  - `NonceStore` — `interface NonceStore { issue(): string; consume(nonce: string): boolean }`; factory `createMemoryNonceStore(ttlMs?: number): NonceStore`.
  - `verifySiwe(input: { message: string; signature: string; nonceStore: NonceStore; expectedDomain: string; expectedChainId: number; verifier?: SignatureVerifier }): Promise<{ address: string }>` — throws `SiweError` on any failure; returns lowercased address on success.
  - `type SignatureVerifier = (a: { address: \`0x${string}\`; message: string; signature: \`0x${string}\` }) => Promise<boolean>`.

- [ ] **Step 1: Create the Gnosis signature verifier `src/lib/gnosis.ts`**

```ts
import { createPublicClient, http, type PublicClient } from 'viem'
import { gnosis } from 'viem/chains'
import type { Config } from '../config.js'

export type SignatureVerifier = (a: {
  address: `0x${string}`; message: string; signature: `0x${string}`
}) => Promise<boolean>

// viem's verifyMessage validates EOAs, deployed ERC-1271 accounts, and undeployed
// ERC-6492 accounts — exactly what we need for thirdweb smart accounts on Gnosis.
export function createGnosisVerifier(config: Config): SignatureVerifier {
  const client: PublicClient = createPublicClient({ chain: gnosis, transport: http(config.gnosisRpcUrl) })
  return ({ address, message, signature }) => client.verifyMessage({ address, message, signature })
}
```

- [ ] **Step 2: Create `src/auth-bridge/nonce-store.ts`**

```ts
import { generateNonce } from 'siwe'

export interface NonceStore { issue(): string; consume(nonce: string): boolean }

export function createMemoryNonceStore(ttlMs = 5 * 60 * 1000): NonceStore {
  const issued = new Map<string, number>()
  return {
    issue() {
      const nonce = generateNonce()
      issued.set(nonce, Date.now() + ttlMs)
      return nonce
    },
    consume(nonce: string) {
      const expiry = issued.get(nonce)
      if (expiry === undefined) return false      // unknown or already used → reject (replay guard)
      issued.delete(nonce)                         // single use
      return Date.now() <= expiry
    },
  }
}
```

- [ ] **Step 3: Write the failing test `test/verify-siwe.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { SiweMessage } from 'siwe'
import { createMemoryNonceStore, type NonceStore } from '../src/auth-bridge/nonce-store.js'
import { verifySiwe } from '../src/auth-bridge/verify-siwe.js'

const ADDR = '0x1111111111111111111111111111111111111111'
const DOMAIN = 'id.roebel.app'

function buildMessage(nonce: string, over: Partial<ConstructorParameters<typeof SiweMessage>[0]> = {}) {
  return new SiweMessage({
    domain: DOMAIN, address: ADDR, statement: 'Sign in to Röbel', uri: `https://${DOMAIN}`,
    version: '1', chainId: 100, nonce,
    expirationTime: new Date(Date.now() + 60_000).toISOString(), ...over,
  }).prepareMessage()
}

const okVerifier = async () => true
let store: NonceStore
beforeEach(() => { store = createMemoryNonceStore() })

describe('verifySiwe', () => {
  it('returns lowercased address for a valid message + signature', async () => {
    const nonce = store.issue()
    const message = buildMessage(nonce)
    const res = await verifySiwe({ message, signature: '0xsig', nonceStore: store, expectedDomain: DOMAIN, expectedChainId: 100, verifier: okVerifier })
    expect(res.address).toBe(ADDR.toLowerCase())
  })

  it('rejects a replayed nonce', async () => {
    const nonce = store.issue()
    const message = buildMessage(nonce)
    await verifySiwe({ message, signature: '0xsig', nonceStore: store, expectedDomain: DOMAIN, expectedChainId: 100, verifier: okVerifier })
    await expect(verifySiwe({ message, signature: '0xsig', nonceStore: store, expectedDomain: DOMAIN, expectedChainId: 100, verifier: okVerifier }))
      .rejects.toThrow(/nonce/i)
  })

  it('rejects the wrong chainId', async () => {
    const nonce = store.issue()
    const message = buildMessage(nonce, { chainId: 1 })
    await expect(verifySiwe({ message, signature: '0xsig', nonceStore: store, expectedDomain: DOMAIN, expectedChainId: 100, verifier: okVerifier }))
      .rejects.toThrow(/chain/i)
  })

  it('rejects a bad signature', async () => {
    const nonce = store.issue()
    const message = buildMessage(nonce)
    await expect(verifySiwe({ message, signature: '0xbad', nonceStore: store, expectedDomain: DOMAIN, expectedChainId: 100, verifier: async () => false }))
      .rejects.toThrow(/signature/i)
  })

  it('rejects an expired message', async () => {
    const nonce = store.issue()
    const message = buildMessage(nonce, { expirationTime: new Date(Date.now() - 1000).toISOString() })
    await expect(verifySiwe({ message, signature: '0xsig', nonceStore: store, expectedDomain: DOMAIN, expectedChainId: 100, verifier: okVerifier }))
      .rejects.toThrow(/expired/i)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @roebel/roebel-id test verify-siwe`
Expected: FAIL ("verifySiwe is not a function" / module not found).

- [ ] **Step 5: Create `src/auth-bridge/verify-siwe.ts`**

```ts
import { SiweMessage } from 'siwe'
import type { NonceStore } from './nonce-store.js'
import type { SignatureVerifier } from '../lib/gnosis.js'

export class SiweError extends Error {}

export async function verifySiwe(input: {
  message: string
  signature: string
  nonceStore: NonceStore
  expectedDomain: string
  expectedChainId: number
  verifier: SignatureVerifier
}): Promise<{ address: string }> {
  let parsed: SiweMessage
  try { parsed = new SiweMessage(input.message) } catch { throw new SiweError('malformed SIWE message') }

  if (parsed.domain !== input.expectedDomain) throw new SiweError('domain mismatch')
  if (parsed.chainId !== input.expectedChainId) throw new SiweError(`unexpected chain ${parsed.chainId}`)
  if (parsed.expirationTime && new Date(parsed.expirationTime).getTime() < Date.now()) throw new SiweError('message expired')
  if (!parsed.nonce || !input.nonceStore.consume(parsed.nonce)) throw new SiweError('invalid or reused nonce')

  const ok = await input.verifier({
    address: parsed.address as `0x${string}`,
    message: input.message,
    signature: input.signature as `0x${string}`,
  })
  if (!ok) throw new SiweError('signature verification failed')

  return { address: parsed.address.toLowerCase() }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @roebel/roebel-id test verify-siwe`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add apps/roebel-id/src/lib/gnosis.ts apps/roebel-id/src/auth-bridge/nonce-store.ts apps/roebel-id/src/auth-bridge/verify-siwe.ts apps/roebel-id/test/verify-siwe.test.ts
git commit -m "feat(roebel-id): SIWE verification with single-use nonce and ERC-1271 verifier"
```

---

### Task 3: The AuthBridge seam (thirdweb v1)

**Files:**
- Create: `apps/roebel-id/src/auth-bridge/types.ts`
- Create: `apps/roebel-id/src/auth-bridge/thirdweb-bridge.ts`
- Test: `apps/roebel-id/test/thirdweb-bridge.test.ts`

**Interfaces:**
- Consumes: `verifySiwe`, `NonceStore`, `SignatureVerifier`, `Config`.
- Produces:
  - `interface AuthBridge { issueNonce(): string; verifyLogin(req: { message: string; signature: string }): Promise<{ address: string }> }`
  - `createThirdwebAuthBridge(deps: { config: Config; nonceStore: NonceStore; verifier: SignatureVerifier }): AuthBridge`

- [ ] **Step 1: Create `src/auth-bridge/types.ts`**

```ts
export interface LoginRequest { message: string; signature: string }
export interface AuthBridge {
  issueNonce(): string
  verifyLogin(req: LoginRequest): Promise<{ address: string }>
}
```

- [ ] **Step 2: Write the failing test `test/thirdweb-bridge.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { SiweMessage } from 'siwe'
import { createMemoryNonceStore } from '../src/auth-bridge/nonce-store.js'
import { createThirdwebAuthBridge } from '../src/auth-bridge/thirdweb-bridge.js'

const config = { issuer: 'https://id.roebel.app', chainId: 100 } as any
const ADDR = '0x2222222222222222222222222222222222222222'

describe('ThirdwebAuthBridge', () => {
  it('issues a nonce and verifies a login signed with it', async () => {
    const bridge = createThirdwebAuthBridge({ config, nonceStore: createMemoryNonceStore(), verifier: async () => true })
    const nonce = bridge.issueNonce()
    const message = new SiweMessage({
      domain: 'id.roebel.app', address: ADDR, uri: config.issuer, version: '1', chainId: 100, nonce,
      expirationTime: new Date(Date.now() + 60_000).toISOString(),
    }).prepareMessage()
    const res = await bridge.verifyLogin({ message, signature: '0xsig' })
    expect(res.address).toBe(ADDR.toLowerCase())
  })

  it('rejects a login whose nonce it never issued', async () => {
    const bridge = createThirdwebAuthBridge({ config, nonceStore: createMemoryNonceStore(), verifier: async () => true })
    const message = new SiweMessage({
      domain: 'id.roebel.app', address: ADDR, uri: config.issuer, version: '1', chainId: 100, nonce: 'deadbeefdeadbeef',
      expirationTime: new Date(Date.now() + 60_000).toISOString(),
    }).prepareMessage()
    await expect(bridge.verifyLogin({ message, signature: '0xsig' })).rejects.toThrow(/nonce/i)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @roebel/roebel-id test thirdweb-bridge`
Expected: FAIL (module not found).

- [ ] **Step 4: Create `src/auth-bridge/thirdweb-bridge.ts`**

```ts
import { URL } from 'node:url'
import type { Config } from '../config.js'
import type { NonceStore } from './nonce-store.js'
import type { SignatureVerifier } from '../lib/gnosis.js'
import { verifySiwe } from './verify-siwe.js'
import type { AuthBridge } from './types.js'

// v1: thirdweb is only the browser-side wallet connector/signer. This bridge trusts NOTHING
// from thirdweb — it verifies a fresh SIWE message signed by the connected smart account via
// ERC-1271/6492 on Gnosis. v2 (SiweAuthBridge) reuses verifySiwe with a non-thirdweb connector.
export function createThirdwebAuthBridge(deps: {
  config: Config; nonceStore: NonceStore; verifier: SignatureVerifier
}): AuthBridge {
  const expectedDomain = new URL(deps.config.issuer).host
  return {
    issueNonce: () => deps.nonceStore.issue(),
    verifyLogin: (req) => verifySiwe({
      message: req.message,
      signature: req.signature,
      nonceStore: deps.nonceStore,
      expectedDomain,
      expectedChainId: deps.config.chainId,
      verifier: deps.verifier,
    }),
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @roebel/roebel-id test thirdweb-bridge`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/roebel-id/src/auth-bridge/types.ts apps/roebel-id/src/auth-bridge/thirdweb-bridge.ts apps/roebel-id/test/thirdweb-bridge.test.ts
git commit -m "feat(roebel-id): AuthBridge seam with thirdweb v1 implementation"
```

---

### Task 4: Claims resolver

**Files:**
- Create: `apps/roebel-id/src/claims/types.ts`
- Create: `apps/roebel-id/src/claims/resolver.ts`
- Test: `apps/roebel-id/test/resolver.test.ts`

**Interfaces:**
- Consumes: `Config`.
- Produces:
  - `interface RoebelClaims { sub: string; email?: string; email_verified?: boolean; name?: string; preferred_username?: string; picture?: string; groups: string[]; 'roebel:citizen': boolean; 'roebel:attester': boolean; 'roebel:tier'?: string }`
  - `type ProfileReader = (address: string) => Promise<{ email?: string; name?: string; picture?: string; tier?: string } | null>`
  - `type OrgReader = (address: string) => Promise<Array<{ accountId: string; role: string }>>`
  - `type ChainStatusReader = (address: string) => Promise<{ citizen: boolean; attester: boolean }>`
  - `createClaimsResolver(deps: { profile: ProfileReader; orgs: OrgReader; chain: ChainStatusReader }): (address: string) => Promise<RoebelClaims>`

- [ ] **Step 1: Create `src/claims/types.ts`**

```ts
export interface RoebelClaims {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  preferred_username?: string
  picture?: string
  groups: string[]
  'roebel:citizen': boolean
  'roebel:attester': boolean
  'roebel:tier'?: string
}
export type ProfileReader = (address: string) => Promise<{ email?: string; name?: string; picture?: string; tier?: string } | null>
export type OrgReader = (address: string) => Promise<Array<{ accountId: string; role: string }>>
export type ChainStatusReader = (address: string) => Promise<{ citizen: boolean; attester: boolean }>
```

- [ ] **Step 2: Write the failing test `test/resolver.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { createClaimsResolver } from '../src/claims/resolver.js'

const ADDR = '0x3333333333333333333333333333333333333333'

describe('claims resolver', () => {
  it('assembles sub, profile, chain status and org groups', async () => {
    const resolve = createClaimsResolver({
      profile: async () => ({ email: 'a@b.de', name: 'Anna', tier: 'citizen' }),
      orgs: async () => [{ accountId: 'org-1', role: 'admin' }],
      chain: async () => ({ citizen: true, attester: false }),
    })
    const claims = await resolve(ADDR)
    expect(claims.sub).toBe(ADDR.toLowerCase())
    expect(claims.email).toBe('a@b.de')
    expect(claims['roebel:citizen']).toBe(true)
    expect(claims['roebel:attester']).toBe(false)
    expect(claims.groups).toContain('citizen')
    expect(claims.groups).toContain('org:org-1:admin')
    expect(claims.groups).not.toContain('attester')
  })

  it('tolerates a missing profile row', async () => {
    const resolve = createClaimsResolver({
      profile: async () => null,
      orgs: async () => [],
      chain: async () => ({ citizen: false, attester: true }),
    })
    const claims = await resolve(ADDR)
    expect(claims.email).toBeUndefined()
    expect(claims.groups).toEqual(['attester'])
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @roebel/roebel-id test resolver`
Expected: FAIL (module not found).

- [ ] **Step 4: Create `src/claims/resolver.ts`**

```ts
import type { RoebelClaims, ProfileReader, OrgReader, ChainStatusReader } from './types.js'

export function createClaimsResolver(deps: {
  profile: ProfileReader; orgs: OrgReader; chain: ChainStatusReader
}): (address: string) => Promise<RoebelClaims> {
  return async (rawAddress: string): Promise<RoebelClaims> => {
    const sub = rawAddress.toLowerCase()
    const [profile, orgs, status] = await Promise.all([deps.profile(sub), deps.orgs(sub), deps.chain(sub)])

    const groups: string[] = []
    if (status.citizen) groups.push('citizen')
    if (status.attester) groups.push('attester')
    for (const o of orgs) groups.push(`org:${o.accountId}:${o.role}`)

    return {
      sub,
      email: profile?.email,
      email_verified: profile?.email ? true : undefined,
      name: profile?.name,
      preferred_username: profile?.name,
      picture: profile?.picture,
      groups,
      'roebel:citizen': status.citizen,
      'roebel:attester': status.attester,
      'roebel:tier': profile?.tier,
    }
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @roebel/roebel-id test resolver`
Expected: PASS (2 tests).

- [ ] **Step 6: Wire the real readers `src/claims/readers.ts`** (Supabase + chain; not unit-tested — thin adapters over Task-2 verifier client and supabase-js)

```ts
import { createClient } from '@supabase/supabase-js'
import { createPublicClient, http, getContract } from 'viem'
import { gnosis } from 'viem/chains'
import type { Config } from '../config.js'
import type { ProfileReader, OrgReader, ChainStatusReader } from './types.js'

const balanceOfAbi = [{
  type: 'function', name: 'balanceOf', stateMutability: 'view',
  inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }],
}] as const

export function createReaders(config: Config): { profile: ProfileReader; orgs: OrgReader; chain: ChainStatusReader } {
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey)
  const client = createPublicClient({ chain: gnosis, transport: http(config.gnosisRpcUrl) })
  const citizen = getContract({ address: config.citizenNftAddress, abi: balanceOfAbi, client })
  const attester = getContract({ address: config.attesterNftAddress, abi: balanceOfAbi, client })

  return {
    profile: async (address) => {
      const { data } = await supabase.from('users')
        .select('email, display_name, avatar_url, tier').eq('wallet_address', address).maybeSingle()
      if (!data) return null
      return { email: data.email ?? undefined, name: data.display_name ?? undefined, picture: data.avatar_url ?? undefined, tier: data.tier ?? undefined }
    },
    orgs: async (address) => {
      const { data } = await supabase.from('account_owners').select('account_id, role').eq('wallet_address', address)
      return (data ?? []).map((r) => ({ accountId: r.account_id, role: r.role }))
    },
    chain: async (address) => {
      const [c, a] = await Promise.all([
        citizen.read.balanceOf([address as `0x${string}`]),
        attester.read.balanceOf([address as `0x${string}`]),
      ])
      return { citizen: c > 0n, attester: a > 0n }
    },
  }
}
```

- [ ] **Step 7: Commit**

```bash
git add apps/roebel-id/src/claims/types.ts apps/roebel-id/src/claims/resolver.ts apps/roebel-id/src/claims/readers.ts apps/roebel-id/test/resolver.test.ts
git commit -m "feat(roebel-id): claims resolver with chain-truth citizen/attester and org groups"
```

---

### Task 5: Supabase-backed OIDC adapter + migration

**Files:**
- Create: `apps/roebel-id/migrations/001_oidc_payloads.sql`
- Create: `apps/roebel-id/src/store/supabase-adapter.ts`
- Test: `apps/roebel-id/test/supabase-adapter.test.ts`

**Interfaces:**
- Consumes: `Config`.
- Produces: `makeSupabaseAdapterFactory(deps: { client: SupabaseLike }): (name: string) => Adapter` where `Adapter` matches panva's contract (`upsert, find, findByUid, findByUserCode, consume, destroy, revokeByGrantId`). `SupabaseLike` is the minimal subset of supabase-js used, so tests can inject a fake.

- [ ] **Step 1: Create the migration `migrations/001_oidc_payloads.sql`**

```sql
create table if not exists oidc_payloads (
  id text not null,
  type text not null,
  payload jsonb not null,
  grant_id text,
  user_code text,
  uid text,
  expires_at timestamptz,
  primary key (type, id)
);
create index if not exists oidc_payloads_uid on oidc_payloads (uid);
create index if not exists oidc_payloads_user_code on oidc_payloads (user_code);
create index if not exists oidc_payloads_grant_id on oidc_payloads (grant_id);
```

- [ ] **Step 2: Write the failing test `test/supabase-adapter.test.ts`** (fake store — verifies the adapter's round-trip semantics)

```ts
import { describe, it, expect } from 'vitest'
import { makeSupabaseAdapterFactory } from '../src/store/supabase-adapter.js'

// Minimal in-memory fake of the supabase query surface the adapter uses.
function fakeClient() {
  const rows: any[] = []
  return {
    _rows: rows,
    from() {
      const state: any = { filters: {} }
      const api: any = {
        upsert(r: any) { const i = rows.findIndex((x) => x.type === r.type && x.id === r.id); if (i >= 0) rows[i] = r; else rows.push(r); return Promise.resolve({ error: null }) },
        select() { return api },
        eq(k: string, v: any) { state.filters[k] = v; return api },
        maybeSingle() { return Promise.resolve({ data: rows.find((x) => Object.entries(state.filters).every(([k, v]) => x[k] === v)) ?? null, error: null }) },
        delete() { state.del = true; return api },
        then(res: any) { // delete(): apply filters
          const matched = rows.filter((x) => Object.entries(state.filters).every(([k, v]) => x[k] === v))
          for (const m of matched) rows.splice(rows.indexOf(m), 1)
          return Promise.resolve({ error: null }).then(res)
        },
      }
      return api
    },
  }
}

describe('supabase oidc adapter', () => {
  it('upserts and finds by id', async () => {
    const factory = makeSupabaseAdapterFactory({ client: fakeClient() as any })
    const adapter = factory('AccessToken')
    await adapter.upsert('abc', { accountId: '0xabc', scope: 'openid' }, 3600)
    expect(await adapter.find('abc')).toMatchObject({ accountId: '0xabc' })
  })

  it('destroys a record', async () => {
    const factory = makeSupabaseAdapterFactory({ client: fakeClient() as any })
    const adapter = factory('Session')
    await adapter.upsert('s1', { foo: 1 }, 3600)
    await adapter.destroy('s1')
    expect(await adapter.find('s1')).toBeUndefined()
  })

  it('marks a record consumed', async () => {
    const factory = makeSupabaseAdapterFactory({ client: fakeClient() as any })
    const adapter = factory('AuthorizationCode')
    await adapter.upsert('c1', { accountId: '0xabc' }, 60)
    await adapter.consume('c1')
    expect((await adapter.find('c1'))?.consumed).toBeTypeOf('number')
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @roebel/roebel-id test supabase-adapter`
Expected: FAIL (module not found).

- [ ] **Step 4: Create `src/store/supabase-adapter.ts`**

```ts
import type { Adapter, AdapterPayload } from 'oidc-provider'

export interface SupabaseLike { from(table: string): any }

const TABLE = 'oidc_payloads'

export function makeSupabaseAdapterFactory(deps: { client: SupabaseLike }): (name: string) => Adapter {
  const { client } = deps
  return (name: string): Adapter => ({
    async upsert(id, payload, expiresIn) {
      const row = {
        id, type: name, payload,
        grant_id: (payload as AdapterPayload).grantId ?? null,
        user_code: (payload as AdapterPayload).userCode ?? null,
        uid: (payload as AdapterPayload).uid ?? null,
        expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
      }
      const { error } = await client.from(TABLE).upsert(row)
      if (error) throw error
    },
    async find(id) {
      const { data } = await client.from(TABLE).select('payload').eq('type', name).eq('id', id).maybeSingle()
      return data ? (data.payload as AdapterPayload) : undefined
    },
    async findByUid(uid) {
      const { data } = await client.from(TABLE).select('payload').eq('uid', uid).maybeSingle()
      return data ? (data.payload as AdapterPayload) : undefined
    },
    async findByUserCode(userCode) {
      const { data } = await client.from(TABLE).select('payload').eq('user_code', userCode).maybeSingle()
      return data ? (data.payload as AdapterPayload) : undefined
    },
    async consume(id) {
      const { data } = await client.from(TABLE).select('payload').eq('type', name).eq('id', id).maybeSingle()
      if (!data) return
      const payload = { ...data.payload, consumed: Math.floor(Date.now() / 1000) }
      await client.from(TABLE).upsert({ id, type: name, payload, grant_id: payload.grantId ?? null, user_code: payload.userCode ?? null, uid: payload.uid ?? null, expires_at: null })
    },
    async destroy(id) { await client.from(TABLE).delete().eq('type', name).eq('id', id) },
    async revokeByGrantId(grantId) { await client.from(TABLE).delete().eq('grant_id', grantId) },
  })
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @roebel/roebel-id test supabase-adapter`
Expected: PASS (3 tests).

- [ ] **Step 6: Apply the migration** to the Supabase project via the Supabase MCP (`apply_migration`, name `roebel_id_oidc_payloads`, body = the SQL from Step 1). Confirm with `list_tables` that `oidc_payloads` exists.

- [ ] **Step 7: Commit**

```bash
git add apps/roebel-id/migrations/001_oidc_payloads.sql apps/roebel-id/src/store/supabase-adapter.ts apps/roebel-id/test/supabase-adapter.test.ts
git commit -m "feat(roebel-id): Supabase-backed OIDC adapter and oidc_payloads migration"
```

---

### Task 6: OIDC provider assembly (config, clients, Account, JWKS)

**Files:**
- Create: `apps/roebel-id/src/oidc/jwks.ts`
- Create: `apps/roebel-id/src/oidc/provider.ts`
- Modify: `apps/roebel-id/src/app.ts` (mount the provider)
- Test: `apps/roebel-id/test/discovery.test.ts`

**Interfaces:**
- Consumes: `Config`, `makeSupabaseAdapterFactory`, `createClaimsResolver` output.
- Produces: `buildProvider(deps: { config: Config; adapterFactory: (n: string) => Adapter; resolveClaims: (a: string) => Promise<RoebelClaims> }): Provider`.

- [ ] **Step 1: Create `src/oidc/jwks.ts`** (load JWKS from env; documented rotation)

```ts
// JWKS is provided via env as a JSON JWK Set (generate with the panva jose CLI or a one-off script).
// Rotation = prepend a new key to `keys` and redeploy; old key stays until tokens signed with it expire.
export function loadJwks(): { keys: object[] } {
  const raw = process.env.JWKS_JSON
  if (!raw) throw new Error('Missing JWKS_JSON')
  return JSON.parse(raw)
}
```

- [ ] **Step 2: Write the failing test `test/discovery.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { buildProvider } from '../src/oidc/provider.js'
import { makeSupabaseAdapterFactory } from '../src/store/supabase-adapter.js'

const config: any = {
  issuer: 'http://localhost:3010', cookieKeys: ['k1'], chainId: 100,
  nextcloud: { clientId: 'nextcloud', clientSecret: 'secret', redirectUris: ['http://localhost:8080/apps/user_oidc/code'], postLogoutRedirectUris: [] },
}
process.env.JWKS_JSON = JSON.stringify({ keys: [] }) // provider generates dev keys when empty in test

function memClient() { const rows: any[] = []; return { from() { const s: any = {}; const api: any = { upsert(r: any){rows.push(r);return Promise.resolve({error:null})}, select(){return api}, eq(k: string,v: any){s[k]=v;return api}, maybeSingle(){return Promise.resolve({data:null,error:null})}, delete(){return api}, then(res: any){return Promise.resolve({error:null}).then(res)} }; return api } } }

describe('discovery', () => {
  it('serves openid-configuration with the issuer', async () => {
    const provider = buildProvider({
      config,
      adapterFactory: makeSupabaseAdapterFactory({ client: memClient() as any }),
      resolveClaims: async (a) => ({ sub: a, groups: [], 'roebel:citizen': false, 'roebel:attester': false }),
    })
    const app = (await import('express')).default()
    app.use('/oidc', provider.callback())
    const res = await request(app).get('/oidc/.well-known/openid-configuration')
    expect(res.status).toBe(200)
    expect(res.body.issuer).toBe('http://localhost:3010')
    expect(res.body.authorization_endpoint).toContain('/auth')
  })
})
```

Note: the provider is mounted at `/oidc`, so the effective issuer path prefix must match; in production the issuer is the public origin and the provider is mounted at root. For the test we assert the discovery document shape.

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @roebel/roebel-id test discovery`
Expected: FAIL (module not found).

- [ ] **Step 4: Create `src/oidc/provider.ts`**

```ts
import Provider, { type Adapter, type Configuration } from 'oidc-provider'
import type { Config } from '../config.js'
import type { RoebelClaims } from '../claims/types.js'
import { loadJwks } from './jwks.js'

export function buildProvider(deps: {
  config: Config
  adapterFactory: (name: string) => Adapter
  resolveClaims: (address: string) => Promise<RoebelClaims>
}): Provider {
  const { config, adapterFactory, resolveClaims } = deps
  const jwks = loadJwks()

  const configuration: Configuration = {
    adapter: adapterFactory,
    clients: [{
      client_id: config.nextcloud.clientId,
      client_secret: config.nextcloud.clientSecret,
      redirect_uris: config.nextcloud.redirectUris,
      post_logout_redirect_uris: config.nextcloud.postLogoutRedirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
    }],
    ...(jwks.keys.length ? { jwks } : {}),
    cookies: { keys: config.cookieKeys },
    pkce: { required: () => true },
    features: { devInteractions: { enabled: false } },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    ttl: { AuthorizationCode: 60, IdToken: 3600, AccessToken: 3600, Session: 1209600 },
    claims: {
      openid: ['sub'],
      email: ['email', 'email_verified'],
      profile: ['name', 'preferred_username', 'picture'],
      roebel: ['groups', 'roebel:citizen', 'roebel:attester', 'roebel:tier'],
    },
    scopes: ['openid', 'email', 'profile', 'roebel'],
    async findAccount(_ctx, id) {
      const claims = await resolveClaims(id)
      return { accountId: id, claims: async () => ({ ...claims, sub: id }) }
    },
  }

  const provider = new Provider(config.issuer, configuration)
  provider.proxy = true // behind Fly's TLS terminator
  return provider
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @roebel/roebel-id test discovery`
Expected: PASS. (If panva requires non-empty `jwks` even in dev, generate a throwaway key in the test's `JWKS_JSON` using `jose`'s `generateKeyPair` + `exportJWK`; document that in the test.)

- [ ] **Step 6: Commit**

```bash
git add apps/roebel-id/src/oidc/jwks.ts apps/roebel-id/src/oidc/provider.ts apps/roebel-id/test/discovery.test.ts
git commit -m "feat(roebel-id): assemble panva OIDC provider with Nextcloud client and roebel claims"
```

---

### Task 7: Interaction login page + end-to-end auth-code flow

**Files:**
- Create: `apps/roebel-id/src/interaction/router.ts`
- Create: `apps/roebel-id/src/interaction/login-page.ts`
- Create: `apps/roebel-id/src/wire.ts` (composition root: build config → verifier → bridge → readers → resolver → adapter → provider → app)
- Modify: `apps/roebel-id/src/app.ts` (accept a provider + interaction router), `apps/roebel-id/src/index.ts` (use `wire`)
- Test: `apps/roebel-id/test/e2e-flow.test.ts`

**Interfaces:**
- Consumes: `AuthBridge`, `Provider`, `Config`.
- Produces: `createInteractionRouter(deps: { provider: Provider; bridge: AuthBridge; issuerHost: string }): express.Router` exposing `GET /interaction/:uid`, `GET /interaction/:uid/nonce`, `POST /interaction/:uid/login`. `wireApp(config): { app, provider }`.

- [ ] **Step 1: Create `src/interaction/login-page.ts`** (minimal German page; loads thirdweb, connects wallet, signs SIWE, posts back)

```ts
export function renderLoginPage(uid: string, thirdwebClientId: string, chainId: number): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Bei Röbel anmelden</title>
<style>body{font-family:system-ui;background:#fff;color:#00498B;display:grid;place-items:center;height:100vh;margin:0}
button{background:#00498B;color:#fff;border:0;border-radius:12px;padding:14px 22px;font-size:16px;cursor:pointer}</style>
</head><body>
<main style="text-align:center;max-width:360px">
  <h1>Röbel ID</h1>
  <p>Melde dich mit deiner Röbel-Identität an, um fortzufahren.</p>
  <button id="login">Mit Röbel anmelden</button>
  <p id="status" style="color:#6B7280;font-size:14px"></p>
</main>
<script type="module">
  import { createThirdwebClient } from 'https://esm.sh/thirdweb@5'
  import { inAppWallet } from 'https://esm.sh/thirdweb@5/wallets'
  import { SiweMessage } from 'https://esm.sh/siwe@3'
  const client = createThirdwebClient({ clientId: '${thirdwebClientId}' })
  const status = document.getElementById('status')
  document.getElementById('login').onclick = async () => {
    try {
      status.textContent = 'Verbinde…'
      const wallet = inAppWallet({ smartAccount: { chain: { id: ${chainId} }, sponsorGas: true } })
      const account = await wallet.connect({ client, strategy: 'iframe' })
      const nonce = await (await fetch('/interaction/${uid}/nonce')).then(r => r.text())
      const message = new SiweMessage({ domain: location.host, address: account.address, uri: location.origin,
        version: '1', chainId: ${chainId}, nonce, statement: 'Anmeldung bei Röbel ID',
        expirationTime: new Date(Date.now()+120000).toISOString() }).prepareMessage()
      const signature = await account.signMessage({ message })
      const res = await fetch('/interaction/${uid}/login', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, signature }) })
      if (res.redirected) location.href = res.url
      else { const j = await res.json(); location.href = j.redirectTo }
    } catch (e) { status.textContent = 'Anmeldung fehlgeschlagen: ' + e.message }
  }
</script>
</body></html>`
}
```

- [ ] **Step 2: Create `src/interaction/router.ts`**

```ts
import express from 'express'
import type Provider from 'oidc-provider'
import type { AuthBridge } from '../auth-bridge/types.js'
import { renderLoginPage } from './login-page.js'

export function createInteractionRouter(deps: {
  provider: Provider; bridge: AuthBridge; thirdwebClientId: string; chainId: number
}): express.Router {
  const router = express.Router()
  const { provider, bridge } = deps

  router.get('/interaction/:uid', async (req, res, next) => {
    try {
      const details = await provider.interactionDetails(req, res)
      if (details.prompt.name !== 'login' && details.prompt.name !== 'consent') return next()
      res.set('cache-control', 'no-store').send(renderLoginPage(details.uid, deps.thirdwebClientId, deps.chainId))
    } catch (e) { next(e) }
  })

  router.get('/interaction/:uid/nonce', (_req, res) => { res.type('text/plain').send(bridge.issueNonce()) })

  router.post('/interaction/:uid/login', express.json(), async (req, res, next) => {
    try {
      const { address } = await bridge.verifyLogin({ message: req.body.message, signature: req.body.signature })
      // finish login
      const loginResult = { login: { accountId: address } }
      const redirectTo = await provider.interactionResult(req, res, loginResult, { mergeWithLastSubmission: false })
      res.json({ redirectTo })
    } catch (e: any) { res.status(401).json({ error: e.message }) }
  })

  return router
}
```

Note: `user_oidc` uses first-party consent; if a separate `consent` prompt appears, grant it in the same login post by creating/So-storing a `Grant` (add a short consent grant in `interactionResult`). Keep this in the implementation if the E2E surfaces a consent prompt.

- [ ] **Step 3: Create `src/wire.ts` (composition root)**

```ts
import express from 'express'
import { createClient } from '@supabase/supabase-js'
import { loadConfig, type Config } from './config.js'
import { createGnosisVerifier } from './lib/gnosis.js'
import { createMemoryNonceStore } from './auth-bridge/nonce-store.js'
import { createThirdwebAuthBridge } from './auth-bridge/thirdweb-bridge.js'
import { createReaders } from './claims/readers.js'
import { createClaimsResolver } from './claims/resolver.js'
import { makeSupabaseAdapterFactory } from './store/supabase-adapter.js'
import { buildProvider } from './oidc/provider.js'
import { createInteractionRouter } from './interaction/router.js'

export function wireApp(config: Config = loadConfig()) {
  const verifier = createGnosisVerifier(config)
  const bridge = createThirdwebAuthBridge({ config, nonceStore: createMemoryNonceStore(), verifier })
  const readers = createReaders(config)
  const resolveClaims = createClaimsResolver(readers)
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey)
  const adapterFactory = makeSupabaseAdapterFactory({ client: supabase })
  const provider = buildProvider({ config, adapterFactory, resolveClaims })

  const app = express()
  app.use(createInteractionRouter({ provider, bridge, thirdwebClientId: config.thirdwebClientId, chainId: config.chainId }))
  app.get('/healthz', (_req, res) => { res.json({ status: 'ok' }) })
  app.use(provider.callback())
  return { app, provider, bridge }
}
```

- [ ] **Step 4: Update `src/index.ts` to use `wireApp`**

```ts
import { loadConfig } from './config.js'
import { wireApp } from './wire.js'
const config = loadConfig()
const { app } = wireApp(config)
app.listen(config.port, () => console.log(`roebel-id on ${config.port}`))
```

- [ ] **Step 5: Write the failing E2E test `test/e2e-flow.test.ts`** (drive the full code flow with `openid-client`, stubbing the verifier so no real chain call)

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { Issuer, generators } from 'openid-client'
import { buildProvider } from '../src/oidc/provider.js'
import { createInteractionRouter } from '../src/interaction/router.js'
import { createThirdwebAuthBridge } from '../src/auth-bridge/thirdweb-bridge.js'
import { createMemoryNonceStore } from '../src/auth-bridge/nonce-store.js'
import { makeSupabaseAdapterFactory } from '../src/store/supabase-adapter.js'
import express from 'express'

// Full test harness: an in-process provider + interaction router with a stub verifier that
// approves a fixed address, driven end-to-end by openid-client acting as Nextcloud.
// This is the IdP-conformance proof required by the spec (§8.1). Fill in with a listening
// server on an ephemeral port, an in-memory adapter (from discovery.test), JWKS generated via
// `jose`, a redirect_uri pointing back to a tiny callback handler, then assert the id_token has
// sub === the fixed lowercased address and groups reflect the stub resolver.
it.todo('completes authorization_code flow and returns roebel claims in the id_token')
```

Replace the `it.todo` with the real harness during implementation: stand up the express app on an ephemeral port (issuer = `http://localhost:<port>`), generate JWKS with `jose`, register a client whose `redirect_uris` include the test callback, use `client.authorizationUrl({ code_challenge, scope: 'openid email profile roebel' })`, follow the redirect to `/interaction/:uid`, POST `/interaction/:uid/login` with any `{message, signature}` (verifier stub returns true and the resolver stub returns fixed claims — bypass SIWE by injecting a bridge whose `verifyLogin` resolves `{ address }` directly), capture the code at the callback, and `client.callback(...)` to exchange it. Assert `tokenSet.claims().sub === '0x4444...'` and `groups` present.

- [ ] **Step 6: Run the E2E test to verify it fails, then passes after implementing the harness**

Run: `pnpm --filter @roebel/roebel-id test e2e-flow`
Expected: FAIL (todo) → implement harness → PASS (id_token carries `sub` + `groups`).

- [ ] **Step 7: Commit**

```bash
git add apps/roebel-id/src/interaction/ apps/roebel-id/src/wire.ts apps/roebel-id/src/index.ts apps/roebel-id/test/e2e-flow.test.ts
git commit -m "feat(roebel-id): interaction login page and end-to-end authorization_code flow"
```

---

### Task 8: Deployment — Dockerfile, Fly config, secrets, JWKS

**Files:**
- Create: `apps/roebel-id/Dockerfile`
- Create: `apps/roebel-id/fly.toml`
- Create: `apps/roebel-id/.env.example`
- Create: `apps/roebel-id/scripts/generate-jwks.ts`
- Create: `apps/roebel-id/README.md`

**Interfaces:** none (ops deliverable). Produces a deployable container and a documented secret set.

- [ ] **Step 1: Create `scripts/generate-jwks.ts`** (one-off; prints a JWK Set to paste into the `JWKS_JSON` secret)

```ts
import { generateKeyPair, exportJWK } from 'jose'
const { privateKey } = await generateKeyPair('RS256', { extractable: true })
const jwk = await exportJWK(privateKey)
jwk.kid = crypto.randomUUID(); jwk.use = 'sig'; jwk.alg = 'RS256'
console.log(JSON.stringify({ keys: [jwk] }))
```

- [ ] **Step 2: Create `.env.example`**

```bash
ISSUER_URL=https://id.roebel.app
PORT=3010
COOKIE_KEYS=change-me-1,change-me-2
GNOSIS_RPC_URL=https://rpc.gnosischain.com
CHAIN_ID=100
CITIZEN_NFT_ADDRESS=0x59aA26f499D7C2B3EC2c8524Ed06F54fc4E85dE5
ATTESTER_NFT_ADDRESS=0xC587F383696D3c9DF7A6eE03A9160E40Ae1cdb82
SUPABASE_URL=https://wwbeqhkslxdxhktqzqti.supabase.co
SUPABASE_SERVICE_KEY=__set_in_fly_secrets__
THIRDWEB_CLIENT_ID=__same_project_as_web_and_expo__
NEXTCLOUD_CLIENT_ID=nextcloud
NEXTCLOUD_CLIENT_SECRET=__set_in_fly_secrets__
NEXTCLOUD_REDIRECT_URIS=https://cloud.roebel.app/apps/user_oidc/code
JWKS_JSON=__paste_output_of_generate-jwks__
```

- [ ] **Step 3: Create `Dockerfile`**

```dockerfile
FROM node:20-slim AS base
RUN corepack enable
WORKDIR /app
COPY apps/roebel-id/package.json apps/roebel-id/
RUN cd apps/roebel-id && pnpm install --prod=false
COPY apps/roebel-id/ apps/roebel-id/
RUN cd apps/roebel-id && pnpm build
EXPOSE 3010
CMD ["node", "apps/roebel-id/dist/index.js"]
```

- [ ] **Step 4: Create `fly.toml`**

```toml
app = "roebel-id"
primary_region = "fra"

[build]
  dockerfile = "Dockerfile"

[http_service]
  internal_port = 3010
  force_https = true
  auto_stop_machines = false
  min_machines_running = 1

[[http_service.checks]]
  path = "/healthz"
  interval = "15s"
  timeout = "2s"
```

- [ ] **Step 5: Create `README.md`** documenting: `pnpm --filter @roebel/roebel-id dev`; generate JWKS via `pnpm --filter @roebel/roebel-id exec tsx scripts/generate-jwks.ts`; set Fly secrets: `fly secrets set COOKIE_KEYS=... SUPABASE_SERVICE_KEY=... NEXTCLOUD_CLIENT_SECRET=... JWKS_JSON='...' -a roebel-id`; deploy `fly deploy -c apps/roebel-id/fly.toml`. Note: `min_machines_running = 1` because sessions/keys are stateful.

- [ ] **Step 6: Verify the build**

Run: `pnpm --filter @roebel/roebel-id build`
Expected: compiles to `dist/` with no type errors.

- [ ] **Step 7: Commit**

```bash
git add apps/roebel-id/Dockerfile apps/roebel-id/fly.toml apps/roebel-id/.env.example apps/roebel-id/scripts/generate-jwks.ts apps/roebel-id/README.md
git commit -m "chore(roebel-id): Dockerfile, Fly config, env example, JWKS generator"
```

---

### Task 9: Nextcloud integration + keystone-proven E2E

**Files:**
- Create: `apps/roebel-id/docker-compose.nextcloud.yml`
- Create: `apps/roebel-id/docs/nextcloud-setup.md`
- Test (manual/scripted): `apps/roebel-id/test/nextcloud-e2e.md` (checklist the implementer runs)

**Interfaces:** none new — proves the whole system against a real Nextcloud.

- [ ] **Step 1: Create `docker-compose.nextcloud.yml`** (local Nextcloud + Collabora for the proof)

```yaml
services:
  nextcloud:
    image: nextcloud:30-apache
    ports: ["8080:80"]
    environment:
      NEXTCLOUD_ADMIN_USER: admin
      NEXTCLOUD_ADMIN_PASSWORD: admin
      NEXTCLOUD_TRUSTED_DOMAINS: localhost:8080
    volumes: ["nc_data:/var/www/html"]
  collabora:
    image: collabora/code:latest
    ports: ["9980:9980"]
    environment: { extra_params: "--o:ssl.enable=false --o:ssl.termination=true" }
volumes: { nc_data: {} }
```

- [ ] **Step 2: Create `docs/nextcloud-setup.md`** with the exact `occ` commands to install/configure `user_oidc` against Röbel ID:

```bash
# Inside the nextcloud container:
docker compose -f docker-compose.nextcloud.yml exec -u www-data nextcloud php occ app:install user_oidc
docker compose -f docker-compose.nextcloud.yml exec -u www-data nextcloud php occ user_oidc:provider Roebel \
  --clientid="nextcloud" --clientsecret="<NEXTCLOUD_CLIENT_SECRET>" \
  --discoveryuri="https://id.roebel.app/.well-known/openid-configuration" \
  --scope="openid email profile roebel" \
  --unique-uid=1 --mapping-uid=sub --mapping-email=email --mapping-display-name=name --mapping-groups=groups
# Enable group provisioning from the token:
docker compose -f docker-compose.nextcloud.yml exec -u www-data nextcloud php occ config:app:set user_oidc provisioning_groups --value=1
```

(For the local proof, point `--discoveryuri` at a tunnel to the dev server, e.g. an ngrok URL, and add that URL to `ISSUER_URL` + `NEXTCLOUD_REDIRECT_URIS`.)

- [ ] **Step 3: Create the E2E checklist `test/nextcloud-e2e.md`** — the spec's success criteria, made executable:

```
1. Run the IdP dev server with a public tunnel; set ISSUER_URL + NEXTCLOUD_REDIRECT_URIS to the tunnel.
2. Start docker-compose.nextcloud.yml; run the occ setup commands (docs/nextcloud-setup.md).
3. Open http://localhost:8080 → "Login with Roebel" → redirected to Röbel ID login page.
4. Click "Mit Röbel anmelden" → thirdweb connect (email) → smart account connects → SIWE signed.
5. Redirected back to Nextcloud → a new user auto-provisioned, keyed on sub (lowercased address).
6. Confirm: user email/display-name populated; Nextcloud groups include 'citizen' and/or 'org:<id>:<role>' matching chain + account_owners.
7. Open Files → create/open a document in Nextcloud Office (Collabora) → edits save.
PASS = steps 3–7 all succeed. This is the keystone proven (spec §1 success criteria).
```

- [ ] **Step 4: Run the E2E checklist** end-to-end against the live dev IdP + local Nextcloud. Record the result (screens/notes) in `test/nextcloud-e2e.md`. Fix any integration gaps (most likely: consent-prompt grant in `interaction/router.ts`, or claim/scope name mismatch in the `occ` mapping).

- [ ] **Step 5: Commit**

```bash
git add apps/roebel-id/docker-compose.nextcloud.yml apps/roebel-id/docs/nextcloud-setup.md apps/roebel-id/test/nextcloud-e2e.md
git commit -m "test(roebel-id): Nextcloud user_oidc integration and keystone-proven E2E"
```

---

## Self-Review

**Spec coverage** (each spec section → task):
- §2 architecture / components → Tasks 1, 6, 7 (service, provider, composition root).
- §3 login flow → Task 7 (interaction router + login page) + Task 2/3 (SIWE verify).
- §4 modules & interfaces → `oidc/` (6), `interaction/` (7), `auth-bridge/` (2,3), `claims-resolver/` (4), `store/` (5), Account (6). All present.
- §5 claims & group mapping → Task 4 (resolver) + Task 6 (`claims`/`scopes` config) + Task 9 (`occ` group mapping).
- §6 sovereignty seam → Task 3 (`AuthBridge` interface isolates thirdweb) — v2 swap is a new impl of the same interface.
- §7 constraints/security → Global Constraints + Task 6 (PKCE required, exact redirect URIs, code TTL 60s) + Task 2 (nonce replay, expiry) + Task 8 (secrets, rotating JWKS, `force_https`).
- §8 testing → Task 2/3/4/5 unit, Task 7 conformance E2E, Task 9 Nextcloud E2E.
- Out-of-scope items (v2 SIWE, Keycloak federation, recovery, EAS, SCIM) → not tasked (correct; §9 of spec defers them).

**Placeholder scan:** the only intentional `it.todo` is Task 7 Step 5, with a full written description of the harness to build — flagged as "replace during implementation," not a silent gap. No "add error handling"/"TBD" left.

**Type consistency:** `AuthBridge` (`issueNonce`, `verifyLogin`) consistent across Tasks 3/7/wire. `RoebelClaims` consistent across Tasks 4/6. `SignatureVerifier` consistent across Tasks 2/4-readers/wire. Adapter factory signature `(name)=>Adapter` consistent across Tasks 5/6/wire. `sub` lowercased everywhere.

Known implementation risk to watch (not a plan gap): panva `oidc-provider` may emit a separate `consent` prompt for `user_oidc`; Task 7 Step 2 notes handling it via a `Grant` in `interactionResult`. Resolve during Task 9 E2E if it appears.

---

## Execution Handoff

Two execution options:

1. **Subagent-Driven (recommended)** — a fresh subagent per task, two-stage review between tasks, fast iteration.
2. **Inline Execution** — execute tasks in this session with checkpoints for review.

---

## Amendment (2026-07-25): agent-ready identity shaping

Source: spec §10 (added from the buzz.xyz deep research + the "AI Agent automation" priority). Goal: make the keystone provably the on-ramp for the future Agent-Runtime layer, at near-zero build cost — **human-only implementation in v1**, but the claims model reserves the agent seam so no migration is needed later. Concrete deltas to the tasks above:

- **Task 4 (claims resolver):**
  - `src/claims/types.ts` — add `'roebel:actor_type'?: 'human' | 'agent'` to `RoebelClaims`.
  - `src/claims/resolver.ts` — set `'roebel:actor_type': 'human'` in the returned claims (v1 issues human principals only; the field exists so agent principals slot in additively).
  - `test/resolver.test.ts` — add one assertion: `expect(claims['roebel:actor_type']).toBe('human')`.
- **Task 6 (provider assembly):**
  - `src/oidc/provider.ts` — add `'roebel:actor_type'` to the `roebel` array in the `claims` config so the claim flows to relying parties.
- **No other task changes.** No service-account/client-credentials grant, no `act` (delegation) claim, no ACP/MCP wiring in this build — those are the Agent-Runtime layer's own future spec (spec §10 "reserved seams").

### Environment note for this build (non-interactive session)

Tasks that need external auth/live infra are **handed to the user**, not run by the build agent: Task 5 Step 6 (apply migration via **Supabase MCP** — needs OAuth), Task 8 Step-anything requiring `fly` deploy, and Task 9 (live **Nextcloud** E2E). The build delivers Tasks 1–7 as code + passing local unit/integration tests (fakes/stubs for Supabase, chain, and the SIWE verifier), plus the Task 8 files (Dockerfile/fly.toml/.env.example/JWKS script/README) and Task 9 files (compose + docs + checklist) — with the *live* runs left as a documented ops checklist.
