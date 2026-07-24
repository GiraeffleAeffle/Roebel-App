import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadJwks } from '../src/oidc/jwks.js'

describe('loadJwks', () => {
  const originalJwksJson = process.env.JWKS_JSON
  const originalNodeEnv = process.env.NODE_ENV

  beforeEach(() => {
    delete process.env.JWKS_JSON
    delete process.env.NODE_ENV
  })

  afterEach(() => {
    if (originalJwksJson === undefined) delete process.env.JWKS_JSON
    else process.env.JWKS_JSON = originalJwksJson
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = originalNodeEnv
  })

  it('throws when JWKS_JSON is unset', () => {
    expect(() => loadJwks()).toThrow('Missing JWKS_JSON')
  })

  it('throws when JWKS_JSON has zero keys and NODE_ENV is production', () => {
    process.env.JWKS_JSON = JSON.stringify({ keys: [] })
    process.env.NODE_ENV = 'production'
    expect(() => loadJwks()).toThrow('JWKS_JSON must contain at least one signing key in production')
  })

  it('does not throw for a non-empty key set regardless of NODE_ENV, and does not throw for an empty key set outside production', () => {
    process.env.JWKS_JSON = JSON.stringify({ keys: [{ kty: 'RSA', kid: 'test' }] })
    process.env.NODE_ENV = 'production'
    expect(loadJwks()).toEqual({ keys: [{ kty: 'RSA', kid: 'test' }] })

    process.env.JWKS_JSON = JSON.stringify({ keys: [] })
    process.env.NODE_ENV = 'development'
    expect(loadJwks()).toEqual({ keys: [] })

    delete process.env.NODE_ENV
    expect(loadJwks()).toEqual({ keys: [] })
  })
})
