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

  const configuration: Configuration = {
    adapter: adapterFactory,
    clients: [{
      client_id: config.nextcloud.clientId,
      client_secret: config.nextcloud.clientSecret,
      redirect_uris: config.nextcloud.redirectUris,
      post_logout_redirect_uris: config.nextcloud.postLogoutRedirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_basic',
    }],
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
      roebel: ['groups', 'roebel:citizen', 'roebel:attester', 'roebel:tier'],
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
