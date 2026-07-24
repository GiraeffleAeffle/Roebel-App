import express from 'express'

export function createApp(): express.Express {
  const app = express()
  app.get('/healthz', (_req, res) => { res.json({ status: 'ok' }) })
  return app
}
