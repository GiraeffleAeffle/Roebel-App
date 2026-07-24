import express from 'express'
import type Provider from 'oidc-provider'

export function createApp(deps?: { provider?: Provider }): express.Express {
  const app = express()
  app.get('/healthz', (_req, res) => { res.json({ status: 'ok' }) })
  // The OIDC provider is mounted at root: in production the issuer is the public
  // origin (e.g. https://id.roebel.app) and panva's routes (/auth, /token, /.well-known/...)
  // must live directly under it for exact issuer/redirect-URI matching.
  if (deps?.provider) {
    app.use(deps.provider.callback())
  }
  return app
}
