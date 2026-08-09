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
    // Every first-party relying party comes straight from config.relyingParties (Nextcloud
    // always present; Matrix, the web app, Ortis, and any FIRST_PARTY_RPS extras only when
    // configured — see src/config.ts). Adding a new service is config-only.
    clients: config.relyingParties.map((rp) => ({
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
    /**
     * Put the scoped claims — `groups` above all — into the ID Token.
     *
     * panva defaults this to true, which means that once an access token is
     * issued (the authorization-code flow always issues one) the ID Token
     * carries only `sub` and everything else must be fetched from userinfo.
     * `groups` is the ACL every relying party here gates on, so that default
     * cost a verified citizen access to their own files: login succeeded, the
     * claim never arrived, and the workspace refused them.
     *
     * Relying parties may still call userinfo; this only makes the ID Token
     * self-sufficient, which is what our own consumers expect.
     */
    conformIdTokenClaims: false,
    async findAccount(_ctx, id) {
      const claims = await resolveClaims(id)
      return { accountId: id, claims: async () => ({ ...claims, sub: id }) }
    },
  }

  const provider = new Provider(config.issuer, configuration)
  provider.proxy = true // behind Fly's TLS terminator
  return provider
}
