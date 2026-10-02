import { describe, expect, it } from 'vitest'
import { brandingServer, createBrandingServer } from './brandingSample'
import type { BrandingInput } from './branding'

const fresh = () => createBrandingServer({ 'p-northstar': { branding: brandingServer.get('p-northstar', 'partner-owner'), affects: 84, poweredBy: { kind: 'choice' }, impressumRequired: false }, 'p-kaufladen': { branding: brandingServer.get('p-kaufladen', 'partner-owner'), affects: 0, poweredBy: { kind: 'fixedOn' }, impressumRequired: true } })

const inputOf = (partnerId: string): BrandingInput => {
  const { look, words } = brandingServer.get(partnerId, 'partner-owner')
  return { look, words }
}

describe('the branding fixture, as the Platform API would answer', () => {
  it('reports the contrast of both pairs, worded with the fix when one fails', () => {
    const passing = brandingServer.contrast('#0F5E63', '#E8C9A0')
    expect(passing.passes).toBe(true)
    expect(passing.pairs.map((pair) => pair.passes)).toEqual([true, true])
    const failing = brandingServer.contrast('#9ACDD6', '#E8C9A0')
    expect(failing.passes).toBe(false)
    expect(failing.pairs[0]?.passes).toBe(false)
    expect(failing.fix).toMatch(/^White button text on #9ACDD6 is \d\.\d:1\. It needs 4\.5:1 to be readable; try a darker primary\.$/)
    expect(brandingServer.contrast('#0F5E63', '#555555').fix).toContain('try a lighter accent')
  })

  it('refuses a failing pair with the fix and changes nothing', () => {
    const s = fresh()
    const input = inputOf('p-northstar')
    const result = s.publish('p-northstar', { ...input, look: { ...input.look, primary: '#9ACDD6' } }, 'partner-owner')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('CONTRAST_FAILS')
    expect(s.get('p-northstar', 'partner-owner').look.primary).toBe('#0F5E63')
  })

  it('keeps "Powered by" on where the contract says so, and needs the Impressum in Germany', () => {
    const s = fresh()
    expect(s.get('p-kaufladen', 'partner-owner').poweredBy).toEqual({ kind: 'fixedOn' })
    const input = inputOf('p-kaufladen')
    expect(s.publish('p-kaufladen', { ...input, words: { ...input.words, poweredBy: false, impressum: 'Kaufladen Digital GmbH, Torstraße 140, 10119 Berlin' } }, 'partner-owner')).toEqual({ ok: false, reason: 'POWERED_BY_FIXED_BY_CONTRACT' })
    expect(s.publish('p-kaufladen', input, 'partner-owner')).toEqual({ ok: false, reason: 'IMPRESSUM_REQUIRED' })
    expect(s.publish('p-kaufladen', { ...input, words: { ...input.words, impressum: 'Kaufladen Digital GmbH, Torstraße 140, 10119 Berlin' } }, 'partner-owner')).toEqual({ ok: true })
    expect(s.get('p-northstar', 'partner-owner').poweredBy).toEqual({ kind: 'choice' })
  })

  it('lets Owners and Admins publish and refuses the other roles', () => {
    const s = fresh()
    const input = inputOf('p-northstar')
    for (const role of ['partner-finance', 'partner-support', 'partner-read-only'] as const) {
      expect(s.publish('p-northstar', input, role)).toEqual({ ok: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
      expect(s.get('p-northstar', role).permission).toEqual({ allowed: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
    }
    expect(s.publish('p-northstar', { ...input, look: { ...input.look, files: { ...input.look.files, mark: '' } } }, 'partner-admin')).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect(s.publish('p-northstar', { ...input, look: { ...input.look, productName: 'Northstar Stores' } }, 'partner-admin')).toEqual({ ok: true })
    expect(s.get('p-northstar', 'partner-owner').look.productName).toBe('Northstar Stores')
    expect(s.get('p-northstar', 'partner-owner').affects).toBe(84)
  })
})
