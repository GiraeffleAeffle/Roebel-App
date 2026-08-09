import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { createServer as createNetServer } from 'node:net'
import type { Server } from 'node:http'
import { Issuer, generators } from 'openid-client'
import { generateKeyPair, exportJWK } from 'jose'
import type { Adapter, AdapterPayload } from 'oidc-provider'
import { wireApp } from '../src/wire.js'
import type { Config } from '../src/config.js'
import type { AuthBridge } from '../src/auth-bridge/types.js'
import type { RoebelClaims } from '../src/claims/types.js'

// Full IdP-conformance proof (spec §8.1): stand up the real interaction router + panva provider
// wired through wireApp's DI seam (no Supabase/thirdweb/Gnosis involved — those are stubbed),
// then drive the full authorization_code + PKCE flow with openid-client exactly as Nextcloud
// would: /auth -> /interaction/:uid -> POST login -> resume -> code at the redirect_uri -> /token.

const ADDRESS = '0x4444444444444444444444444444444444444444'
const REDIRECT_URI = 'http://localhost:8080/apps/user_oidc/code'
const ORTIS_REDIRECT_URI = 'http://localhost:8080/ortis/callback'

// Catches the brand name in EITHER spelling — the umlaut original ("Röbel") and its ASCII
// transliteration ("Roebel") — case-insensitively. Same pattern as
// test/interaction-branding.test.ts and test/login-page.test.ts.
const ROEBEL_TRACE = /r(ö|oe)bel/i

const stubBridge: AuthBridge = {
  issueNonce: () => 'stub-nonce',
  verifyLogin: async () => ({ address: ADDRESS }),
}

const stubClaims = async (address: string): Promise<RoebelClaims> => ({
  sub: address,
  email: 'e@x.de',
  name: 'Test',
  preferred_username: 'Test',
  groups: ['citizen', 'org:o1:admin'],
  'roebel:citizen': true,
  'roebel:attester': false,
})

// Plain Map-backed Adapter — panva's public Adapter contract implemented directly (no
// Supabase-shaped indirection needed here; see test/supabase-adapter.test.ts for that layer).
function inMemoryAdapterFactory(): (name: string) => Adapter {
  const collections = new Map<string, Map<string, AdapterPayload>>()
  const collection = (name: string) => {
    let c = collections.get(name)
    if (!c) { c = new Map(); collections.set(name, c) }
    return c
  }
  return (name: string): Adapter => ({
    async upsert(id, payload) { collection(name).set(id, payload) },
    async find(id) { return collection(name).get(id) },
    async findByUid(uid) {
      for (const c of collections.values()) {
        for (const payload of c.values()) if (payload.uid === uid) return payload
      }
      return undefined
    },
    async findByUserCode(userCode) {
      for (const c of collections.values()) {
        for (const payload of c.values()) if (payload.userCode === userCode) return payload
      }
      return undefined
    },
    async consume(id) {
      const payload = collection(name).get(id)
      if (payload) payload.consumed = Math.floor(Date.now() / 1000)
    },
    async destroy(id) { collection(name).delete(id) },
    async revokeByGrantId(grantId) {
      for (const c of collections.values()) {
        for (const [id, payload] of c.entries()) if (payload.grantId === grantId) c.delete(id)
      }
    },
  })
}

function getEphemeralPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer()
    probe.on('error', reject)
    probe.listen(0, () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolve(port))
    })
  })
}

// Minimal cookie jar: oidc-provider's interaction flow relies on the signed `_interaction`
// (and later `_session`) cookies, which openid-client's HTTP client doesn't manage for us
// since we're driving the browser-facing hops (GET /auth, GET /interaction/:uid, POST
// .../login, GET the resume URL) by hand.
class CookieJar {
  private jar = new Map<string, string>()
  capture(setCookie: string[] | undefined) {
    for (const line of setCookie ?? []) {
      const pair = line.split(';', 1)[0]
      const idx = pair.indexOf('=')
      if (idx === -1) continue
      this.jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim())
    }
  }
  header(): string {
    return [...this.jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
  }
}

interface RawResponse { status: number; headers: http.IncomingHttpHeaders; body: string }

function rawRequest(url: string, opts: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url)
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method: opts.method ?? 'GET',
      headers: opts.headers,
    }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

describe('authorization_code + PKCE end-to-end (Nextcloud-as-relying-party proof)', () => {
  let server: Server
  let issuer: string

  beforeAll(async () => {
    const port = await getEphemeralPort()
    issuer = `http://localhost:${port}`

    const { privateKey } = await generateKeyPair('RS256', { extractable: true })
    const jwk = await exportJWK(privateKey)
    jwk.kid = 'e2e-test-key'
    jwk.use = 'sig'
    jwk.alg = 'RS256'
    process.env.JWKS_JSON = JSON.stringify({ keys: [jwk] })

    const testConfig: Config = {
      issuer,
      port,
      cookieKeys: ['e2e-test-cookie-key'],
      gnosisRpcUrl: 'http://unused.invalid',
      chainId: 100,
      citizenNftAddress: '0x000000000000000000000000000000000000dEaD',
      attesterNftAddress: '0x000000000000000000000000000000000000dEaD',
      supabaseUrl: 'http://unused.invalid',
      supabaseServiceKey: 'unused',
      thirdwebClientId: 'unused',
      relyingParties: [
        {
          name: 'nextcloud',
          clientId: 'nextcloud',
          clientSecret: 'nextcloud-secret',
          redirectUris: [REDIRECT_URI],
          postLogoutRedirectUris: [],
          branding: { preset: 'roebel' },
        },
        // I2 pilot-critical path (see "renders Ortis branding..." below): branding must survive
        // the full wireApp -> buildProvider -> real oidc-provider interaction path, not just the
        // stub-Provider path already covered by test/interaction-branding.test.ts.
        {
          name: 'ortis',
          clientId: 'ortis',
          clientSecret: 'ortis-secret',
          redirectUris: [ORTIS_REDIRECT_URI],
          postLogoutRedirectUris: [],
          branding: { preset: 'ortis', context: 'Amt Musterstadt' },
        },
      ],
    }

    const { app } = wireApp(testConfig, {
      bridge: stubBridge,
      resolveClaims: stubClaims,
      adapterFactory: inMemoryAdapterFactory(),
    })

    server = await new Promise<Server>((resolve) => {
      const s = app.listen(port, () => resolve(s))
    })
  })

  afterAll(async () => {
    delete process.env.JWKS_JSON
    await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())))
  })

  it('completes authorization_code flow and returns roebel claims in the id_token', async () => {
    const discovered = await Issuer.discover(issuer)
    const client = new discovered.Client({
      client_id: 'nextcloud',
      client_secret: 'nextcloud-secret',
      redirect_uris: [REDIRECT_URI],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
    })

    const code_verifier = generators.codeVerifier()
    const code_challenge = generators.codeChallenge(code_verifier)
    const state = generators.state()

    const authorizationUrl = client.authorizationUrl({
      scope: 'openid email profile roebel',
      code_challenge,
      code_challenge_method: 'S256',
      redirect_uri: REDIRECT_URI,
      state,
    })

    const jar = new CookieJar()

    // 1. GET /auth -> no session yet -> 303 to /interaction/:uid
    let res = await rawRequest(authorizationUrl)
    jar.capture(res.headers['set-cookie'])
    expect(res.status).toBe(303)
    const interactionUrl = new URL(res.headers.location!, issuer)
    const uid = interactionUrl.pathname.split('/').pop()!

    // 2. GET the login page itself (exercises the router's GET handler + no-store header)
    res = await rawRequest(interactionUrl.toString(), { headers: { cookie: jar.header() } })
    jar.capture(res.headers['set-cookie'])
    expect(res.status).toBe(200)
    expect(res.headers['cache-control']).toContain('no-store')
    expect(res.body).toContain('Röbel ID')

    // 3. GET the nonce endpoint (exercises the router's nonce hook; value is irrelevant since
    //    verifyLogin is stubbed)
    res = await rawRequest(`${issuer}/interaction/${uid}/nonce`, { headers: { cookie: jar.header() } })
    expect(res.status).toBe(200)
    expect(res.body.length).toBeGreaterThan(0)

    // 4. POST the login (SIWE message/signature are never checked — stubBridge.verifyLogin
    //    resolves the fixed address unconditionally)
    res = await rawRequest(`${issuer}/interaction/${uid}/login`, {
      method: 'POST',
      headers: { cookie: jar.header(), 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'irrelevant', signature: '0xirrelevant' }),
    })
    jar.capture(res.headers['set-cookie'])
    expect(res.status).toBe(200)
    const { redirectTo } = JSON.parse(res.body) as { redirectTo: string }

    // 5. Follow the resume URL -> both login and consent are satisfied in one shot (the router
    //    pre-grants the requested scope alongside login) -> 303 to the client's redirect_uri
    res = await rawRequest(new URL(redirectTo, issuer).toString(), { headers: { cookie: jar.header() } })
    jar.capture(res.headers['set-cookie'])
    expect(res.status).toBe(303)
    const callbackUrl = new URL(res.headers.location!)
    expect(callbackUrl.origin + callbackUrl.pathname).toBe(REDIRECT_URI)
    expect(callbackUrl.searchParams.get('state')).toBe(state)
    expect(callbackUrl.searchParams.get('code')).toBeTruthy()

    // 6. Exchange the code at /token (real PKCE verification against the code_verifier)
    const params = client.callbackParams(callbackUrl.toString())
    const tokenSet = await client.callback(REDIRECT_URI, params, { code_verifier, state })

    expect(tokenSet.access_token).toBeTruthy()
    const claims = tokenSet.claims()
    expect(claims.sub).toBe(ADDRESS)
    expect(claims.iss).toBe(issuer)

    // groups must show up in the id_token or via userinfo (/me)
    const userinfo = await client.userinfo(tokenSet)
    const groups = (claims as { groups?: string[] }).groups ?? (userinfo as { groups?: string[] }).groups
    expect(groups).toEqual(['citizen', 'org:o1:admin'])
    expect(userinfo.sub).toBe(ADDRESS)
  })

  // I2 pilot-critical path: test/interaction-branding.test.ts already proves the router picks
  // branding by client_id against a stub Provider; this proves the same thing survives the real
  // wireApp -> buildProvider -> oidc-provider interaction path end-to-end, for the one client
  // (Ortis) where getting this wrong means a visiting mayor sees Röbel branding.
  it('renders Ortis branding (not Röbel) for a real authorize request through the Ortis client', async () => {
    const discovered = await Issuer.discover(issuer)
    const ortisClient = new discovered.Client({
      client_id: 'ortis',
      client_secret: 'ortis-secret',
      redirect_uris: [ORTIS_REDIRECT_URI],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
    })

    const code_verifier = generators.codeVerifier()
    const code_challenge = generators.codeChallenge(code_verifier)
    const state = generators.state()

    const authorizationUrl = ortisClient.authorizationUrl({
      scope: 'openid email profile roebel',
      code_challenge,
      code_challenge_method: 'S256',
      redirect_uri: ORTIS_REDIRECT_URI,
      state,
    })

    const jar = new CookieJar()

    // 1. GET /auth for the ortis client -> no session yet -> 303 to /interaction/:uid
    let res = await rawRequest(authorizationUrl)
    jar.capture(res.headers['set-cookie'])
    expect(res.status).toBe(303)
    const interactionUrl = new URL(res.headers.location!, issuer)

    // 2. GET the login page itself — the interaction router resolves branding from the pending
    // interaction's client_id (src/interaction/router.ts -> src/interaction/login-page.ts).
    res = await rawRequest(interactionUrl.toString(), { headers: { cookie: jar.header() } })
    expect(res.status).toBe(200)
    expect(res.body).toContain('<h1>Ortis</h1>')
    expect(res.body).toContain('Amt Musterstadt')
    expect(res.body).not.toMatch(ROEBEL_TRACE)
    expect(res.body).not.toContain('#00498B')
  })
})
