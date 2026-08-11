import { errors, type Configuration } from 'oidc-provider'
import type { Config } from '../config.js'

/**
 * The identity class every human login gets in Phase A. The signer's policy engine reads it
 * (`packages/signer/src/auth.ts`) and understands `citizen` | `agent` | `org`; only `citizen`
 * is minted here. Agent principals are Phase C — plumbed, deliberately not issued.
 */
export const NETIZEN_IDENTITY_CLASS = 'citizen'

/** Access-token lifetime, matching the provider's existing AccessToken ttl. */
export const NETIZEN_ACCESS_TOKEN_TTL = 3600

/**
 * Strip trailing slashes so `https://signer.roebel.app` and `https://signer.roebel.app/`
 * compare equal. Mirrors how the signer service normalizes its own issuer
 * (`opts.issuer.replace(/\/+$/, "")`) — the two sides of this handshake must agree on what
 * "the same resource" means.
 */
function stripTrailingSlashes(url: string): string {
  return url.replace(/\/+$/, '')
}

/**
 * Resource-indicator policy: this keystone mints access tokens for exactly ONE resource, the
 * node's signer.
 *
 * An allowlist rather than a wildcard on purpose. `getResourceServerInfo` is what decides
 * which `aud` a token carries, so accepting any indicator would let a first-party client mint
 * a token audienced at a service of its choosing — and the signer's whole authorization story
 * is that it only honours tokens audienced at itself.
 *
 * Returns `undefined` when no signer resource is configured, which leaves the feature off.
 */
export function buildResourceIndicators(
  config: Config,
): NonNullable<NonNullable<Configuration['features']>['resourceIndicators']> | undefined {
  const configured = config.signerResourceUrl
  if (!configured) return undefined

  // Canonical form of the configured resource. This — never the client's raw string — is what
  // gets returned as `aud`, so the claim is stable regardless of how the client spelled the
  // indicator (trailing slash or not).
  const canonicalResource = stripTrailingSlashes(configured)

  return {
    enabled: true,
    // Clients that ask for no resource still get the signer token; there is only one.
    defaultResource: () => canonicalResource,
    useGrantedResource: () => true,
    // Async so a rejection (an indicator outside the allowlist) surfaces as a rejected
    // promise rather than a synchronous throw — oidc-provider awaits this either way
    // (CanBePromise<ResourceServer>), but callers that check for a rejection depend on it.
    getResourceServerInfo: async (_ctx, resourceIndicator) => {
      if (stripTrailingSlashes(resourceIndicator) !== canonicalResource) {
        throw new errors.InvalidTarget(`unknown resource indicator: ${resourceIndicator}`)
      }
      return {
        scope: 'netizen',
        audience: canonicalResource,
        accessTokenTTL: NETIZEN_ACCESS_TOKEN_TTL,
        accessTokenFormat: 'jwt',
      }
    },
  }
}

/**
 * Claims the signer reads off a verified access token.
 *
 * `netizen_step_up` is emitted as an explicit `false` rather than omitted. The signer treats a
 * missing claim as not-stepped-up today, but an absent field is a fact nobody stated — and the
 * step-up flow that will one day set it true (Phase C) must find the field already on the wire,
 * not introduce it.
 *
 * ID tokens are untouched: they describe a login, not an authorization to act.
 */
export function buildExtraTokenClaims(): NonNullable<Configuration['extraTokenClaims']> {
  return (_ctx, token) => {
    if (token.kind !== 'AccessToken') return undefined
    return { netizen_class: NETIZEN_IDENTITY_CLASS, netizen_step_up: false }
  }
}
