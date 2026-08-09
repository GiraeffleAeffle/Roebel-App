import express from 'express'
import type Provider from 'oidc-provider'
import type { AuthBridge } from '../auth-bridge/types.js'
import type { BrandingConfig, RelyingPartyConfig } from '../config.js'
import { renderLoginPage } from './login-page.js'

// Fallback for a client_id the router can't resolve to a configured RP — shouldn't happen for
// a first-party-only IdP (every registered OIDC client comes straight from relyingParties), but
// falling back to an unbranded/blank page would be worse than defaulting to Röbel branding.
const FALLBACK_BRANDING: BrandingConfig = { preset: 'roebel' }

export function createInteractionRouter(deps: {
  provider: Provider; bridge: AuthBridge; thirdwebClientId: string; chainId: number; relyingParties: RelyingPartyConfig[]
}): express.Router {
  const router = express.Router()
  const { provider, bridge, relyingParties } = deps
  const brandingByClientId = new Map(relyingParties.map((rp) => [rp.clientId, rp.branding]))
  const firstPartyClientIds = new Set(relyingParties.map((rp) => rp.clientId))

  router.get('/interaction/:uid', async (req, res, next) => {
    try {
      const details = await provider.interactionDetails(req, res)
      if (details.prompt.name !== 'login' && details.prompt.name !== 'consent') return next()
      // The requesting client determines branding (I2): an Ortis client must never render
      // Röbel copy/colors. Resolved by client_id since that's all the pending interaction
      // carries at this point — no session/account yet.
      const branding = brandingByClientId.get(String(details.params.client_id)) ?? FALLBACK_BRANDING
      res.set('cache-control', 'no-store').send(renderLoginPage(details.uid, deps.thirdwebClientId, deps.chainId, branding))
    } catch (e) { next(e) }
  })

  router.get('/interaction/:uid/nonce', (_req, res) => {
    res.set('cache-control', 'no-store').type('text/plain').send(bridge.issueNonce())
  })

  router.post('/interaction/:uid/login', express.json(), async (req, res) => {
    try {
      const { address } = await bridge.verifyLogin({ message: req.body.message, signature: req.body.signature })
      const details = await provider.interactionDetails(req, res)
      const { params } = details

      // Pre-granting consent (below) is only safe for first-party Röbel-run clients (Nextcloud,
      // Matrix/MAS, ...). Any client_id outside that trusted set must NOT silently receive an
      // auto-grant — fail closed rather than skip a consent screen that doesn't exist yet.
      // By construction this can't currently fire: firstPartyClientIds is built from the same
      // relyingParties array that populates the provider's client registry (see
      // buildProvider), and oidc-provider itself rejects an unknown client_id before an
      // Interaction is ever created — so a request never reaches here with a client_id outside
      // this set. The check stays as a deliberate fail-closed guard: it exists so that wiring a
      // non-first-party client in some future auth flow requires consciously decoupling the two
      // lists, rather than this guard silently no-oping because it was never able to catch that.
      if (!firstPartyClientIds.has(String(params.client_id))) {
        res.status(400).json({ error: 'unsupported_client' })
        return
      }

      // Röbel ID is a first-party IdP for Nextcloud (and future Röbel-run services) — there is
      // no third-party consent screen to show. Pre-grant the requested scope in the same
      // request that finishes login so oidc-provider's default `consent` prompt (which would
      // otherwise fire next, since this is the account's first grant) is already satisfied and
      // the interaction resolves in one round trip.
      const grant = new provider.Grant({ accountId: address, clientId: String(params.client_id) })
      if (typeof params.scope === 'string' && params.scope.length > 0) grant.addOIDCScope(params.scope)
      const grantId = await grant.save()

      const redirectTo = await provider.interactionResult(
        req,
        res,
        { login: { accountId: address }, consent: { grantId } },
        { mergeWithLastSubmission: false },
      )
      res.json({ redirectTo })
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      // eslint-disable-next-line no-console
      console.error('interaction login failed:', message)
      res.status(401).json({ error: 'authentication_failed' })
    }
  })

  return router
}
