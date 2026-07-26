import type { RoebelClaims, ProfileReader, OrgReader, ChainStatusReader } from './types.js'

export function createClaimsResolver(deps: {
  profile: ProfileReader; orgs: OrgReader; chain: ChainStatusReader
}): (address: string) => Promise<RoebelClaims> {
  return async (rawAddress: string): Promise<RoebelClaims> => {
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
      preferred_username: profile?.name,
      picture: profile?.picture,
      groups,
      'roebel:citizen': status.citizen,
      'roebel:attester': status.attester,
      'roebel:tier': profile?.tier,
      'roebel:actor_type': 'human', // v1 issues human principals only; agents reserved (spec §10)
    }
  }
}
