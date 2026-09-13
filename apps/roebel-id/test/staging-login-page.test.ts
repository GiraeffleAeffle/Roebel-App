import { runInNewContext } from 'node:vm'
import { describe, expect, it, vi } from 'vitest'
import { SiweMessage } from 'siwe'
import { privateKeyToAccount } from 'viem/accounts'
import { verifyMessage } from 'viem'
import { renderStagingLoginPage } from '../src/interaction/staging-login-page.js'

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`)
const origin = 'https://roebel-id.staging.agentcart.eu'

function browser(reply = new Response(JSON.stringify({ redirectTo: `${origin}/auth/resume` }))) {
  const button = { disabled: false, onclick: undefined as undefined | (() => Promise<void>) }
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
  const script = html.split('<script type="module">')[1].split('</script>')[0].replace(/import .* from '[^']+'/g, '')
  runInNewContext(script, { SiweMessage, URL, TextEncoder, Error, location,
    document: { getElementById: (id: string) => id === 'login' ? button : status },
    window: { ethereum: { request } }, fetch: fetcher,
  })
  return { button, status, location, request, fetcher }
}

describe('independent staging wallet login', () => {
  it('signs the one-time staging challenge and resumes only this issuer', async () => {
    const page = browser()
    await page.button.onclick!()
    expect(page.request.mock.calls.map(([input]) => input.method)).toEqual(['eth_requestAccounts', 'personal_sign'])
    const submitted = JSON.parse(page.fetcher.mock.calls[1][1].body)
    const siwe = new SiweMessage(submitted.message)
    expect(siwe).toMatchObject({ domain: new URL(origin).host, uri: origin, chainId: 100, nonce: 'abcdef1234567890' })
    expect(await verifyMessage({ address: account.address, ...submitted })).toBe(true)
    expect(page.location.href).toBe(`${origin}/auth/resume`)
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
})
