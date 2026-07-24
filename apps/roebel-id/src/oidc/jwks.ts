// JWKS is provided via env as a JSON JWK Set (generate with the panva jose CLI or a one-off script).
// Rotation = prepend a new key to `keys` and redeploy; old key stays until tokens signed with it expire.
export function loadJwks(): { keys: object[] } {
  const raw = process.env.JWKS_JSON
  if (!raw) throw new Error('Missing JWKS_JSON')
  return JSON.parse(raw)
}
