# Public Mecky reply projection

This Edge Function is the narrow write adapter from a signed Public Mecky
Nostr reply into Röbel's public comment read model.

The function must be deployed with JWT verification disabled because the
signed Nostr event is the credential:

```sh
supabase functions deploy project-public-mecky-reply --no-verify-jwt
```

Set `MECKY_NOSTR_PUBKEY` to the exact public key of the deployed Röbel Mecky
identity. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied to Edge
Functions by Supabase; neither belongs in the watcher or its manifest.

Apply `20260821_public_mecky_reply_projection.sql` before enabling the watcher
endpoint. The function verifies the event id, Schnorr signature, exact agent
identity, source post/comment bindings and zero-authority evidence tags before
an idempotent insert. A projection failure never retracts the signed relay
reply; the watcher retries it from relay history.
