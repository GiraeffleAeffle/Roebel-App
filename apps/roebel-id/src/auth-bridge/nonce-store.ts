import { generateNonce } from 'siwe'

export interface NonceStore { issue(): string; consume(nonce: string): boolean }

export function createMemoryNonceStore(ttlMs = 5 * 60 * 1000): NonceStore {
  const issued = new Map<string, number>()
  return {
    issue() {
      const nonce = generateNonce()
      issued.set(nonce, Date.now() + ttlMs)
      return nonce
    },
    consume(nonce: string) {
      const expiry = issued.get(nonce)
      if (expiry === undefined) return false      // unknown or already used → reject (replay guard)
      issued.delete(nonce)                         // single use
      return Date.now() <= expiry
    },
  }
}
