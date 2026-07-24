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
