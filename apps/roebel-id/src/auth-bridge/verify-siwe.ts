import { SiweMessage } from 'siwe'
import type { NonceStore } from './nonce-store.js'
import type { SignatureVerifier } from '../lib/gnosis.js'

export class SiweError extends Error {}

export async function verifySiwe(input: {
  message: string
  signature: string
  nonceStore: NonceStore
  expectedDomain: string
  expectedChainId: number
  verifier: SignatureVerifier
}): Promise<{ address: string }> {
  let parsed: SiweMessage
  try { parsed = new SiweMessage(input.message) } catch { throw new SiweError('malformed SIWE message') }

  if (parsed.domain !== input.expectedDomain) throw new SiweError('domain mismatch')
  if (parsed.chainId !== input.expectedChainId) throw new SiweError(`unexpected chain ${parsed.chainId}`)
  if (parsed.expirationTime && new Date(parsed.expirationTime).getTime() < Date.now()) throw new SiweError('message expired')
  if (!parsed.nonce || !input.nonceStore.consume(parsed.nonce)) throw new SiweError('invalid or reused nonce')

  const ok = await input.verifier({
    address: parsed.address as `0x${string}`,
    message: input.message,
    signature: input.signature as `0x${string}`,
  })
  if (!ok) throw new SiweError('signature verification failed')

  return { address: parsed.address.toLowerCase() }
}
