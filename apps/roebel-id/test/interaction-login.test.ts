import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import http from 'node:http'
import { createServer as createNetServer } from 'node:net'
import type { Server } from 'node:http'
import { generateKeyPair, exportJWK } from 'jose'
import type { Adapter, AdapterPayload } from 'oidc-provider'
import { wireApp } from '../src/wire.js'
import type { Config } from '../src/config.js'
import type { AuthBridge } from '../src/auth-bridge/types.js'
import type { RoebelClaims } from '../src/claims/types.js'

// Covers the login POST's failure path: when AuthBridge.verifyLogin rejects (bad signature,
// replayed/unknown nonce, expired SIWE message, ...), the router must respond 401 with a
// generic body — no internal error text leaked to the client. See test/e2e-flow.test.ts for
// the corresponding happy path (kept intact / unchanged by this fix).

const REDIRECT_URI = 'http://localhost:8080/apps/user_oidc/code'

const rejectingBridge: AuthBridge = {
  issueNonce: () => 'stub-nonce',
  verifyLogin: async () => { throw new Error('signature verification failed: leaked-secret-detail') },
}

const stubClaims = async (address: string): Promise<RoebelClaims> => ({
  sub: address,
  groups: [],
  'roebel:citizen': false,
  'roebel:attester': false,
})

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

describe('interaction login POST — failure path', () => {
  let server: Server
  let issuer: string

  beforeAll(async () => {
    const port = await getEphemeralPort()
    issuer = `http://localhost:${port}`

    const { privateKey } = await generateKeyPair('RS256', { extractable: true })
    const jwk = await exportJWK(privateKey)
    jwk.kid = 'interaction-login-test-key'
    jwk.use = 'sig'
    jwk.alg = 'RS256'
    process.env.JWKS_JSON = JSON.stringify({ keys: [jwk] })

    const testConfig: Config = {
      issuer,
      port,
      cookieKeys: ['interaction-login-test-cookie-key'],
      gnosisRpcUrl: 'http://unused.invalid',
      chainId: 100,
      citizenNftAddress: '0x000000000000000000000000000000000000dEaD',
      attesterNftAddress: '0x000000000000000000000000000000000000dEaD',
      supabaseUrl: 'http://unused.invalid',
      supabaseServiceKey: 'unused',
      thirdwebClientId: 'unused',
      nextcloud: {
        clientId: 'nextcloud',
        clientSecret: 'nextcloud-secret',
        redirectUris: [REDIRECT_URI],
        postLogoutRedirectUris: [],
      },
    }

    const { app } = wireApp(testConfig, {
      bridge: rejectingBridge,
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

  it('responds 401 with a generic body when verifyLogin rejects, without leaking the internal error', async () => {
    const authorizationUrl = `${issuer}/auth?client_id=nextcloud&response_type=code&scope=${encodeURIComponent('openid email profile roebel')}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&code_challenge=E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM&code_challenge_method=S256&state=xyz`

    const jar = new CookieJar()

    // Reach a real pending 'login' interaction the same way a browser would.
    let res = await rawRequest(authorizationUrl)
    jar.capture(res.headers['set-cookie'])
    expect(res.status).toBe(303)
    const interactionUrl = new URL(res.headers.location!, issuer)
    const uid = interactionUrl.pathname.split('/').pop()!

    res = await rawRequest(interactionUrl.toString(), { headers: { cookie: jar.header() } })
    jar.capture(res.headers['set-cookie'])
    expect(res.status).toBe(200)

    // POST the login for that valid pending interaction — the stub bridge rejects unconditionally.
    res = await rawRequest(`${issuer}/interaction/${uid}/login`, {
      method: 'POST',
      headers: { cookie: jar.header(), 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'irrelevant', signature: '0xirrelevant' }),
    })

    expect(res.status).toBe(401)
    const body = JSON.parse(res.body)
    expect(body).toEqual({ error: 'authentication_failed' })
    expect(res.body).not.toContain('leaked-secret-detail')
  })
})
