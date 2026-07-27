import { createClient } from '@supabase/supabase-js'
import { createPublicClient, http, getContract } from 'viem'
import { gnosis } from 'viem/chains'
import type { Config } from '../config.js'
import type { ProfileReader, OrgReader, ChainStatusReader } from './types.js'

const balanceOfAbi = [{
  type: 'function', name: 'balanceOf', stateMutability: 'view',
  inputs: [{ name: 'owner', type: 'address' }], outputs: [{ name: '', type: 'uint256' }],
}] as const

export function createReaders(config: Config): { profile: ProfileReader; orgs: OrgReader; chain: ChainStatusReader } {
  const supabase = createClient(config.supabaseUrl, config.supabaseServiceKey)
  const client = createPublicClient({ chain: gnosis, transport: http(config.gnosisRpcUrl) })
  const citizen = getContract({ address: config.citizenNftAddress, abi: balanceOfAbi, client })
  const attester = getContract({ address: config.attesterNftAddress, abi: balanceOfAbi, client })

  return {
    profile: async (address) => {
      // users profile picture column is `profile_picture_url` (avatar_url lives on `accounts`).
      // Surface errors instead of swallowing them: a wrong column / RLS failure must not
      // masquerade as "no profile" and silently drop email/name from every token.
      const { data, error } = await supabase.from('users')
        .select('email, display_name, username, profile_picture_url, tier').eq('wallet_address', address).maybeSingle()
      if (error) { console.error('[claims] users read failed', error); throw error }
      if (!data) return null
      // display_name -> username, matching the app's own convention (see the
      // COALESCE in like_comment_invite_notifications.sql). Without the fallback a
      // citizen who set only a username gets NO name claim, and relying parties
      // fall back to the opaque `sub` — Nextcloud showed a 64-hex blob as the
      // display name. Never let a raw identifier stand in for a person's name.
      const name = [data.display_name, data.username]
        .map((v) => (typeof v === 'string' ? v.trim() : ''))
        .find((v) => v.length > 0)
      return { email: data.email ?? undefined, name, picture: data.profile_picture_url ?? undefined, tier: data.tier ?? undefined }
    },
    orgs: async (address) => {
      const { data, error } = await supabase.from('account_owners').select('account_id, role').eq('wallet_address', address)
      if (error) { console.error('[claims] account_owners read failed', error); throw error }
      return (data ?? []).map((r) => ({ accountId: r.account_id, role: r.role }))
    },
    chain: async (address) => {
      const [c, a] = await Promise.all([
        citizen.read.balanceOf([address as `0x${string}`]),
        attester.read.balanceOf([address as `0x${string}`]),
      ])
      return { citizen: c > 0n, attester: a > 0n }
    },
  }
}
