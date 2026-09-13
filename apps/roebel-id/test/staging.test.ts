import { generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { privateKeyToAccount } from 'viem/accounts'
import { verifyMessage } from 'viem'
import { SiweMessage } from 'siwe'
import { loadStagingConfig, stagingDatabaseFetch, stagingIdentity } from '../src/staging.js'
import { createThirdwebAuthBridge } from '../src/auth-bridge/thirdweb-bridge.js'
import { createMemoryNonceStore } from '../src/auth-bridge/nonce-store.js'

// Public test fixture keys only. The deployed allowlist/keys are private inputs.
const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const other = privateKeyToAccount(`0x${'22'.repeat(32)}`)
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...privateKey.export({ format: 'jwk' }), kid: 'staging-test', alg: 'RS256', use: 'sig' }
const env = {
  ISSUER_URL: 'https://roebel-id.staging.agentcart.eu',
  SUPABASE_URL: 'http://roebel-tracer-postgrest.stadtstack-roebel-staging-lab.svc.cluster.local:3000',
  STAGING_IDENTITY_DATABASE_KEY: 'synthetic-private-database-key',
  WEB_CLIENT_ID: 'roebel-town-workspace-staging',
  WEB_CLIENT_SECRET: 'c'.repeat(43),
  WEB_REDIRECT_URIS: 'https://roebel-web.staging.agentcart.eu/api/workspace/auth/callback',
  STAGING_ALLOWED_WALLETS: account.address,
  COOKIE_KEYS: `${'a'.repeat(43)},${'b'.repeat(43)}`,
  GNOSIS_RPC_URL: 'https://rpc.gnosischain.com',
  JWKS_JSON: JSON.stringify({ keys: [jwk] }),
}

describe('independent staging identity', () => {
  it('boots its own one-client configuration without production profile or NFT settings', () => {
    const config = loadStagingConfig(env)
    expect(config.allowedWallets).toEqual([account.address.toLowerCase()])
    expect(config.relyingParties).toHaveLength(1)
    expect(config.signerResourceUrl).toBeUndefined()
  })

  it.each([
    { ISSUER_URL: 'https://id.roebel.app' },
    { SUPABASE_URL: 'https://production.supabase.co' },
    { WEB_REDIRECT_URIS: 'https://roebel.app/api/workspace/auth/callback' },
    { MATRIX_CLIENT_ID: 'matrix' },
    { SIGNER_RESOURCE_URL: 'https://signer.roebel.app' },
    { STAGING_ALLOWED_WALLETS: '' },
    { STAGING_ALLOWED_WALLETS: `${account.address},${account.address}` },
    { COOKIE_KEYS: 'short,keys' },
    { WEB_CLIENT_SECRET: 'a'.repeat(43) },
    { JWKS_JSON: '{"keys":[]}' },
  ])('rejects an incomplete or cross-environment configuration: %j', (change) => {
    expect(() => loadStagingConfig({ ...env, ...change })).toThrow()
  })

  it('verifies a real signed nonce once, rejects an unlisted signer, and issues no civic claims', async () => {
    const config = loadStagingConfig(env)
    const identity = stagingIdentity(config.allowedWallets, createThirdwebAuthBridge({
      config, nonceStore: createMemoryNonceStore(), verifier: verifyMessage,
    }))
    const sign = async (signer: typeof account) => {
      const message = new SiweMessage({ domain: new URL(config.issuer).host, uri: config.issuer,
        address: signer.address, version: '1', chainId: 100, nonce: identity.bridge.issueNonce(),
        issuedAt: new Date().toISOString(), expirationTime: new Date(Date.now() + 60_000).toISOString(),
      }).prepareMessage()
      return { message, signature: await signer.signMessage({ message }) }
    }
    const signed = await sign(account)
    await expect(identity.bridge.verifyLogin(signed)).resolves.toEqual({ address: account.address.toLowerCase() })
    await expect(identity.bridge.verifyLogin(signed)).rejects.toThrow()
    await expect(identity.bridge.verifyLogin(await sign(other))).rejects.toThrow('Staging test account required')
    const claims = await identity.resolveClaims(account.address)
    expect(claims).toMatchObject({ groups: [], 'netizen:citizen': false, 'netizen:attester': false })
    expect(claims.email).toBeUndefined()
    await expect(identity.resolveClaims(other.address)).rejects.toThrow()
  })

  it('keeps OAuth database credentials on the exact staging state-table endpoint', async () => {
    const requests: Request[] = []
    const send = vi.fn(async (request: Request) => { requests.push(request); return new Response('{}') })
    const fetcher = stagingDatabaseFetch(send as typeof fetch)
    await fetcher(`${env.SUPABASE_URL}/rest/v1/oidc_payloads?type=eq.Session`, {
      method: 'POST', headers: { authorization: 'Bearer synthetic-role-token' }, body: '{}',
    })
    expect(requests[0].url).toBe(`${env.SUPABASE_URL}/oidc_payloads?type=eq.Session`)
    expect(requests[0].redirect).toBe('error')
    expect(requests[0].headers.get('authorization')).toBe('Bearer synthetic-role-token')
    expect(await requests[0].text()).toBe('{}')
    await expect(fetcher(`${env.SUPABASE_URL}/rest/v1/users`)).rejects.toThrow()
    await expect(fetcher('https://production.supabase.co/rest/v1/oidc_payloads')).rejects.toThrow()
    expect(send).toHaveBeenCalledTimes(1)
  })
})
