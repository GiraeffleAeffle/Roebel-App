import { createHash } from 'node:crypto'
import type { NetizenClaims, ProfileReader, OrgReader, ChainStatusReader } from './types.js'

/**
 * A stable, pseudonymous handle for a member.
 *
 * Relying parties use this as the account localpart. It must NEVER be the wallet
 * address: a Matrix ID is immutable, public in every room, and federates, so an
 * address-derived MXID would permanently tie a citizen's chat activity to their
 * onchain balances, votes and holdings. Prefer their chosen username; otherwise
 * a short digest of the address — stable across logins, but not reversible to it.
 */
export function memberHandle(address: string, username?: string): string {
  const slug = (username ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 32)
  if (slug.length >= 3) return slug
  return `r-${createHash('sha256').update(address.toLowerCase()).digest('hex').slice(0, 12)}`
}

export function createClaimsResolver(deps: {
  profile: ProfileReader; orgs: OrgReader; chain: ChainStatusReader
}): (address: string) => Promise<NetizenClaims> {
  return async (rawAddress: string): Promise<NetizenClaims> => {
    const sub = rawAddress.toLowerCase()
    const [profile, orgs, status] = await Promise.all([deps.profile(sub), deps.orgs(sub), deps.chain(sub)])

    const groups: string[] = []
    if (status.citizen) groups.push('citizen')
    if (status.attester) groups.push('attester')
    for (const o of orgs) groups.push(`org:${o.accountId}:${o.role}`)

    return {
      sub,
      email: profile?.email,
      email_verified: profile?.email ? true : undefined,
      name: profile?.name,
      preferred_username: memberHandle(sub, profile?.name),
      picture: profile?.picture,
      groups,
      'netizen:citizen': status.citizen,
      'netizen:attester': status.attester,
      'netizen:tier': profile?.tier,
      'netizen:actor_type': 'human', // Phase A issues human principals only (spec §5.2)
    }
  }
}
