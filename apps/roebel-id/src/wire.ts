import { createClient } from '@supabase/supabase-js'
import type { Adapter } from 'oidc-provider'
import { loadConfig, type Config } from './config.js'
import { createGnosisVerifier } from './lib/gnosis.js'
import { createMemoryNonceStore } from './auth-bridge/nonce-store.js'
import { createThirdwebAuthBridge } from './auth-bridge/thirdweb-bridge.js'
import type { AuthBridge } from './auth-bridge/types.js'
import { createReaders } from './claims/readers.js'
import { createClaimsResolver } from './claims/resolver.js'
import type { RoebelClaims } from './claims/types.js'
import { makeSupabaseAdapterFactory } from './store/supabase-adapter.js'
import { buildProvider } from './oidc/provider.js'
import { createInteractionRouter } from './interaction/router.js'
import { createApp } from './app.js'

export interface WireOverrides {
  bridge?: AuthBridge
  resolveClaims?: (address: string) => Promise<RoebelClaims>
  adapterFactory?: (name: string) => Adapter
}

// Composition root: config -> verifier -> bridge -> readers -> resolver -> adapter -> provider -> app.
// Every real dependency can be swapped for a stub via `overrides`, which is what lets
// test/e2e-flow.test.ts drive the full authorization_code + PKCE flow without a live Supabase
// project, thirdweb client, or Gnosis RPC endpoint.
export function wireApp(config: Config = loadConfig(), overrides: WireOverrides = {}) {
  const bridge = overrides.bridge ?? createThirdwebAuthBridge({
    config,
    nonceStore: createMemoryNonceStore(),
    verifier: createGnosisVerifier(config),
  })

  const resolveClaims = overrides.resolveClaims ?? createClaimsResolver(createReaders(config))

  const adapterFactory = overrides.adapterFactory ?? makeSupabaseAdapterFactory({
    client: createClient(config.supabaseUrl, config.supabaseServiceKey),
  })

  const provider = buildProvider({ config, adapterFactory, resolveClaims })
  const interactionRouter = createInteractionRouter({
    provider,
    bridge,
    thirdwebClientId: config.thirdwebClientId,
    chainId: config.chainId,
    firstPartyClientIds: [
      config.nextcloud.clientId,
      ...(config.matrix ? [config.matrix.clientId] : []),
      ...(config.web ? [config.web.clientId] : []),
    ],
  })

  // Interaction routes must be mounted before provider.callback() so panva's catch-all OIDC
  // routes never shadow /interaction/*.
  const app = createApp({ provider, interactionRouter })

  return { app, provider, bridge }
}
