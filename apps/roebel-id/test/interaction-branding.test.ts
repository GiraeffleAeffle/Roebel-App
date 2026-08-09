import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import type Provider from 'oidc-provider'
import { createInteractionRouter } from '../src/interaction/router.js'
import type { AuthBridge } from '../src/auth-bridge/types.js'
import type { RelyingPartyConfig } from '../src/config.js'

// I2 — router picks the login page's branding by the requesting client_id (the pilot-critical
// bit: an Ortis client must never resolve to Röbel branding). This drives the real router
// against a minimal stub Provider — only `interactionDetails` is exercised by the GET handler
// under test, so a full oidc-provider instance (see test/e2e-flow.test.ts) isn't needed here.

const bridge: AuthBridge = {
  issueNonce: () => 'stub-nonce',
  verifyLogin: async () => ({ address: '0x0000000000000000000000000000000000000000' }),
}

const relyingParties: RelyingPartyConfig[] = [
  {
    name: 'nextcloud',
    clientId: 'nextcloud',
    clientSecret: 'nextcloud-secret',
    redirectUris: ['http://localhost/nextcloud/callback'],
    postLogoutRedirectUris: [],
    branding: { preset: 'roebel' },
  },
  {
    name: 'ortis',
    clientId: 'ortis',
    clientSecret: 'ortis-secret',
    redirectUris: ['http://localhost/ortis/callback'],
    postLogoutRedirectUris: [],
    branding: { preset: 'ortis', context: 'Amt Musterstadt' },
  },
]

function stubProviderFor(clientId: string): Provider {
  return {
    interactionDetails: async () => ({
      uid: 'uid-1',
      prompt: { name: 'login' },
      params: { client_id: clientId },
    }),
  } as unknown as Provider
}

function appFor(clientId: string): express.Express {
  const app = express()
  app.use(createInteractionRouter({
    provider: stubProviderFor(clientId),
    bridge,
    thirdwebClientId: 'tw-client',
    chainId: 100,
    relyingParties,
  }))
  return app
}

describe('interaction router — branding resolved by client_id', () => {
  it('serves the roebel preset for the nextcloud client', async () => {
    const res = await request(appFor('nextcloud')).get('/interaction/uid-1')
    expect(res.status).toBe(200)
    expect(res.text).toContain('Röbel ID')
    expect(res.text).toContain('#00498B')
    expect(res.text).not.toContain('Ortis')
  })

  it('serves the ortis preset, with its context line and zero Röbel trace, for the ortis client', async () => {
    const res = await request(appFor('ortis')).get('/interaction/uid-1')
    expect(res.status).toBe(200)
    expect(res.text).toContain('<h1>Ortis</h1>')
    expect(res.text).toContain('Amt Musterstadt')
    expect(res.text).not.toContain('Röbel')
    expect(res.text).not.toContain('#00498B')
  })

  it('falls back to the roebel preset for an unrecognized client_id (should not happen for a first-party-only IdP)', async () => {
    const res = await request(appFor('some-unregistered-client')).get('/interaction/uid-1')
    expect(res.status).toBe(200)
    expect(res.text).toContain('Röbel ID')
  })
})
