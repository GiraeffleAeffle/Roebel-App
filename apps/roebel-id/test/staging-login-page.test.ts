import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { SiweMessage } from 'siwe'
import { privateKeyToAccount } from 'viem/accounts'
import { verifyMessage } from 'viem'
import { renderStagingLoginPage } from '../src/interaction/staging-login-page.js'
import { createStagingWorkspaceLogin } from '../../web/src/lib/workspace/staging-login-bridge.js'
import { createThirdwebCitizenSession } from '../../web/src/lib/citizen-session/thirdweb-adapter.js'
import { verifySiwe } from '../src/auth-bridge/verify-siwe.js'
import { createMemoryNonceStore } from '../src/auth-bridge/nonce-store.js'

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const origin = 'https://roebel-id.staging.agentcart.eu'

function browser(reply = new Response(JSON.stringify({ redirectTo: `${origin}/auth/resume` }))) {
  const button = { disabled: false, onclick: undefined as undefined | (() => Promise<void>) }
  const appButton = { disabled: false, onclick: undefined as undefined | (() => void) }
  const cancel = { hidden: true, onclick: undefined as undefined | (() => void) }
  const popup = { postMessage: vi.fn() }
  let receive: (event: { origin: string; source: unknown; data: unknown }) => Promise<void> = async () => {}
  const status = { textContent: '' }
  const location = { origin, host: new URL(origin).host, href: `${origin}/interaction/test` }
  const request = vi.fn(async ({ method, params }: { method: string; params?: string[] }) => {
    if (method === 'eth_requestAccounts') return [account.address]
    if (method === 'personal_sign' && params?.[1] === account.address) {
      return account.signMessage({ message: { raw: params[0] as `0x${string}` } })
    }
    throw new Error('Unexpected wallet action')
  })
  const fetcher = vi.fn().mockResolvedValueOnce(new Response('abcdef1234567890')).mockResolvedValueOnce(reply)
  const html = renderStagingLoginPage('test')
  // Execute the complete delivered script with browser globals only. Login
  // must initialize without loading a CDN or injecting a SIWE implementation.
  const script = html.split('<script>')[1].split('</script>')[0]
  runInNewContext(script, { URL, TextEncoder, Error, AbortSignal, location,
    document: { getElementById: (id: string) => id === 'login' ? button : id === 'app-login' ? appButton : id === 'cancel' ? cancel : status },
    window: { ethereum: { request }, open: () => popup,
      addEventListener: (_type: string, listener: typeof receive) => { receive = listener } }, fetch: fetcher,
  })
  return { button, appButton, cancel, popup, receive: (event: Parameters<typeof receive>[0]) => receive(event), status, location, request, fetcher }
}

describe('independent staging wallet login', () => {
  it('signs the one-time staging challenge and resumes only this issuer', async () => {
    const page = browser()
    await page.button.onclick!()
    expect(page.request.mock.calls.map(([input]) => input.method)).toEqual(['eth_requestAccounts', 'personal_sign'])
    const submitted = JSON.parse(page.fetcher.mock.calls[1][1].body)
    const siwe = new SiweMessage(submitted.message)
    expect(siwe).toMatchObject({ domain: new URL(origin).host, uri: origin, chainId: 100, nonce: 'abcdef1234567890' })
    expect(new Date(siwe.expirationTime!).getTime() - new Date(siwe.issuedAt!).getTime()).toBe(120000)
    expect(await verifyMessage({ address: account.address, ...submitted })).toBe(true)
    expect(page.location.href, page.status.textContent).toBe(`${origin}/auth/resume`)
  })

  it.each([
    new Response('{"error":"authentication_failed"}', { status: 401 }),
    new Response('{"redirectTo":"https://id.roebel.app/auth/resume"}'),
    new Response('{"redirectTo":"/api/other"}'),
  ])('keeps rejected logins on the page and allows another attempt', async (reply) => {
    const page = browser(reply)
    await page.button.onclick!()
    expect(page.location.href).toBe(`${origin}/interaction/test`)
    expect(page.button.disabled).toBe(false)
    expect(page.status.textContent).not.toBe('')
  })

  it('does not ask for a signature or contact the server after wallet cancellation', async () => {
    const page = browser()
    page.request.mockRejectedValueOnce({ code: 4001 })
    await page.button.onclick!()
    expect(page.status.textContent).toContain('abgebrochen')
    expect(page.fetcher).not.toHaveBeenCalled()
    expect(page.button.disabled).toBe(false)
  })

  it('rejects a malformed challenge before asking the wallet to sign', async () => {
    const page = browser()
    page.fetcher.mockReset().mockResolvedValue(new Response('bad\\nchallenge'))
    await page.button.onclick!()
    expect(page.request.mock.calls.map(([input]) => input.method)).toEqual(['eth_requestAccounts'])
    expect(page.button.disabled).toBe(false)
    expect(page.status.textContent).toContain('Ungültige Anmeldeanfrage')
  })
})

describe('Röbel app account login', () => {
  const appOrigin = 'https://roebel-web.staging.agentcart.eu'
  const ready = { schemaVersion: 'roebel_workspace_login_ready_v1' }

  it.each(['11', '22'])('verifies a separate account through the delivered login script and existing SIWE verifier (%s)', async key => {
    const signer = privateKeyToAccount(`0x${key.repeat(32)}`)
    const session = createThirdwebCitizenSession({ account: signer, memberId: null, appAccountId: null })
    const store = createMemoryNonceStore(), nonce = store.issue()
    const page = browser()
    const opener = { postMessage: vi.fn() }
    const status = vi.fn()
    const bridge = createStagingWorkspaceLogin({ session, opener, appOrigin, onStatus: status })
    page.fetcher.mockReset().mockResolvedValueOnce(new Response(nonce)).mockImplementationOnce(async (_url, init) => {
      const proof = JSON.parse(init.body)
      const verified = await verifySiwe({ ...proof, nonceStore: store, expectedDomain: new URL(origin).host,
        expectedChainId: 100, verifier: verifyMessage })
      expect(verified.address).toBe(signer.address.toLowerCase())
      return Response.json({ redirectTo: `${origin}/auth/resume` })
    })
    page.appButton.onclick!()
    bridge.start()
    await page.receive({ origin: appOrigin, source: page.popup, data: opener.postMessage.mock.calls[0][0] })
    expect(page.popup.postMessage.mock.calls[0][1]).toBe(appOrigin)
    await bridge.receive({ origin, source: opener, data: page.popup.postMessage.mock.calls[0][0] })
    const reply = opener.postMessage.mock.calls[1][0]
    expect(opener.postMessage.mock.calls[1][1]).toBe(origin)
    await page.receive({ origin: appOrigin, source: page.popup, data: reply })
    expect(page.location.href, page.status.textContent).toBe(`${origin}/auth/resume`)
    expect(page.fetcher).toHaveBeenCalledTimes(2)
    await page.receive({ origin: appOrigin, source: page.popup, data: reply })
    expect(page.fetcher).toHaveBeenCalledTimes(2)
    await expect(verifySiwe({ ...reply, nonceStore: store, expectedDomain: new URL(origin).host,
      expectedChainId: 100, verifier: verifyMessage })).rejects.toThrow(/nonce/)
    expect(page.request).not.toHaveBeenCalled()
    expect(status).toHaveBeenLastCalledWith('sent')
    bridge.dispose(); session.dispose()
  })

  it('ignores foreign origins, other windows, unsolicited replies and replies after cancellation', async () => {
    const page = browser()
    await page.receive({ origin: appOrigin, source: page.popup, data: ready })
    page.appButton.onclick!()
    await page.receive({ origin: 'https://foreign.example', source: page.popup, data: ready })
    await page.receive({ origin: appOrigin, source: {}, data: ready })
    expect(page.fetcher).not.toHaveBeenCalled()
    page.cancel.onclick!()
    await page.receive({ origin: appOrigin, source: page.popup, data: ready })
    expect(page.fetcher).not.toHaveBeenCalled()
    expect(page.button.disabled).toBe(false)
  })

  it('rejects a reply for another challenge before sending it to the issuer', async () => {
    const page = browser()
    page.appButton.onclick!()
    await page.receive({ origin: appOrigin, source: page.popup, data: ready })
    await page.receive({ origin: appOrigin, source: page.popup, data: { schemaVersion: 'roebel_workspace_login_response_v1',
      requestId: 'test', message: 'Nonce: other-nonce', signature: '0x11' } })
    expect(page.fetcher).toHaveBeenCalledTimes(1)
    expect(page.location.href).toBe(`${origin}/interaction/test`)
    expect(page.status.textContent).toContain('Ungültige')
  })
})
