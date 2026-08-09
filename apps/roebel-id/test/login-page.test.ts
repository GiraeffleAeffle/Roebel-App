import { describe, it, expect } from 'vitest'
import { renderLoginPage } from '../src/interaction/login-page.js'

// I2 — per-client login branding. The roebel preset must render byte-for-byte identical to
// the pre-branding page (commit 9abd046c); the ortis preset must carry zero Röbel trace —
// Ortis is used by mayors of OTHER municipalities and must never see Röbel branding.

const PRE_BRANDING_PAGE = `<!doctype html><html lang="de"><head><meta charset="utf-8"/>
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

  const client = createThirdwebClient({ clientId: 'tw-client' })
  // One shared enclave wallet for every method → deterministic smart-account address that
  // matches the main app (recovers the visitor's existing Röbel identity).
  const wallet = inAppWallet({
    auth: { options: ['google', 'email', 'phone', 'apple', 'facebook'] },
    smartAccount: { chain: defineChain(100), sponsorGas: true },
  })

  const status = document.getElementById('status')
  const $ = (id) => document.getElementById(id)
  const setBusy = (b) => document.querySelectorAll('button').forEach((x) => { x.disabled = b })

  async function finishLogin(account) {
    status.textContent = 'Identität wird bestätigt…'
    const nonce = await (await fetch('/interaction/uid-1/nonce')).text()
    const message = new SiweMessage({ domain: location.host, address: account.address, uri: location.origin,
      version: '1', chainId: 100, nonce, statement: 'Anmeldung bei Roebel ID',
      expirationTime: new Date(Date.now()+120000).toISOString() }).prepareMessage()
    const signature = await account.signMessage({ message })
    const res = await fetch('/interaction/uid-1/login', { method: 'POST', headers: { 'content-type': 'application/json' },
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

describe('renderLoginPage — roebel preset', () => {
  it('renders byte-for-byte identical to the pre-branding page when there is no context', () => {
    const rendered = renderLoginPage('uid-1', 'tw-client', 100, { preset: 'roebel' })
    expect(rendered).toBe(PRE_BRANDING_PAGE)
  })

  it('carries no ortis trace', () => {
    const rendered = renderLoginPage('uid-1', 'tw-client', 100, { preset: 'roebel' })
    expect(rendered).not.toContain('Ortis')
  })
})

describe('renderLoginPage — ortis preset', () => {
  it('titles and headlines as Ortis, with zero Röbel trace and no navy anywhere', () => {
    const rendered = renderLoginPage('uid-1', 'tw-client', 100, { preset: 'ortis' })
    expect(rendered).toContain('<title>Bei Ortis anmelden</title>')
    expect(rendered).toContain('<h1>Ortis</h1>')
    expect(rendered).not.toContain('Röbel')
    expect(rendered).not.toContain('#00498B')
  })

  it('uses a monochrome, near-black palette for buttons/headline', () => {
    const rendered = renderLoginPage('uid-1', 'tw-client', 100, { preset: 'ortis' })
    expect(rendered).toContain('color:#111')
    expect(rendered).toContain('background:#111')
  })

  it('renders an optional context line under the heading, HTML-escaped', () => {
    const rendered = renderLoginPage('uid-1', 'tw-client', 100, {
      preset: 'ortis',
      context: '<script>alert(1)</script> & "Amt" \'Musterstadt\'',
    })
    expect(rendered).toContain(
      '&lt;script&gt;alert(1)&lt;/script&gt; &amp; &quot;Amt&quot; &#39;Musterstadt&#39;',
    )
    expect(rendered).not.toContain('<script>alert(1)</script>')
  })

  it('omits the context element entirely when no context is configured (no empty element)', () => {
    const rendered = renderLoginPage('uid-1', 'tw-client', 100, { preset: 'ortis' })
    // The heading must be followed directly by the intro paragraph, not by a stray/empty node.
    expect(rendered).toMatch(/<h1>Ortis<\/h1>\n {2}<p>Melde dich/)
  })
})
