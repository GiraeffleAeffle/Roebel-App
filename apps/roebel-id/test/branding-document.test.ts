import { describe, it, expect } from 'vitest'
import { brandingDocument } from '../src/interaction/branding-document.js'

const ROEBEL_TRACE = /r(ö|oe)bel/i

describe('brandingDocument', () => {
  it('describes the ortis preset with no Röbel trace anywhere', () => {
    const doc = brandingDocument('ortis')
    expect(doc.preset).toBe('ortis')
    expect(doc.heading).toBe('Ortis')
    expect(JSON.stringify(doc)).not.toMatch(ROEBEL_TRACE)
  })

  it('carries the optional context line when given', () => {
    expect(brandingDocument('ortis', 'für Amt Röbel-Müritz').context).toBe('für Amt Röbel-Müritz')
  })

  it('omits context entirely when absent', () => {
    expect(brandingDocument('ortis')).not.toHaveProperty('context')
  })

  it('never leaks the SIWE statement or wallet note', () => {
    // Those are login-page internals. A public branding document is for rendering a modal;
    // widening it later is easy, narrowing it after consumers depend on it is not.
    const doc = brandingDocument('roebel') as Record<string, unknown>
    expect(doc.siweStatement).toBeUndefined()
    expect(doc.walletNote).toBeUndefined()
  })
})
