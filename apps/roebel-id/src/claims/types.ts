export interface NetizenClaims {
  sub: string
  email?: string
  email_verified?: boolean
  name?: string
  preferred_username?: string
  picture?: string
  groups: string[]
  'netizen:citizen': boolean
  'netizen:attester': boolean
  'netizen:tier'?: string
  // Agent-ready on-ramp (spec §10): reserves the seam for AI-agent principals.
  // Phase A issues human principals only; the field exists so agents slot in with no
  // schema migration. Minting `agent` is Phase C's job.
  'netizen:actor_type'?: 'human' | 'agent'
}

export type ProfileReader = (address: string) => Promise<{ email?: string; name?: string; picture?: string; tier?: string } | null>
export type OrgReader = (address: string) => Promise<Array<{ accountId: string; role: string }>>
export type ChainStatusReader = (address: string) => Promise<{ citizen: boolean; attester: boolean }>
