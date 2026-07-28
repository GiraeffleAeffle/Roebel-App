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

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('WEB_') || key in BASE) delete process.env[key]
  }
})

describe('web relying party', () => {
  it('is absent when WEB_CLIENT_ID is unset, so the keystone boots unchanged', () => {
    withEnv({})
    expect(loadConfig().web).toBeUndefined()
  })

  it('is registered when WEB_CLIENT_ID is set', () => {
    withEnv({
      WEB_CLIENT_ID: 'roebel-web',
      WEB_CLIENT_SECRET: 'web-secret',
      WEB_REDIRECT_URIS: 'https://roebel.app/api/workspace/auth/callback',
    })
    expect(loadConfig().web).toEqual({
      clientId: 'roebel-web',
      clientSecret: 'web-secret',
      redirectUris: ['https://roebel.app/api/workspace/auth/callback'],
      postLogoutRedirectUris: [],
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
    expect(loadConfig().web?.redirectUris.length).toBe(2)
  })
})
