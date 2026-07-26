import { describe, it, expect } from 'vitest'
import { createClaimsResolver } from '../src/claims/resolver.js'

const ADDR = '0x3333333333333333333333333333333333333333'

describe('claims resolver', () => {
  it('assembles sub, profile, chain status and org groups', async () => {
    const resolve = createClaimsResolver({
      profile: async () => ({ email: 'a@b.de', name: 'Anna', tier: 'citizen' }),
      orgs: async () => [{ accountId: 'org-1', role: 'admin' }],
      chain: async () => ({ citizen: true, attester: false }),
    })
    const claims = await resolve(ADDR)
    expect(claims.sub).toBe(ADDR.toLowerCase())
    expect(claims.email).toBe('a@b.de')
    expect(claims['roebel:citizen']).toBe(true)
    expect(claims['roebel:attester']).toBe(false)
    expect(claims.groups).toContain('citizen')
    expect(claims.groups).toContain('org:org-1:admin')
    expect(claims.groups).not.toContain('attester')
    expect(claims['roebel:actor_type']).toBe('human')
  })

  it('tolerates a missing profile row', async () => {
    const resolve = createClaimsResolver({
      profile: async () => null,
      orgs: async () => [],
      chain: async () => ({ citizen: false, attester: true }),
    })
    const claims = await resolve(ADDR)
    expect(claims.email).toBeUndefined()
    expect(claims.groups).toEqual(['attester'])
  })
})
