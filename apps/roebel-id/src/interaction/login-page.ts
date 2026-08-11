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
//
// Branding is per-RP (see `RelyingPartyConfig.branding` in config.ts): Ortis — the
// multi-community consumer of this keystone, used by mayors of OTHER municipalities — must
// never show Röbel branding, so the requesting client's preset (resolved by the interaction
// router) picks the copy/colors below. The 'roebel' preset renders byte-for-byte identical to
// the page before branding was parametrized; new presets are pure data.
import type { BrandingConfig, BrandingPreset } from '../config.js'

export type { BrandingPreset }

export interface PresetCopy {
  title: string
  heading: string
  intro: string
  /** Headline text color + button background. */
  primaryColor: string
  /** Optional context-line color; also drives the `.sep` separator and `#status` message color. */
  secondaryColor: string
  /** Second line of the enclave-wallet explainer comment inside the <script> block. */
  walletNote: string
  /**
   * The signed SIWE `statement` (EIP-4361). MUST stay ASCII-only — siwe@3.0.0 enforces the
   * EIP-4361 ABNF and rejects non-ASCII bytes here (no umlauts, no em dashes, etc). Per-preset
   * so no page — including Ortis — ever sends "Roebel" to the browser, even inside the script
   * block's signed-message payload.
   */
  siweStatement: string
}

export const PRESETS: Record<BrandingPreset, PresetCopy> = {
  roebel: {
    title: 'Bei Röbel anmelden',
    heading: 'Röbel ID',
    intro: 'Melde dich mit deiner Röbel-Identität an, um fortzufahren.',
    primaryColor: '#00498B',
    secondaryColor: '#6B7280',
    walletNote: "matches the main app (recovers the visitor's existing Röbel identity).",
    siweStatement: 'Anmeldung bei Roebel ID',
  },
  ortis: {
    title: 'Anmelden bei Ortis',
    heading: 'Ortis',
    intro: 'Melde dich bei Ortis an, um fortzufahren.',
    primaryColor: '#111',
    secondaryColor: '#6B7280',
    walletNote: "matches the main app (recovers the visitor's existing identity).",
    siweStatement: 'Anmeldung bei Ortis',
  },
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderLoginPage(uid: string, thirdwebClientId: string, chainId: number, branding: BrandingConfig): string {
  const copy = PRESETS[branding.preset]
  // Only emitted when an org/Amt name is configured for this RP — no empty element otherwise,
  // so the default (no context) roebel page stays byte-for-byte identical to before branding
  // was parametrized. `branding.context` is env-controlled text landing in HTML: escape it.
  const contextLine = branding.context
    ? `\n  <p style="color:${copy.secondaryColor};font-size:14px;margin:0 0 12px">${escapeHtml(branding.context)}</p>`
    : ''

  return `<!doctype html><html lang="de"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${copy.title}</title>
<style>
  body{font-family:system-ui;background:#fff;color:${copy.primaryColor};display:grid;place-items:center;min-height:100vh;margin:0}
  main{text-align:center;max-width:340px;width:90%}
  .col{display:flex;flex-direction:column;gap:10px}
  button{background:${copy.primaryColor};color:#fff;border:0;border-radius:12px;padding:13px 20px;font-size:16px;cursor:pointer}
  button:disabled{opacity:.5;cursor:default}
  input{border:1px solid #B4B8C1;border-radius:12px;padding:12px 14px;font-size:16px;font-family:inherit}
  .sep{color:${copy.secondaryColor};font-size:13px;margin:8px 0}
  #status{color:${copy.secondaryColor};font-size:14px;min-height:20px}
</style>
</head><body>
<main>
  <h1>${copy.heading}</h1>${contextLine}
  <p>${copy.intro}</p>
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
  // ${copy.walletNote}
  const wallet = inAppWallet({
    auth: { options: ['google', 'email', 'phone', 'apple', 'facebook'] },
    smartAccount: { chain: defineChain(${chainId}), sponsorGas: true },
  })

  const status = document.getElementById('status')
  const $ = (id) => document.getElementById(id)
  const setBusy = (b) => document.querySelectorAll('button').forEach((x) => { x.disabled = b })

  async function finishLogin(account) {
    status.textContent = 'Identität wird bestätigt…'
    const nonce = await (await fetch('/interaction/${uid}/nonce')).text()
    const message = new SiweMessage({ domain: location.host, address: account.address, uri: location.origin,
      version: '1', chainId: ${chainId}, nonce, statement: '${copy.siweStatement}',
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
