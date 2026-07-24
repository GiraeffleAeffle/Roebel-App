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
      const { data } = await supabase.from('users')
        .select('email, display_name, avatar_url, tier').eq('wallet_address', address).maybeSingle()
      if (!data) return null
      return { email: data.email ?? undefined, name: data.display_name ?? undefined, picture: data.avatar_url ?? undefined, tier: data.tier ?? undefined }
    },
    orgs: async (address) => {
      const { data } = await supabase.from('account_owners').select('account_id, role').eq('wallet_address', address)
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
