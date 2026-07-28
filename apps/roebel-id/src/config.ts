/**
 * A first-party relying party (Röbel-run service) that logs in via Röbel ID.
 * All first-party RPs share the same trust level and get a pre-granted consent
 * (see the interaction router). Nextcloud is always present; others are optional.
 */
export interface RelyingPartyConfig {
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
  nextcloud: RelyingPartyConfig
  /** Matrix Authentication Service (MAS) upstream OIDC. Registered only when MATRIX_CLIENT_ID is set. */
  matrix?: RelyingPartyConfig
  /** The Röbel web app's own workspace session. Registered only when WEB_CLIENT_ID is set. */
  web?: RelyingPartyConfig
}

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env: ${name}`)
  return v
}

export function loadConfig(): Config {
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
    nextcloud: {
      clientId: required('NEXTCLOUD_CLIENT_ID'),
      clientSecret: required('NEXTCLOUD_CLIENT_SECRET'),
      redirectUris: required('NEXTCLOUD_REDIRECT_URIS').split(','),
      postLogoutRedirectUris: (process.env.NEXTCLOUD_POST_LOGOUT_URIS ?? '').split(',').filter(Boolean),
    },
    // Matrix is optional: registered only when MATRIX_CLIENT_ID is set, so the
    // keystone boots unchanged before Matrix/MAS is stood up.
    ...(process.env.MATRIX_CLIENT_ID
      ? {
          matrix: {
            clientId: required('MATRIX_CLIENT_ID'),
            clientSecret: required('MATRIX_CLIENT_SECRET'),
            redirectUris: required('MATRIX_REDIRECT_URIS').split(','),
            postLogoutRedirectUris: (process.env.MATRIX_POST_LOGOUT_URIS ?? '').split(',').filter(Boolean),
          },
        }
      : {}),
    // The web app is optional for the same reason Matrix is: the keystone must
    // boot unchanged on a node that has not stood up the workspace yet.
    ...(process.env.WEB_CLIENT_ID
      ? {
          web: {
            clientId: required('WEB_CLIENT_ID'),
            clientSecret: required('WEB_CLIENT_SECRET'),
            redirectUris: required('WEB_REDIRECT_URIS').split(','),
            postLogoutRedirectUris: (process.env.WEB_POST_LOGOUT_URIS ?? '').split(',').filter(Boolean),
          },
        }
      : {}),
  }
}
