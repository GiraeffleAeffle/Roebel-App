import { createClient } from '@supabase/supabase-js'
import { createPrivateKey } from 'node:crypto'
import type { Config } from './config.js'
import type { AuthBridge } from './auth-bridge/types.js'
import type { NetizenClaims } from './claims/types.js'
import { createThirdwebAuthBridge } from './auth-bridge/thirdweb-bridge.js'
import { createMemoryNonceStore } from './auth-bridge/nonce-store.js'
import { createGnosisVerifier } from './lib/gnosis.js'
import { makeSupabaseAdapterFactory } from './store/supabase-adapter.js'
import { wireApp } from './wire.js'
import { renderStagingLoginPage } from './interaction/staging-login-page.js'

const ISSUER = 'https://roebel-id.staging.agentcart.eu'
const CALLBACK = 'https://roebel-web.staging.agentcart.eu/api/workspace/auth/callback'
const DATABASE = 'http://roebel-tracer-postgrest.stadtstack-roebel-staging-lab.svc.cluster.local:3000'
const WALLET = /^0x[0-9a-f]{40}$/

export type StagingConfig = Config & { allowedWallets: readonly string[] }

/** Separate staging credentials and one relying party, with no production reads. */
export function loadStagingConfig(env: NodeJS.ProcessEnv = process.env): StagingConfig {
  const required = (name: string) => {
    const value = env[name]?.trim()
    if (!value) throw new Error(`Missing staging setting: ${name}`)
    return value
  }
  if (required('ISSUER_URL') !== ISSUER || required('SUPABASE_URL') !== DATABASE ||
      env.SIGNER_RESOURCE_URL || env.FIRST_PARTY_RPS ||
      ['NEXTCLOUD_CLIENT_ID', 'MATRIX_CLIENT_ID', 'ORTIS_CLIENT_ID'].some((name) => env[name])) {
    throw new Error('Staging identity requires its own issuer, database and sole workspace client')
  }
  if (required('WEB_CLIENT_ID') !== 'roebel-town-workspace-staging' ||
      required('WEB_REDIRECT_URIS') !== CALLBACK) throw new Error('Staging workspace client mismatch')
  const allowedWallets = required('STAGING_ALLOWED_WALLETS').split(',').map((s) => s.trim().toLowerCase())
  if (allowedWallets.length > 8 || new Set(allowedWallets).size !== allowedWallets.length ||
      !allowedWallets.every((value) => WALLET.test(value) && !/^0x0+$/.test(value))) {
    throw new Error('Staging identity requires one to eight explicit test wallets')
  }
  const cookieKeys = required('COOKIE_KEYS').split(',').map((s) => s.trim())
  const clientSecret = required('WEB_CLIENT_SECRET')
  if (cookieKeys.length < 2 || new Set([...cookieKeys, clientSecret]).size !== cookieKeys.length + 1 ||
      !cookieKeys.every((s) => /^[A-Za-z0-9_-]{43,}$/.test(s)) ||
      !/^[A-Za-z0-9_-]{43,}$/.test(clientSecret)) throw new Error('Staging keys must be distinct strong secrets')
  try {
    const jwks = JSON.parse(required('JWKS_JSON'))
    if (!Array.isArray(jwks.keys) || !jwks.keys.length || jwks.keys.length > 3) throw Error()
    const ids = new Set<string>()
    for (const key of jwks.keys) {
      if (key.kty !== 'RSA' || key.alg !== 'RS256' || key.use !== 'sig' ||
          typeof key.kid !== 'string' || !key.kid || ids.has(key.kid)) throw Error()
      ids.add(key.kid)
      const parsed = createPrivateKey({ key, format: 'jwk' })
      if (parsed.asymmetricKeyType !== 'rsa' || (parsed.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) throw Error()
    }
  } catch { throw new Error('Staging identity requires a persistent private RSA signing key set') }
  const rpc = new URL(required('GNOSIS_RPC_URL'))
  if (rpc.protocol !== 'https:' || rpc.username || rpc.password || rpc.hash) throw new Error('Staging RPC must use HTTPS')
  if (env.CHAIN_ID && env.CHAIN_ID !== '100') throw new Error('Staging wallet signatures use Gnosis chain 100')
  const port = Number(env.PORT ?? 3010)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Staging port invalid')
  return {
    issuer: ISSUER, port, cookieKeys, gnosisRpcUrl: rpc.href, chainId: 100,
    // The staging claims resolver never queries either NFT contract.
    citizenNftAddress: '0x0000000000000000000000000000000000000000',
    attesterNftAddress: '0x0000000000000000000000000000000000000000',
    supabaseUrl: DATABASE, supabaseServiceKey: required('STAGING_IDENTITY_DATABASE_KEY'),
    thirdwebClientId: '', allowedWallets,
    relyingParties: [{ name: 'web', clientId: 'roebel-town-workspace-staging', clientSecret,
      redirectUris: [CALLBACK], postLogoutRedirectUris: [],
      branding: { preset: 'roebel', context: 'Town Workspace · Staging / Testbetrieb' } }],
  }
}

/** A real verified wallet login is necessary before the test allowlist is checked. */
export function stagingIdentity(allowedWallets: readonly string[], bridge: AuthBridge) {
  const allowed = new Set(allowedWallets)
  const requireWallet = (address: string) => {
    const subject = address.toLowerCase()
    if (!WALLET.test(subject) || !allowed.has(subject)) throw new Error('Staging test account required')
    return subject
  }
  return {
    bridge: {
      issueNonce: () => bridge.issueNonce(),
      async verifyLogin(input: Parameters<AuthBridge['verifyLogin']>[0]) {
        const { address } = await bridge.verifyLogin(input)
        return { address: requireWallet(address) }
      },
    } satisfies AuthBridge,
    resolveClaims: async (address: string): Promise<NetizenClaims> => ({
      sub: requireWallet(address), name: 'Staging-Testkonto', groups: [],
      'netizen:citizen': false, 'netizen:attester': false, 'netizen:actor_type': 'human',
    }),
  }
}

/** Restrict the server-held database key to this instance's OAuth state table. */
export function stagingDatabaseFetch(fetcher: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const request = new Request(input, init)
    const target = new URL(request.url)
    if (target.origin !== DATABASE || target.pathname !== '/rest/v1/oidc_payloads') {
      throw new Error('Staging identity database request rejected')
    }
    target.pathname = '/oidc_payloads'
    return fetcher(new Request(new Request(target, request), { redirect: 'error' }))
  }
}

export function wireStagingApp(config: StagingConfig = loadStagingConfig()) {
  const identity = stagingIdentity(config.allowedWallets, createThirdwebAuthBridge({
    config, nonceStore: createMemoryNonceStore(), verifier: createGnosisVerifier(config),
  }))
  const client = createClient(config.supabaseUrl, config.supabaseServiceKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    global: { fetch: stagingDatabaseFetch() },
  })
  return wireApp(config, { ...identity, adapterFactory: makeSupabaseAdapterFactory({ client }),
    loginPage: renderStagingLoginPage })
}
