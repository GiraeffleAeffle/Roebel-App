/** Independent wallet proof for explicitly admitted staging testers. */
export function renderStagingLoginPage(uid: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(uid)) throw new Error('Invalid staging interaction')
  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Röbel ID · Testbetrieb</title>
<style>
  body{font:17px/1.5 system-ui;background:#f3f6f9;color:#162b40;display:grid;place-items:center;min-height:100vh;margin:0}
  main{box-sizing:border-box;max-width:480px;width:calc(100% - 32px);padding:32px;background:white;border-radius:20px}
  .badge{font-size:14px;color:#536579}h1{font-size:28px;margin:12px 0}
  button{font:inherit;background:#00498b;color:white;border:0;border-radius:10px;padding:14px;width:100%;cursor:pointer}
  button:disabled{opacity:.6;cursor:wait}#status{min-height:26px;font-size:15px}small{color:#536579}
</style></head><body><main>
<div class="badge">TOWN WORKSPACE · TESTBETRIEB</div>
<h1>Mit Test-Wallet anmelden</h1>
<p>Nutze die für diesen Test freigeschaltete Browser-Wallet. Die Signatur bestätigt, dass du diese Wallet kontrollierst.</p>
<button id="login" type="button">Wallet verbinden und anmelden</button>
<p id="status" role="status" aria-live="polite"></p>
<small>Keine Transaktion, keine Gebühren. Der Testzugang bestätigt weder Wohnsitz noch ein kommunales Amt. Ein separates Testkonto übernimmt keine bestehende Röbel-Identität.</small>
</main><script>
  const button = document.getElementById('login')
  const status = document.getElementById('status')
  button.onclick = async () => {
    button.disabled = true
    try {
      if (!window.ethereum?.request) throw new Error('Bitte öffne diese Seite in einem Browser mit deiner Test-Wallet.')
      status.textContent = 'Test-Wallet verbinden…'
      const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' })
      const address = accounts?.[0]
      if (typeof address !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Keine Wallet ausgewählt.')
      const nonceResponse = await fetch('/interaction/${uid}/nonce', { credentials: 'same-origin' })
      if (!nonceResponse.ok) throw new Error('Anmeldung ist nicht erreichbar. Bitte erneut versuchen.')
      const nonce = await nonceResponse.text()
      if (!/^[A-Za-z0-9]{8,}$/.test(nonce)) throw new Error('Ungültige Anmeldeanfrage. Bitte starte die Anmeldung neu.')
      // This one fixed SIWE message needs no browser CDN dependency. The
      // server still parses and verifies it using the pinned SIWE library.
      const issuedAt = new Date()
      const message = [location.host + ' wants you to sign in with your Ethereum account:', address, '',
        'Anmeldung im Roebel Testbetrieb', '', 'URI: ' + location.origin, 'Version: 1', 'Chain ID: 100',
        'Nonce: ' + nonce, 'Issued At: ' + issuedAt.toISOString(),
        'Expiration Time: ' + new Date(issuedAt.getTime() + 120000).toISOString()].join('\\n')
      const encoded = '0x' + Array.from(new TextEncoder().encode(message), b => b.toString(16).padStart(2, '0')).join('')
      status.textContent = 'Bitte bestätige die Signatur in deiner Wallet.'
      const signature = await window.ethereum.request({ method: 'personal_sign', params: [encoded, address] })
      const response = await fetch('/interaction/${uid}/login', { method: 'POST', credentials: 'same-origin',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature }) })
      if (!response.ok) throw new Error('Anmeldung abgelehnt. Nutze eine freigeschaltete Test-Wallet oder starte die Anmeldung neu.')
      const result = await response.json()
      if (typeof result.redirectTo !== 'string') throw new Error('Anmeldung konnte nicht abgeschlossen werden.')
      const next = new URL(result.redirectTo, location.origin)
      if (next.origin !== location.origin || !next.pathname.startsWith('/auth/')) throw new Error('Ungültige Anmeldeantwort.')
      location.href = next.href
    } catch (error) {
      status.textContent = error?.code === 4001 ? 'Anmeldung abgebrochen. Du kannst es erneut versuchen.' :
        error instanceof Error ? error.message : 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.'
      button.disabled = false
    }
  }
</script></body></html>`
}
