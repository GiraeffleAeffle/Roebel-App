import { generateNonce } from 'siwe'

export interface NonceStore { issue(): string; consume(nonce: string): boolean }

export function createMemoryNonceStore(ttlMs = 5 * 60 * 1000): NonceStore {
  const issued = new Map<string, number>()
  return {
    issue() {
      // Sweep expired-but-never-consumed nonces before adding a new one, so an
      // unauthenticated caller looping GET /interaction/:uid/nonce can't grow
      // this map without bound (memory-leak/DoS hardening).
      const now = Date.now()
      for (const [existingNonce, expiry] of issued) {
        if (expiry < now) issued.delete(existingNonce)
      }
      const nonce = generateNonce()
      issued.set(nonce, now + ttlMs)
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
