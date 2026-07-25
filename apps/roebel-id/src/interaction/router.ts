import express from 'express'
import type Provider from 'oidc-provider'
import type { AuthBridge } from '../auth-bridge/types.js'
import { renderLoginPage } from './login-page.js'

export function createInteractionRouter(deps: {
  provider: Provider; bridge: AuthBridge; thirdwebClientId: string; chainId: number
}): express.Router {
  const router = express.Router()
  const { provider, bridge } = deps

  router.get('/interaction/:uid', async (req, res, next) => {
    try {
      const details = await provider.interactionDetails(req, res)
      if (details.prompt.name !== 'login' && details.prompt.name !== 'consent') return next()
      res.set('cache-control', 'no-store').send(renderLoginPage(details.uid, deps.thirdwebClientId, deps.chainId))
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
    } catch (e: any) {
      res.status(401).json({ error: e.message })
    }
  })

  return router
}
