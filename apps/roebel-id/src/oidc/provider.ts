import Provider, { type Adapter, type Configuration } from 'oidc-provider'
import type { Config } from '../config.js'
import type { NetizenClaims } from '../claims/types.js'
import { loadJwks } from './jwks.js'

/** The claims both the `netizen` scope and its deprecated `roebel` alias resolve to.
 *  One constant so the two can never drift apart.
 *  (Typed `string[]`, not `as const`, because oidc-provider's `Configuration['claims']`
 *  values are `string[]`, not `readonly string[]` — a readonly tuple fails TS4104 here.) */
const NETIZEN_SCOPE_CLAIMS: string[] = [
  'groups',
  'netizen:citizen',
  'netizen:attester',
  'netizen:tier',
  'netizen:actor_type',
]

export function buildProvider(deps: {
  config: Config
  adapterFactory: (name: string) => Adapter
  resolveClaims: (address: string) => Promise<NetizenClaims>
}): Provider {
  const { config, adapterFactory, resolveClaims } = deps
  const jwks = loadJwks()

  const configuration: Configuration = {
    adapter: adapterFactory,
    // Every first-party relying party comes straight from config.relyingParties (Nextcloud,
    // Matrix, the web app, Ortis, and any FIRST_PARTY_RPS extras all optional, resolved
    // per-instance — see src/config.ts; loadConfig() throws at boot if none resolve). Adding
    // a new service, or standing up a second issuer with a different RP subset (e.g.
    // ortis-id — see README "Running a second instance for another community"), is
    // config-only.
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
      netizen: NETIZEN_SCOPE_CLAIMS,
      // DEPRECATED ALIAS. Resolves to exactly the same claims as `netizen`.
      // Nextcloud (cloud.roebel.app) and Matrix (auth.roebel.app) request this scope from
      // configs that live on the node, outside this repo, and `groups` — the ACL every
      // relying party gates on — rides on it. Dropping it here silently stops `groups`
      // being issued: login succeeds, the claim never arrives, the workspace refuses the
      // user. That exact failure has happened once already (see conformIdTokenClaims below).
      // REMOVE ONLY once both RP configs request `netizen` instead.
      roebel: NETIZEN_SCOPE_CLAIMS,
    },
    scopes: ['openid', 'email', 'profile', 'netizen', 'roebel'],
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
