import { describe, it, expect } from 'vitest'
import { makeSupabaseAdapterFactory } from '../src/store/supabase-adapter.js'

// Minimal in-memory fake of the supabase query surface the adapter uses.
function fakeClient() {
  const rows: any[] = []
  return {
    _rows: rows,
    from() {
      const state: any = { filters: {} }
      const api: any = {
        upsert(r: any) { const i = rows.findIndex((x) => x.type === r.type && x.id === r.id); if (i >= 0) rows[i] = r; else rows.push(r); return Promise.resolve({ error: null }) },
        select() { return api },
        eq(k: string, v: any) { state.filters[k] = v; return api },
        maybeSingle() { return Promise.resolve({ data: rows.find((x) => Object.entries(state.filters).every(([k, v]) => x[k] === v)) ?? null, error: null }) },
        delete() { state.del = true; return api },
        then(res: any) { // delete(): apply filters
          const matched = rows.filter((x) => Object.entries(state.filters).every(([k, v]) => x[k] === v))
          for (const m of matched) rows.splice(rows.indexOf(m), 1)
          return Promise.resolve({ error: null }).then(res)
        },
      }
      return api
    },
  }
}

describe('supabase oidc adapter', () => {
  it('upserts and finds by id', async () => {
    const factory = makeSupabaseAdapterFactory({ client: fakeClient() as any })
    const adapter = factory('AccessToken')
    await adapter.upsert('abc', { accountId: '0xabc', scope: 'openid' }, 3600)
    expect(await adapter.find('abc')).toMatchObject({ accountId: '0xabc' })
  })

  it('destroys a record', async () => {
    const factory = makeSupabaseAdapterFactory({ client: fakeClient() as any })
    const adapter = factory('Session')
    await adapter.upsert('s1', { foo: 1 }, 3600)
    await adapter.destroy('s1')
    expect(await adapter.find('s1')).toBeUndefined()
  })

  it('marks a record consumed', async () => {
    const factory = makeSupabaseAdapterFactory({ client: fakeClient() as any })
    const adapter = factory('AuthorizationCode')
    await adapter.upsert('c1', { accountId: '0xabc' }, 60)
    await adapter.consume('c1')
    expect((await adapter.find('c1'))?.consumed).toBeTypeOf('number')
  })
})
