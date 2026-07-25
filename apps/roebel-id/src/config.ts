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
  nextcloud: { clientId: string; clientSecret: string; redirectUris: string[]; postLogoutRedirectUris: string[] }
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
  }
}
