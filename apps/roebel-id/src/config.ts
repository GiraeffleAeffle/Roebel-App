/**
 * A first-party relying party (a Röbel-run service, or a Netizen-run consumer like Ortis)
 * that logs in via Röbel ID. All first-party RPs share the same trust level and get a
 * pre-granted consent (see the interaction router). `name` is the lowercase env-var
 * prefix the RP was loaded from (e.g. `'nextcloud'`, `'ortis'`) — it doubles as a stable
 * key for consumers that need to single one out (see e.g. discovery/interaction tests).
 */
export interface RelyingPartyConfig {
  name: string
  clientId: string
  clientSecret: string
  redirectUris: string[]
  postLogoutRedirectUris: string[]
}

export interface Config {
  issuer: string
  port: number
  cookieKeys: string[]
  gnosisRpcUrl: string
  chainId: number
  citizenNftAddress: `0x${string}`
  attesterNftAddress: `0x${string}`
  supabaseUrl: string
  supabaseServiceKey: string
  thirdwebClientId: string
  /** Every first-party RP, Nextcloud first. Nextcloud is always present; the rest is
   * whatever the env resolved (the known optional prefixes, plus FIRST_PARTY_RPS extras). */
  relyingParties: RelyingPartyConfig[]
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env: ${name}`)
  return v
}

/**
 * Load one relying party from its env-var prefix: `<PREFIX>_CLIENT_ID`,
 * `<PREFIX>_CLIENT_SECRET`, `<PREFIX>_REDIRECT_URIS` (comma-separated),
 * `<PREFIX>_POST_LOGOUT_URIS` (comma-separated, optional). Every required subvar throws
 * loudly via `required()` if missing — callers decide whether calling this at all is
 * conditional (the known optional prefixes below) or unconditional (Nextcloud, and
 * anything listed in FIRST_PARTY_RPS).
 */
function loadRelyingParty(prefix: string): RelyingPartyConfig {
  return {
    name: prefix.toLowerCase(),
    clientId: required(`${prefix}_CLIENT_ID`),
    clientSecret: required(`${prefix}_CLIENT_SECRET`),
    redirectUris: required(`${prefix}_REDIRECT_URIS`).split(','),
    postLogoutRedirectUris: (process.env[`${prefix}_POST_LOGOUT_URIS`] ?? '').split(',').filter(Boolean),
  }
}

// Known first-party RPs beyond Nextcloud (always required): each is registered only when
// its <PREFIX>_CLIENT_ID is set, so the keystone boots unchanged on a node that hasn't
// stood up that service yet. Order here becomes client-list order.
const OPTIONAL_FIRST_PARTY_PREFIXES = ['MATRIX', 'WEB', 'ORTIS']

export function loadConfig(): Config {
  const relyingParties: RelyingPartyConfig[] = [loadRelyingParty('NEXTCLOUD')]

  for (const prefix of OPTIONAL_FIRST_PARTY_PREFIXES) {
    if (process.env[`${prefix}_CLIENT_ID`]) relyingParties.push(loadRelyingParty(prefix))
  }

  // Additional first-party RPs beyond the known set above (e.g. FIRST_PARTY_RPS=BUZZ for a
  // future service). Unlike the optional known prefixes, listing a prefix here opts it in
  // unconditionally — every subvar is required to resolve.
  for (const prefix of (process.env.FIRST_PARTY_RPS ?? '').split(',').filter(Boolean)) {
    relyingParties.push(loadRelyingParty(prefix))
  }

  return {
    issuer: required('ISSUER_URL'),
    port: Number(process.env.PORT ?? 3010),
    cookieKeys: required('COOKIE_KEYS').split(','),
    gnosisRpcUrl: required('GNOSIS_RPC_URL'),
    chainId: Number(process.env.CHAIN_ID ?? 100),
    citizenNftAddress: required('CITIZEN_NFT_ADDRESS') as `0x${string}`,
    attesterNftAddress: required('ATTESTER_NFT_ADDRESS') as `0x${string}`,
    supabaseUrl: required('SUPABASE_URL'),
    supabaseServiceKey: required('SUPABASE_SERVICE_KEY'),
    thirdwebClientId: required('THIRDWEB_CLIENT_ID'),
    relyingParties,
  }
}
