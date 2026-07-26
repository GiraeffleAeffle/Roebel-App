// Minimal, dependency-free login page served straight from the OIDC service. It loads
// thirdweb + siwe from esm.sh in the browser (no bundler in this tiny service), connects the
// visitor's in-app wallet, signs a SIWE message, and posts the result back to this uid's
// `/login` endpoint. The visible copy may use German umlauts; the signed SIWE `statement`
// MUST stay ASCII-only — siwe@3.0.0 enforces the EIP-4361 ABNF and rejects non-ASCII bytes
// there (this bit us during Task 7 development with "Anmeldung bei Röbel ID").
const SIWE_STATEMENT = 'Anmeldung bei Roebel ID'

export function renderLoginPage(uid: string, thirdwebClientId: string, chainId: number): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Bei Röbel anmelden</title>
<style>body{font-family:system-ui;background:#fff;color:#00498B;display:grid;place-items:center;height:100vh;margin:0}
button{background:#00498B;color:#fff;border:0;border-radius:12px;padding:14px 22px;font-size:16px;cursor:pointer}</style>
</head><body>
<main style="text-align:center;max-width:360px">
  <h1>Röbel ID</h1>
  <p>Melde dich mit deiner Röbel-Identität an, um fortzufahren.</p>
  <button id="login">Mit Röbel anmelden</button>
  <p id="status" style="color:#6B7280;font-size:14px"></p>
</main>
<script type="module">
  import { createThirdwebClient, defineChain } from 'https://esm.sh/thirdweb@5'
  import { inAppWallet } from 'https://esm.sh/thirdweb@5/wallets'
  import { SiweMessage } from 'https://esm.sh/siwe@3'
  const client = createThirdwebClient({ clientId: '${thirdwebClientId}' })
  const status = document.getElementById('status')
  document.getElementById('login').onclick = async () => {
    try {
      status.textContent = 'Verbinde…'
      // Modern enclave in-app wallet (matches apps/web + apps/expo) so the visitor's EXISTING
      // Google/email smart account is recovered. NOTE: strategy:'iframe' is the LEGACY sharded
      // flow → it fails with "Missing recovery share" against enclave wallets.
      const wallet = inAppWallet({
        auth: { options: ['google', 'email', 'apple', 'facebook'] },
        smartAccount: { chain: defineChain(${chainId}), sponsorGas: true },
      })
      const account = await wallet.connect({ client, strategy: 'google' })
      const nonce = await (await fetch('/interaction/${uid}/nonce')).text()
      const message = new SiweMessage({ domain: location.host, address: account.address, uri: location.origin,
        version: '1', chainId: ${chainId}, nonce, statement: '${SIWE_STATEMENT}',
        expirationTime: new Date(Date.now()+120000).toISOString() }).prepareMessage()
      const signature = await account.signMessage({ message })
      const res = await fetch('/interaction/${uid}/login', { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, signature }) })
      if (res.redirected) location.href = res.url
      else { const j = await res.json(); location.href = j.redirectTo }
    } catch (e) { status.textContent = 'Anmeldung fehlgeschlagen: ' + e.message }
  }
</script>
</body></html>`
}
