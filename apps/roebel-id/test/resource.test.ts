import { describe, it, expect } from 'vitest'
import { buildResourceIndicators, buildExtraTokenClaims } from '../src/oidc/resource.js'
import type { Config } from '../src/config.js'

const config = { signerResourceUrl: 'https://signer.roebel.app' } as Config

describe('buildResourceIndicators', () => {
  it('is undefined when no signer resource is configured', () => {
    expect(buildResourceIndicators({} as Config)).toBeUndefined()
  })

  it('returns a jwt resource server for the allowlisted indicator', async () => {
    const ri = buildResourceIndicators(config)!
    const info = await ri.getResourceServerInfo!({} as never, 'https://signer.roebel.app', {} as never)
    expect(info.audience).toBe('https://signer.roebel.app')
    expect(info.accessTokenFormat).toBe('jwt')
    expect(info.scope).toBe('netizen')
  })

  it('rejects any indicator that is not the configured signer', async () => {
    // Without this, a first-party client could mint a token audienced at an arbitrary
    // service and the signer's audience check would be worthless.
    const ri = buildResourceIndicators(config)!
    await expect(
      ri.getResourceServerInfo!({} as never, 'https://evil.example/api', {} as never),
    ).rejects.toThrow()
  })

  it('treats a trailing-slash variant of the configured resource as the same resource', async () => {
    // The signer normalizes its own issuer the same way (opts.issuer.replace(/\/+$/, "")),
    // so a client that spells the indicator with a trailing slash must still match — and the
    // audience returned must always be the canonical (stripped) configured value, not the
    // client's raw string, so `aud` stays stable regardless of how the client spelled it.
    const ri = buildResourceIndicators(config)!
    const info = await ri.getResourceServerInfo!({} as never, 'https://signer.roebel.app/', {} as never)
    expect(info.audience).toBe('https://signer.roebel.app')
  })
})

describe('buildExtraTokenClaims', () => {
  it('adds netizen_class and an explicit false step-up to access tokens', async () => {
    const claims = await buildExtraTokenClaims()({} as never, { kind: 'AccessToken' } as never)
    expect(claims).toEqual({ netizen_class: 'citizen', netizen_step_up: false })
  })

  it('adds nothing to client-credentials tokens', async () => {
    const claims = await buildExtraTokenClaims()({} as never, { kind: 'ClientCredentials' } as never)
    expect(claims).toBeUndefined()
  })
})
