// JWKS is provided via env as a JSON JWK Set (generate with the panva jose CLI or a one-off script).
// Rotation = prepend a new key to `keys` and redeploy; old key stays until tokens signed with it expire.
export function loadJwks(): { keys: object[] } {
  const raw = process.env.JWKS_JSON
  if (!raw) throw new Error('Missing JWKS_JSON')
  const jwks = JSON.parse(raw)
  // An empty key set is only safe outside production: panva falls back to ephemeral dev
  // signing keys, which regenerate on every restart and would silently invalidate every
  // previously-issued token and destabilize the JWKS endpoint in a real deployment.
  if (jwks.keys.length === 0 && process.env.NODE_ENV === 'production') {
    throw new Error('JWKS_JSON must contain at least one signing key in production')
  }
  return jwks
}
