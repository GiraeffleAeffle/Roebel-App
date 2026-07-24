import type { Adapter, AdapterPayload } from 'oidc-provider'

export interface SupabaseLike { from(table: string): any }

const TABLE = 'oidc_payloads'

export function makeSupabaseAdapterFactory(deps: { client: SupabaseLike }): (name: string) => Adapter {
  const { client } = deps
  return (name: string): Adapter => ({
    async upsert(id, payload, expiresIn) {
      const row = {
        id, type: name, payload,
        grant_id: (payload as AdapterPayload).grantId ?? null,
        user_code: (payload as AdapterPayload).userCode ?? null,
        uid: (payload as AdapterPayload).uid ?? null,
        expires_at: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : null,
      }
      const { error } = await client.from(TABLE).upsert(row)
      if (error) throw error
    },
    async find(id) {
      const { data } = await client.from(TABLE).select('payload').eq('type', name).eq('id', id).maybeSingle()
      return data ? (data.payload as AdapterPayload) : undefined
    },
    async findByUid(uid) {
      const { data } = await client.from(TABLE).select('payload').eq('uid', uid).maybeSingle()
      return data ? (data.payload as AdapterPayload) : undefined
    },
    async findByUserCode(userCode) {
      const { data } = await client.from(TABLE).select('payload').eq('user_code', userCode).maybeSingle()
      return data ? (data.payload as AdapterPayload) : undefined
    },
    async consume(id) {
      const { data } = await client.from(TABLE).select('payload').eq('type', name).eq('id', id).maybeSingle()
      if (!data) return
      const payload = { ...data.payload, consumed: Math.floor(Date.now() / 1000) }
      await client.from(TABLE).upsert({ id, type: name, payload, grant_id: payload.grantId ?? null, user_code: payload.userCode ?? null, uid: payload.uid ?? null, expires_at: null })
    },
    async destroy(id) { await client.from(TABLE).delete().eq('type', name).eq('id', id) },
    async revokeByGrantId(grantId) { await client.from(TABLE).delete().eq('grant_id', grantId) },
  })
}
