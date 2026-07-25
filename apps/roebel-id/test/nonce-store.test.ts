import { describe, it, expect, afterEach, vi } from 'vitest'
import { createMemoryNonceStore } from '../src/auth-bridge/nonce-store.js'

// `GET /interaction/:uid/nonce` is unauthenticated, so a caller can loop
// issue() forever. Without eviction, every expired-but-never-consumed nonce
// would sit in the store's internal map forever — an unbounded-memory DoS on
// the single Fly machine. issue() must sweep expired entries before adding a
// new one.
describe('createMemoryNonceStore eviction', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('evicts an expired-but-never-consumed nonce from the internal map on the next issue()', () => {
    vi.useFakeTimers()
    const ttlMs = 1000
    vi.setSystemTime(0)
    const store = createMemoryNonceStore(ttlMs)

    const firstNonce = store.issue() // expiry = t=1000, never consumed

    // Advance past the first nonce's expiry and issue a second nonce. This is
    // the moment issue() should sweep the map and drop the first nonce.
    vi.setSystemTime(1500)
    store.issue()

    // Roll the clock BACK to t=500 — a time at which the first nonce's
    // original expiry (1000) had not yet passed. If the sweep had merely
    // relied on consume()'s own expiry check (i.e. the entry were still
    // sitting in the map), consume() would find it and, since 500 <= 1000,
    // return true. It must return false here, which is only possible if the
    // entry itself was removed from the map by the sweep — proving eviction,
    // not just "naturally expired at consume time".
    vi.setSystemTime(500)
    expect(store.consume(firstNonce)).toBe(false)
  })

  it('still rejects a genuinely expired nonce even without a later issue() to trigger a sweep', () => {
    vi.useFakeTimers()
    const ttlMs = 1000
    vi.setSystemTime(0)
    const store = createMemoryNonceStore(ttlMs)

    const nonce = store.issue()
    vi.setSystemTime(2000) // past expiry; no second issue() call
    expect(store.consume(nonce)).toBe(false)
  })

  it('does not evict unexpired nonces when sweeping on issue()', () => {
    vi.useFakeTimers()
    const ttlMs = 1000
    vi.setSystemTime(0)
    const store = createMemoryNonceStore(ttlMs)

    const stillValidNonce = store.issue() // expiry = t=1000

    vi.setSystemTime(200)
    store.issue() // sweep runs, but stillValidNonce is not expired yet

    vi.setSystemTime(400)
    expect(store.consume(stillValidNonce)).toBe(true)
  })
})
