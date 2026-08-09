// Login-page branding presets (see src/interaction/login-page.ts for the copy/colors each
// preset renders). Pilot-critical: an Ortis client — a mayor of another municipality — must
// never resolve to the 'roebel' preset.
const BRANDING_PRESETS = ['roebel', 'ortis'] as const
export type BrandingPreset = (typeof BRANDING_PRESETS)[number]

export interface BrandingConfig {
  preset: BrandingPreset
  /** Optional free-text line rendered under the heading, e.g. an Amt/org name for the pilot. */
  context?: string
}

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
  branding: BrandingConfig
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

// Trim + drop-empty for every comma-separated env value below. Without the trim, a redirect
// URI list retyped as "https://a/cb, https://b/cb" (space after the comma — the natural way
// to type a prod+localhost pair, which the Ortis docs are the first example of) is accepted
// by oidc-provider verbatim and never matches a real request; the failure then surfaces at
// the authorize endpoint at demo time instead of at boot.
function csv(v: string): string[] {
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

// Per-prefix override for loadBranding's fallback below. Only Ortis needs one: it is the one
// known first-party RP that is NOT a Röbel-run service (a mayor of another municipality logs
// in through it), so — unlike Nextcloud/Matrix/Web — it must never silently inherit the
// generic 'roebel' default just because an operator set the three vars that make the OIDC
// client work (CLIENT_ID/_SECRET/_REDIRECT_URIS) and forgot the fourth.
const PREFIX_BRANDING_DEFAULT: Partial<Record<string, BrandingPreset>> = { ORTIS: 'ortis' }

/**
 * Load one RP's login-page branding: `<PREFIX>_BRANDING` selects the preset, defaulting to
 * `PREFIX_BRANDING_DEFAULT[prefix]` when set (currently just `ortis` for `ORTIS`) or `roebel`
 * otherwise, and `<PREFIX>_BRANDING_CONTEXT` is an optional free-text line (e.g. an Amt/org
 * name for the pilot). An unrecognized preset value throws loudly at boot — silently falling
 * back would risk an Ortis client rendering Röbel branding. The per-prefix default can still
 * be overridden explicitly (e.g. `ORTIS_BRANDING=roebel`) if that's ever truly wanted.
 */
function loadBranding(prefix: string): BrandingConfig {
  const preset = process.env[`${prefix}_BRANDING`] ?? PREFIX_BRANDING_DEFAULT[prefix] ?? 'roebel'
  if (!(BRANDING_PRESETS as readonly string[]).includes(preset)) {
    throw new Error(`Invalid ${prefix}_BRANDING: '${preset}' (expected one of ${BRANDING_PRESETS.join(', ')})`)
  }
  const context = process.env[`${prefix}_BRANDING_CONTEXT`]
  return context ? { preset: preset as BrandingPreset, context } : { preset: preset as BrandingPreset }
}

/**
 * Load one relying party from its env-var prefix: `<PREFIX>_CLIENT_ID`,
 * `<PREFIX>_CLIENT_SECRET`, `<PREFIX>_REDIRECT_URIS` (comma-separated),
 * `<PREFIX>_POST_LOGOUT_URIS` (comma-separated, optional), plus the branding subvars (see
 * `loadBranding`). Every required subvar throws loudly via `required()` if missing —
 * callers decide whether calling this at all is conditional (the known optional prefixes
 * below) or unconditional (Nextcloud, and anything listed in FIRST_PARTY_RPS).
 */
function loadRelyingParty(prefix: string): RelyingPartyConfig {
  return {
    name: prefix.toLowerCase(),
    clientId: required(`${prefix}_CLIENT_ID`),
    clientSecret: required(`${prefix}_CLIENT_SECRET`),
    redirectUris: csv(required(`${prefix}_REDIRECT_URIS`)),
    postLogoutRedirectUris: csv(process.env[`${prefix}_POST_LOGOUT_URIS`] ?? ''),
    branding: loadBranding(prefix),
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
  for (const prefix of csv(process.env.FIRST_PARTY_RPS ?? '')) {
    relyingParties.push(loadRelyingParty(prefix))
  }

  return {
    issuer: required('ISSUER_URL'),
    port: Number(process.env.PORT ?? 3010),
    cookieKeys: csv(required('COOKIE_KEYS')),
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
