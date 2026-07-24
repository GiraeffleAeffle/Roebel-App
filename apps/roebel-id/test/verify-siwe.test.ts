import { describe, it, expect, beforeEach } from 'vitest'
import { SiweMessage } from 'siwe'
import { createMemoryNonceStore, type NonceStore } from '../src/auth-bridge/nonce-store.js'
import { verifySiwe } from '../src/auth-bridge/verify-siwe.js'

const ADDR = '0x1111111111111111111111111111111111111111'
const DOMAIN = 'id.roebel.app'

function buildMessage(nonce: string, over: Partial<ConstructorParameters<typeof SiweMessage>[0]> = {}) {
  return new SiweMessage({
    domain: DOMAIN, address: ADDR, statement: 'Sign in to Roebel', uri: `https://${DOMAIN}`,
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

  it('burns the nonce even if the signature fails (fail-closed)', async () => {
    const nonce = store.issue()
    const message = buildMessage(nonce)
    // First attempt: bad signature rejects
    await expect(verifySiwe({ message, signature: '0xbad', nonceStore: store, expectedDomain: DOMAIN, expectedChainId: 100, verifier: async () => false }))
      .rejects.toThrow(/signature/i)
    // Second attempt: same nonce reused also rejects (nonce was burned on first attempt)
    await expect(verifySiwe({ message, signature: '0xsig', nonceStore: store, expectedDomain: DOMAIN, expectedChainId: 100, verifier: okVerifier }))
      .rejects.toThrow(/nonce/i)
  })

  it('rejects an unknown nonce', async () => {
    const unknownNonce = '1234567890abcdef1234567890ab' // valid format, never issued
    const message = buildMessage(unknownNonce)
    await expect(verifySiwe({ message, signature: '0xsig', nonceStore: store, expectedDomain: DOMAIN, expectedChainId: 100, verifier: okVerifier }))
      .rejects.toThrow(/nonce/i)
  })
})
