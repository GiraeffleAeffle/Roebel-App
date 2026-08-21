import express from 'express'
import type Provider from 'oidc-provider'
import type { Config } from './config.js'
import { brandingDocument } from './interaction/branding-document.js'

export function createApp(deps?: {
  provider?: Provider
  interactionRouter?: express.Router
  relyingParties?: Config['relyingParties']
}): express.Express {
  const app = express()
  app.get('/healthz', (_req, res) => { res.json({ status: 'ok' }) })
  // The interaction router owns /interaction/* and must be mounted BEFORE provider.callback()
  // so panva's catch-all OIDC routes never shadow it.
  if (deps?.interactionRouter) {
    app.use(deps.interactionRouter)
  }
  // Public branding document (spec §5.5). Read by a future account-creation modal so it can
  // render a community's look without baking it in. Unauthenticated and cacheable: it is the
  // same information the login page already serves as HTML to anyone who asks. Mounted before
  // provider.callback() for the same reason as the interaction router above — panva's catch-all
  // routes must not shadow it.
  const relyingParties = deps?.relyingParties ?? []
  app.get('/.well-known/netizen-branding', (req, res) => {
    const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : ''
    const rp = relyingParties.find((r) => r.clientId === clientId)
    if (!rp) {
      res.status(404).json({ error: 'unknown client_id' })
      return
    }
    res.set('Cache-Control', 'public, max-age=300')
    res.json(brandingDocument(rp.branding.preset, rp.branding.context))
  })
  // The OIDC provider is mounted at root: in production the issuer is the public
  // origin (e.g. https://id.roebel.app) and panva's routes (/auth, /token, /.well-known/...)
  // must live directly under it for exact issuer/redirect-URI matching.
  if (deps?.provider) {
    app.use(deps.provider.callback())
  }
  return app
}
