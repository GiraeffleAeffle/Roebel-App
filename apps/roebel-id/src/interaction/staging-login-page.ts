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
<h1>Im Town Workspace anmelden</h1>
<p>Verwende dein eigenes Röbel-Konto. Die Signatur bestätigt die Kontrolle über dein Konto; Testzugang und Aufgaben werden separat freigeschaltet.</p>
<button id="app-login" type="button">Mit Röbel-Konto anmelden</button>
<p>Du nutzt bereits eine freigeschaltete Browser-Wallet?</p>
<button id="login" type="button">Wallet verbinden und anmelden</button>
<button id="cancel" type="button" hidden>Anmeldeversuch abbrechen</button>
<p id="status" role="status" aria-live="polite"></p>
<small>Keine Transaktion, keine Gebühren. Der Testzugang bestätigt weder Wohnsitz noch ein kommunales Amt. Ein separates Testkonto übernimmt keine bestehende Röbel-Identität.</small>
</main><script>
  const button = document.getElementById('login')
  const appButton = document.getElementById('app-login')
  const cancel = document.getElementById('cancel')
  const status = document.getElementById('status')
  const appOrigin = 'https://roebel-web.staging.agentcart.eu'
  let popup = null, pendingNonce = null, generation = 0
  function reset() {
    generation++; popup = null; pendingNonce = null
    button.disabled = false; appButton.disabled = false; cancel.hidden = true
  }
  cancel.onclick = () => { reset(); status.textContent = 'Anmeldung abgebrochen. Du kannst es erneut versuchen.' }
  async function finish(message, signature, attempt) {
    const response = await fetch('/interaction/${uid}/login', { method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, signature }), signal: AbortSignal.timeout(15000) })
    if (attempt !== generation) return
    if (!response.ok) throw new Error('Anmeldung abgelehnt. Dieses Konto muss für den Test freigeschaltet sein. Die Verwaltungsrolle wird separat zugewiesen.')
    const result = await response.json()
    if (typeof result.redirectTo !== 'string') throw new Error('Anmeldung konnte nicht abgeschlossen werden.')
    const next = new URL(result.redirectTo, location.origin)
    if (next.origin !== location.origin || !next.pathname.startsWith('/auth/')) throw new Error('Ungültige Anmeldeantwort.')
    location.href = next.href
  }
  appButton.onclick = () => {
    reset()
    popup = window.open(appOrigin + '/app/verwaltung-anmelden', '_blank', 'popup,width=620,height=760')
    if (!popup) { status.textContent = 'Bitte erlaube das Anmeldefenster und versuche es erneut.'; return }
    button.disabled = true; appButton.disabled = true; cancel.hidden = false
    status.textContent = 'Melde dich im neuen Fenster mit deinem Röbel-Konto an und bestätige die Anmeldung.'
  }
  window.addEventListener('message', async event => {
    if (!popup || event.source !== popup || event.origin !== appOrigin || !event.data || typeof event.data !== 'object') return
    const data = event.data, attempt = generation
    try {
      if (data.schemaVersion === 'roebel_workspace_login_ready_v1' && Object.keys(data).join() === 'schemaVersion' && pendingNonce !== 'loading') {
        pendingNonce = 'loading'
        const response = await fetch('/interaction/${uid}/nonce', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) })
        if (!response.ok) throw Error('Anmeldung ist nicht erreichbar. Bitte erneut versuchen.')
        const nonce = await response.text()
        if (attempt !== generation) return
        if (!/^[A-Za-z0-9]{8,128}$/.test(nonce)) throw Error('Ungültige Anmeldeanfrage.')
        pendingNonce = nonce
        popup.postMessage({ schemaVersion: 'roebel_workspace_login_request_v1', requestId: '${uid}', nonce }, appOrigin)
      } else if (data.schemaVersion === 'roebel_workspace_login_response_v1' && pendingNonce && pendingNonce !== 'loading') {
        if (Object.keys(data).sort().join() !== 'message,requestId,schemaVersion,signature' || data.requestId !== '${uid}' ||
          typeof data.message !== 'string' || data.message.length > 1500 || !data.message.split('\\n').includes('Nonce: ' + pendingNonce) ||
          typeof data.signature !== 'string' || data.signature.length > 16384 || !/^0x[0-9a-f]+$/i.test(data.signature)) throw Error('Ungültige Anmeldeantwort.')
        pendingNonce = null; popup = null; cancel.hidden = true
        await finish(data.message, data.signature, attempt)
      }
    } catch (error) {
      if (attempt !== generation) return
      reset(); status.textContent = error instanceof Error ? error.message : 'Anmeldung fehlgeschlagen.'
    }
  })
  button.onclick = async () => {
    reset(); button.disabled = true; appButton.disabled = true
    const attempt = generation
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
      if (attempt !== generation) return
      await finish(message, signature, attempt)
    } catch (error) {
      status.textContent = error?.code === 4001 ? 'Anmeldung abgebrochen. Du kannst es erneut versuchen.' :
        error instanceof Error ? error.message : 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.'
      reset()
    }
  }
</script></body></html>`
}
