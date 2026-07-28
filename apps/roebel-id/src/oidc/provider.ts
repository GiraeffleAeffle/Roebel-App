import Provider, { type Adapter, type Configuration } from 'oidc-provider'
import type { Config } from '../config.js'
import type { RoebelClaims } from '../claims/types.js'
import { loadJwks } from './jwks.js'

export function buildProvider(deps: {
  config: Config
  adapterFactory: (name: string) => Adapter
  resolveClaims: (address: string) => Promise<RoebelClaims>
}): Provider {
  const { config, adapterFactory, resolveClaims } = deps
  const jwks = loadJwks()

  // Every first-party Röbel-run relying party. Nextcloud is always present;
  // Matrix (MAS) and the web app are added when configured. Adding a new
  // service is config-only.
  const relyingParties = [
    config.nextcloud,
    ...(config.matrix ? [config.matrix] : []),
    ...(config.web ? [config.web] : []),
  ]

  const configuration: Configuration = {
    adapter: adapterFactory,
    clients: relyingParties.map((rp) => ({
      client_id: rp.clientId,
      client_secret: rp.clientSecret,
      redirect_uris: rp.redirectUris,
      post_logout_redirect_uris: rp.postLogoutRedirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
    })),
    ...(jwks.keys.length ? { jwks } : {}),
    cookies: { keys: config.cookieKeys },
    pkce: { required: () => true },
    features: { devInteractions: { enabled: false } },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    ttl: { AuthorizationCode: 60, IdToken: 3600, AccessToken: 3600, Session: 1209600 },
    claims: {
      openid: ['sub'],
      email: ['email', 'email_verified'],
      profile: ['name', 'preferred_username', 'picture'],
      roebel: ['groups', 'roebel:citizen', 'roebel:attester', 'roebel:tier', 'roebel:actor_type'],
    },
    scopes: ['openid', 'email', 'profile', 'roebel'],
    async findAccount(_ctx, id) {
      const claims = await resolveClaims(id)
      return { accountId: id, claims: async () => ({ ...claims, sub: id }) }
    },
  }

  const provider = new Provider(config.issuer, configuration)
  provider.proxy = true // behind Fly's TLS terminator
  return provider
}
