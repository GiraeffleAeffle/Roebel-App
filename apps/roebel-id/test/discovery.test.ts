import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { buildProvider } from '../src/oidc/provider.js'
import { makeSupabaseAdapterFactory } from '../src/store/supabase-adapter.js'

const config: any = {
  issuer: 'http://localhost:3010', cookieKeys: ['k1'], chainId: 100,
  relyingParties: [
    { name: 'nextcloud', clientId: 'nextcloud', clientSecret: 'secret', redirectUris: ['http://localhost:8080/apps/user_oidc/code'], postLogoutRedirectUris: [] },
  ],
}
process.env.JWKS_JSON = JSON.stringify({ keys: [] }) // provider generates dev keys when empty in test

function memClient() { const rows: any[] = []; return { from() { const s: any = {}; const api: any = { upsert(r: any){rows.push(r);return Promise.resolve({error:null})}, select(){return api}, eq(k: string,v: any){s[k]=v;return api}, maybeSingle(){return Promise.resolve({data:null,error:null})}, delete(){return api}, then(res: any){return Promise.resolve({error:null}).then(res)} }; return api } } }

describe('discovery', () => {
  it('serves openid-configuration with the issuer', async () => {
    const provider = buildProvider({
      config,
      adapterFactory: makeSupabaseAdapterFactory({ client: memClient() as any }),
      resolveClaims: async (a) => ({ sub: a, groups: [], 'netizen:citizen': false, 'netizen:attester': false }),
    })
    const app = (await import('express')).default()
    app.use('/oidc', provider.callback())
    const res = await request(app).get('/oidc/.well-known/openid-configuration')
    expect(res.status).toBe(200)
    expect(res.body.issuer).toBe('http://localhost:3010')
    expect(res.body.authorization_endpoint).toContain('/auth')
  })

  it('advertises the netizen scope and keeps roebel as a working alias', async () => {
    const provider = buildProvider({
      config,
      adapterFactory: makeSupabaseAdapterFactory({ client: memClient() as any }),
      resolveClaims: async (a) => ({ sub: a, groups: [], 'netizen:citizen': false, 'netizen:attester': false }),
    })
    const app = (await import('express')).default()
    app.use('/oidc', provider.callback())
    const res = await request(app).get('/oidc/.well-known/openid-configuration')
    const doc = res.body as { scopes_supported: string[]; claims_supported: string[] }

    expect(doc.scopes_supported).toContain('netizen')
    // Nextcloud and Matrix request `roebel` from node-side config we cannot edit here.
    // Removing it stops `groups` being issued and locks citizens out of their own files.
    expect(doc.scopes_supported).toContain('roebel')

    expect(doc.claims_supported).toContain('netizen:citizen')
    expect(doc.claims_supported).toContain('groups')
    expect(doc.claims_supported).not.toContain('roebel:citizen')
  })
})
