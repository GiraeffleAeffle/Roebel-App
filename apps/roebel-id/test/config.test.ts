import { describe, it, expect, afterEach } from 'vitest'
import { loadConfig } from '../src/config.js'

const BASE = {
  ISSUER_URL: 'https://id.example',
  COOKIE_KEYS: 'a,b',
  GNOSIS_RPC_URL: 'https://rpc.example',
  CITIZEN_NFT_ADDRESS: '0x0000000000000000000000000000000000000001',
  ATTESTER_NFT_ADDRESS: '0x0000000000000000000000000000000000000002',
  SUPABASE_URL: 'https://supabase.example',
  SUPABASE_SERVICE_KEY: 'service',
  THIRDWEB_CLIENT_ID: 'tw',
  NEXTCLOUD_CLIENT_ID: 'nextcloud',
  NEXTCLOUD_CLIENT_SECRET: 'nc-secret',
  NEXTCLOUD_REDIRECT_URIS: 'https://cloud.example/apps/user_oidc/code',
}

function withEnv(extra: Record<string, string>) {
  for (const [k, v] of Object.entries({ ...BASE, ...extra })) process.env[k] = v
}

// Generic cleanup, not a hardcoded prefix list: any RP env-block subvar (whichever prefix
// created it) plus FIRST_PARTY_RPS itself, plus everything in BASE.
afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (
      key in BASE ||
      key === 'FIRST_PARTY_RPS' ||
      /_(CLIENT_ID|CLIENT_SECRET|REDIRECT_URIS|POST_LOGOUT_URIS|BRANDING|BRANDING_CONTEXT)$/.test(key)
    ) {
      delete process.env[key]
    }
  }
})

describe('relying party list', () => {
  it('registers nextcloud first, and alone, when no optional RP is configured', () => {
    withEnv({})
    expect(loadConfig().relyingParties).toEqual([
      {
        name: 'nextcloud',
        clientId: 'nextcloud',
        clientSecret: 'nc-secret',
        redirectUris: ['https://cloud.example/apps/user_oidc/code'],
        postLogoutRedirectUris: [],
        branding: { preset: 'roebel' },
      },
    ])
  })

  it('fails loudly when a required nextcloud subvar is missing', () => {
    withEnv({ NEXTCLOUD_CLIENT_SECRET: '' })
    expect(() => loadConfig()).toThrow(/Missing required env: NEXTCLOUD_CLIENT_SECRET/)
  })
})

describe('web relying party', () => {
  it('is absent when WEB_CLIENT_ID is unset, so the keystone boots unchanged', () => {
    withEnv({})
    expect(loadConfig().relyingParties.find((rp) => rp.name === 'web')).toBeUndefined()
  })

  it('is registered when WEB_CLIENT_ID is set', () => {
    withEnv({
      WEB_CLIENT_ID: 'roebel-web',
      WEB_CLIENT_SECRET: 'web-secret',
      WEB_REDIRECT_URIS: 'https://roebel.app/api/workspace/auth/callback',
    })
    expect(loadConfig().relyingParties.find((rp) => rp.name === 'web')).toEqual({
      name: 'web',
      clientId: 'roebel-web',
      clientSecret: 'web-secret',
      redirectUris: ['https://roebel.app/api/workspace/auth/callback'],
      postLogoutRedirectUris: [],
      branding: { preset: 'roebel' },
    })
  })

  it('fails loudly when the id is set but the secret is missing', () => {
    withEnv({
      WEB_CLIENT_ID: 'roebel-web',
      WEB_REDIRECT_URIS: 'https://roebel.app/api/workspace/auth/callback',
    })
    expect(() => loadConfig()).toThrow(/WEB_CLIENT_SECRET/)
  })

  it('accepts several redirect uris, for preview deployments', () => {
    withEnv({
      WEB_CLIENT_ID: 'roebel-web',
      WEB_CLIENT_SECRET: 'web-secret',
      WEB_REDIRECT_URIS:
        'https://roebel.app/api/workspace/auth/callback,https://staging.roebel.app/api/workspace/auth/callback',
    })
    expect(loadConfig().relyingParties.find((rp) => rp.name === 'web')?.redirectUris.length).toBe(2)
  })
})

describe('ortis relying party', () => {
  it('is absent when ORTIS_CLIENT_ID is unset, so the keystone boots unchanged', () => {
    withEnv({})
    expect(loadConfig().relyingParties.find((rp) => rp.name === 'ortis')).toBeUndefined()
  })

  it('is registered with the app.ortis.<domain> redirect plus a local dev uri, when set, and defaults to ortis branding (never Röbel by omission)', () => {
    withEnv({
      ORTIS_CLIENT_ID: 'ortis',
      ORTIS_CLIENT_SECRET: 'ortis-secret',
      ORTIS_REDIRECT_URIS:
        'https://app.ortis.roebel.app/api/auth/callback,http://localhost:3000/api/auth/callback',
    })
    expect(loadConfig().relyingParties.find((rp) => rp.name === 'ortis')).toEqual({
      name: 'ortis',
      clientId: 'ortis',
      clientSecret: 'ortis-secret',
      redirectUris: [
        'https://app.ortis.roebel.app/api/auth/callback',
        'http://localhost:3000/api/auth/callback',
      ],
      postLogoutRedirectUris: [],
      branding: { preset: 'ortis' },
    })
  })

  it('fails loudly when the id is set but the secret is missing', () => {
    withEnv({
      ORTIS_CLIENT_ID: 'ortis',
      ORTIS_REDIRECT_URIS: 'https://app.ortis.roebel.app/api/auth/callback',
    })
    expect(() => loadConfig()).toThrow(/Missing required env: ORTIS_CLIENT_SECRET/)
  })

  it('trims whitespace around comma-separated redirect uris (a space after the comma must not create a silent mismatch at the authorize endpoint)', () => {
    withEnv({
      ORTIS_CLIENT_ID: 'ortis',
      ORTIS_CLIENT_SECRET: 'ortis-secret',
      ORTIS_REDIRECT_URIS: 'https://a/cb, https://b/cb',
    })
    expect(loadConfig().relyingParties.find((rp) => rp.name === 'ortis')?.redirectUris).toEqual([
      'https://a/cb',
      'https://b/cb',
    ])
  })
})

describe('additional first-party RPs via FIRST_PARTY_RPS', () => {
  it('is a no-op when unset', () => {
    withEnv({})
    expect(loadConfig().relyingParties.map((rp) => rp.name)).toEqual(['nextcloud'])
  })

  it('registers a listed prefix, fully resolved', () => {
    withEnv({
      FIRST_PARTY_RPS: 'BUZZ',
      BUZZ_CLIENT_ID: 'buzz',
      BUZZ_CLIENT_SECRET: 'buzz-secret',
      BUZZ_REDIRECT_URIS: 'https://buzz.example/callback',
    })
    expect(loadConfig().relyingParties.find((rp) => rp.name === 'buzz')).toEqual({
      name: 'buzz',
      clientId: 'buzz',
      clientSecret: 'buzz-secret',
      redirectUris: ['https://buzz.example/callback'],
      postLogoutRedirectUris: [],
      branding: { preset: 'roebel' },
    })
  })

  it('supports several extra prefixes, comma-separated, appended after the known ones', () => {
    withEnv({
      FIRST_PARTY_RPS: 'BUZZ,FOO',
      WEB_CLIENT_ID: 'roebel-web',
      WEB_CLIENT_SECRET: 'web-secret',
      WEB_REDIRECT_URIS: 'https://roebel.app/api/workspace/auth/callback',
      BUZZ_CLIENT_ID: 'buzz',
      BUZZ_CLIENT_SECRET: 'buzz-secret',
      BUZZ_REDIRECT_URIS: 'https://buzz.example/callback',
      FOO_CLIENT_ID: 'foo',
      FOO_CLIENT_SECRET: 'foo-secret',
      FOO_REDIRECT_URIS: 'https://foo.example/callback',
    })
    expect(loadConfig().relyingParties.map((rp) => rp.name)).toEqual(['nextcloud', 'web', 'buzz', 'foo'])
  })

  it('fails loudly when a listed prefix is missing a required subvar — listing it opts in unconditionally, unlike the known optional prefixes', () => {
    withEnv({
      FIRST_PARTY_RPS: 'BUZZ',
      BUZZ_CLIENT_ID: 'buzz',
      // BUZZ_CLIENT_SECRET intentionally missing
      BUZZ_REDIRECT_URIS: 'https://buzz.example/callback',
    })
    expect(() => loadConfig()).toThrow(/Missing required env: BUZZ_CLIENT_SECRET/)
  })
})

describe('same-behavior guarantee', () => {
  it('nextcloud-only env registers exactly one client', () => {
    withEnv({})
    expect(loadConfig().relyingParties.map((rp) => rp.name)).toEqual(['nextcloud'])
  })

  it('nextcloud+matrix+web env registers exactly those three, in that order', () => {
    withEnv({
      MATRIX_CLIENT_ID: 'matrix',
      MATRIX_CLIENT_SECRET: 'matrix-secret',
      MATRIX_REDIRECT_URIS: 'https://auth.roebel.app/upstream/callback/01ROEBELIDPROVIDERULID000000',
      WEB_CLIENT_ID: 'roebel-web',
      WEB_CLIENT_SECRET: 'web-secret',
      WEB_REDIRECT_URIS: 'https://roebel.app/api/workspace/auth/callback',
    })
    expect(loadConfig().relyingParties.map((rp) => rp.name)).toEqual(['nextcloud', 'matrix', 'web'])
  })
})

// I2 — per-RP login branding (pilot-critical: an Ortis client must never resolve to Röbel
// branding). <PREFIX>_BRANDING selects the preset — default 'roebel' for every prefix except
// ORTIS, which defaults to 'ortis' (see PREFIX_BRANDING_DEFAULT in config.ts) so an operator
// who sets the three vars that make the Ortis OIDC client work and forgets the branding var
// still can't ship a Röbel-branded page to a visiting mayor. <PREFIX>_BRANDING_CONTEXT is an
// optional free-text line (e.g. an Amt/org name for the pilot).
describe('branding', () => {
  it('defaults to the roebel preset when <PREFIX>_BRANDING is unset', () => {
    withEnv({})
    expect(loadConfig().relyingParties.find((rp) => rp.name === 'nextcloud')?.branding).toEqual({ preset: 'roebel' })
  })

  it('selects the ortis preset when set explicitly', () => {
    withEnv({ NEXTCLOUD_BRANDING: 'ortis' })
    expect(loadConfig().relyingParties.find((rp) => rp.name === 'nextcloud')?.branding).toEqual({ preset: 'ortis' })
  })

  it('fails loudly on an unrecognized preset value', () => {
    withEnv({ NEXTCLOUD_BRANDING: 'bogus' })
    expect(() => loadConfig()).toThrow(/Invalid NEXTCLOUD_BRANDING/)
  })

  it('carries an optional context line', () => {
    withEnv({ NEXTCLOUD_BRANDING_CONTEXT: 'Amt Röbel-Müritz' })
    expect(loadConfig().relyingParties.find((rp) => rp.name === 'nextcloud')?.branding).toEqual({
      preset: 'roebel',
      context: 'Amt Röbel-Müritz',
    })
  })

  it('omits context from the branding object when unset (no empty string)', () => {
    withEnv({})
    expect(loadConfig().relyingParties.find((rp) => rp.name === 'nextcloud')?.branding).not.toHaveProperty('context')
  })

  it('treats an explicit empty-string BRANDING_CONTEXT the same as unset', () => {
    withEnv({ NEXTCLOUD_BRANDING_CONTEXT: '' })
    expect(loadConfig().relyingParties.find((rp) => rp.name === 'nextcloud')?.branding).toEqual({ preset: 'roebel' })
  })

  it('gives ortis its own ortis branding + context, independent of nextcloud', () => {
    withEnv({
      ORTIS_CLIENT_ID: 'ortis',
      ORTIS_CLIENT_SECRET: 'ortis-secret',
      ORTIS_REDIRECT_URIS: 'https://app.ortis.roebel.app/api/auth/callback',
      ORTIS_BRANDING: 'ortis',
      ORTIS_BRANDING_CONTEXT: 'Amt Musterstadt',
    })
    const cfg = loadConfig()
    expect(cfg.relyingParties.find((rp) => rp.name === 'ortis')?.branding).toEqual({
      preset: 'ortis',
      context: 'Amt Musterstadt',
    })
    expect(cfg.relyingParties.find((rp) => rp.name === 'nextcloud')?.branding).toEqual({ preset: 'roebel' })
  })

  it('defaults an ortis RP to the ortis preset even when ORTIS_BRANDING is unset entirely (the footgun this guards against)', () => {
    withEnv({
      ORTIS_CLIENT_ID: 'ortis',
      ORTIS_CLIENT_SECRET: 'ortis-secret',
      ORTIS_REDIRECT_URIS: 'https://app.ortis.roebel.app/api/auth/callback',
      // ORTIS_BRANDING intentionally unset — an operator who wired up only the three vars that
      // make the OIDC client work must still never get a Röbel-branded page for Ortis.
    })
    expect(loadConfig().relyingParties.find((rp) => rp.name === 'ortis')?.branding).toEqual({ preset: 'ortis' })
  })

  it('still honors an explicit ORTIS_BRANDING=roebel override, if that is ever truly wanted', () => {
    withEnv({
      ORTIS_CLIENT_ID: 'ortis',
      ORTIS_CLIENT_SECRET: 'ortis-secret',
      ORTIS_REDIRECT_URIS: 'https://app.ortis.roebel.app/api/auth/callback',
      ORTIS_BRANDING: 'roebel',
    })
    expect(loadConfig().relyingParties.find((rp) => rp.name === 'ortis')?.branding).toEqual({ preset: 'roebel' })
  })
})
