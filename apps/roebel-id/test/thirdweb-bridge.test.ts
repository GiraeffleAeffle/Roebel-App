import { describe, it, expect } from 'vitest'
import { SiweMessage } from 'siwe'
import { createMemoryNonceStore } from '../src/auth-bridge/nonce-store.js'
import { createThirdwebAuthBridge } from '../src/auth-bridge/thirdweb-bridge.js'

const config = { issuer: 'https://id.roebel.app', chainId: 100 } as any
const ADDR = '0x2222222222222222222222222222222222222222'

describe('ThirdwebAuthBridge', () => {
  it('issues a nonce and verifies a login signed with it', async () => {
    const bridge = createThirdwebAuthBridge({ config, nonceStore: createMemoryNonceStore(), verifier: async () => true })
    const nonce = bridge.issueNonce()
    const message = new SiweMessage({
      domain: 'id.roebel.app', address: ADDR, uri: config.issuer, version: '1', chainId: 100, nonce,
      expirationTime: new Date(Date.now() + 60_000).toISOString(),
    }).prepareMessage()
    const res = await bridge.verifyLogin({ message, signature: '0xsig' })
    expect(res.address).toBe(ADDR.toLowerCase())
  })

  it('rejects a login whose nonce it never issued', async () => {
    const bridge = createThirdwebAuthBridge({ config, nonceStore: createMemoryNonceStore(), verifier: async () => true })
    const message = new SiweMessage({
      domain: 'id.roebel.app', address: ADDR, uri: config.issuer, version: '1', chainId: 100, nonce: 'deadbeefdeadbeef',
      expirationTime: new Date(Date.now() + 60_000).toISOString(),
    }).prepareMessage()
    await expect(bridge.verifyLogin({ message, signature: '0xsig' })).rejects.toThrow(/nonce/i)
  })
})
