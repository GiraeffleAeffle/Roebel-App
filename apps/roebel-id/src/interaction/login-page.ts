// Minimal, dependency-free login page served straight from the OIDC service. It loads
// thirdweb + siwe from esm.sh in the browser (no bundler in this tiny service), connects the
// visitor's in-app wallet (enclave; matches apps/web + apps/expo), signs a SIWE message, and
// posts the result back to this uid's `/login` endpoint. The visible copy may use German
// umlauts; the signed SIWE `statement` MUST stay ASCII-only — siwe@3.0.0 enforces the
// EIP-4361 ABNF and rejects non-ASCII bytes there.
//
// Login methods: Google/Apple/Facebook (OAuth, one connect() call) + Email (2-step:
// preAuthenticate sends a code, then connect() with the code). All use the SAME enclave
// wallet so the deterministic smart-account address matches the main Röbel app.
const SIWE_STATEMENT = 'Anmeldung bei Roebel ID'

export function renderLoginPage(uid: string, thirdwebClientId: string, chainId: number): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Bei Röbel anmelden</title>
<style>
  body{font-family:system-ui;background:#fff;color:#00498B;display:grid;place-items:center;min-height:100vh;margin:0}
  main{text-align:center;max-width:340px;width:90%}
  .col{display:flex;flex-direction:column;gap:10px}
  button{background:#00498B;color:#fff;border:0;border-radius:12px;padding:13px 20px;font-size:16px;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  input{border:1px solid #B4B8C1;border-radius:12px;padding:12px 14px;font-size:16px;font-family:inherit}
  .sep{color:#6B7280;font-size:13px;margin:8px 0}
  #status{color:#6B7280;font-size:14px;min-height:20px}
</style>
</head><body>
<main>
  <h1>Röbel ID</h1>
  <p>Melde dich mit deiner Röbel-Identität an, um fortzufahren.</p>
  <div class="col">
    <button class="oauth" data-s="google">Mit Google anmelden</button>
    <button class="oauth" data-s="apple">Mit Apple anmelden</button>
    <button class="oauth" data-s="facebook">Mit Facebook anmelden</button>
    <div class="sep">oder mit E-Mail</div>
    <input id="email" type="email" autocomplete="email" placeholder="E-Mail-Adresse" />
    <button id="sendCode">Code senden</button>
    <div id="codeBox" class="col" hidden>
      <input id="code" inputmode="numeric" autocomplete="one-time-code" placeholder="Bestätigungscode" />
      <button id="verify">Anmelden</button>
    </div>
  </div>
  <p id="status"></p>
</main>
<script type="module">
  import { createThirdwebClient, defineChain } from 'https://esm.sh/thirdweb@5'
  import { inAppWallet, preAuthenticate } from 'https://esm.sh/thirdweb@5/wallets'
  import { SiweMessage } from 'https://esm.sh/siwe@3'

  const client = createThirdwebClient({ clientId: '${thirdwebClientId}' })
  // One shared enclave wallet for every method → deterministic smart-account address that
  // matches the main app (recovers the visitor's existing Röbel identity).
  const wallet = inAppWallet({
    auth: { options: ['google', 'email', 'apple', 'facebook'] },
    smartAccount: { chain: defineChain(${chainId}), sponsorGas: true },
  })

  const status = document.getElementById('status')
  const $ = (id) => document.getElementById(id)
  const setBusy = (b) => document.querySelectorAll('button').forEach((x) => { x.disabled = b })

  async function finishLogin(account) {
    status.textContent = 'Identität wird bestätigt…'
    const nonce = await (await fetch('/interaction/${uid}/nonce')).text()
    const message = new SiweMessage({ domain: location.host, address: account.address, uri: location.origin,
      version: '1', chainId: ${chainId}, nonce, statement: '${SIWE_STATEMENT}',
      expirationTime: new Date(Date.now()+120000).toISOString() }).prepareMessage()
    const signature = await account.signMessage({ message })
    const res = await fetch('/interaction/${uid}/login', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message, signature }) })
    if (res.redirected) { location.href = res.url; return }
    const j = await res.json(); location.href = j.redirectTo
  }

  async function run(fn) {
    try { setBusy(true); await fn() }
    catch (e) { status.textContent = 'Anmeldung fehlgeschlagen: ' + (e && e.message ? e.message : e); setBusy(false) }
  }

  // OAuth providers — a single connect() call each.
  document.querySelectorAll('.oauth').forEach((b) => { b.onclick = () => run(async () => {
    status.textContent = 'Verbinde…'
    const account = await wallet.connect({ client, strategy: b.dataset.s })
    await finishLogin(account)
  }) })

  // Email — step 1: send the verification code.
  $('sendCode').onclick = () => run(async () => {
    const email = $('email').value.trim()
    if (!email) { status.textContent = 'Bitte E-Mail-Adresse eingeben'; setBusy(false); return }
    status.textContent = 'Code wird gesendet…'
    await preAuthenticate({ client, strategy: 'email', email })
    $('codeBox').hidden = false
    status.textContent = 'Code gesendet — bitte prüfe deine E-Mails'
    setBusy(false)
  })

  // Email — step 2: verify the code and connect.
  $('verify').onclick = () => run(async () => {
    status.textContent = 'Verbinde…'
    const account = await wallet.connect({ client, strategy: 'email', email: $('email').value.trim(), verificationCode: $('code').value.trim() })
    await finishLogin(account)
  })
</script>
</body></html>`
}
