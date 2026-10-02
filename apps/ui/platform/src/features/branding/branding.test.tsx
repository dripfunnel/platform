import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { brandingServer } from '../../api/brandingSample'
import type { Me } from '../../api/me'
import { messages } from '../../messages'
import type { PartnerRole } from '../shell/partnerRoles'
import { Branding, type BrandingProps } from './Branding'
import { draftOf, invalidFields, isDirty, publishConsequence, refusalText } from './brandDraft'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')
const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/branding'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const owner: Me = { id: 'pu-1', name: 'Maya Ortiz', email: 'maya@northstar.com', role: 'partner-owner', partner: { id: 'p-northstar', name: 'Northstar Commerce', product: 'Northstar Shops', host: 'store.northstar.com', state: 'live' } }
const noop = () => undefined
const words = messages.branding

const view = (props: Partial<BrandingProps> = {}, role: PartnerRole = 'partner-owner', partnerId = 'p-northstar') => {
  const branding = brandingServer.get(partnerId, role)
  const original = draftOf(branding)
  return render(
    <Branding
      me={{ ...owner, role, partner: { ...owner.partner, id: partnerId } }}
      branding={branding}
      draft={original}
      original={original}
      contrast={branding.contrast}
      tab="look"
      forced={null}
      busy={false}
      preview={{ screen: 'signin', device: 'desktop', mode: 'light', onScreen: noop, onDevice: noop, onMode: noop }}
      onDraft={noop}
      onDiscard={noop}
      onPublish={noop}
      onReload={noop}
      {...props}
    />,
  )
}

describe('Branding', () => {
  it('shows the look with the API’s contrast report, and the preview in the partner’s own variables only', async () => {
    const html = await view()
    const text = textOf(html)
    expect(text).toContain(words.look.productName)
    expect(text).toContain('White text on primary · 7.5:1')
    expect(text).toContain('Dark text on accent · 11.3:1')
    expect(text).toContain(words.look.passes)
    expect(text).toContain(words.preview.frame)
    expect(html).toContain(`aria-label="${words.preview.deviceLabel}"`)
    expect(text).toContain(words.preview.signInTitle)
    expect(text).not.toContain(words.unpublished)
    const root = /<div class="pv-root"[^>]*style="([^"]*)"/.exec(html)?.[1] ?? ''
    expect(root).toContain('--pv-primary:#0F5E63')
    expect(root).toContain('--pv-font:&quot;Nunito&quot;, system-ui, sans-serif')
    expect(root).not.toContain('--df-')
    expect(html).not.toMatch(/style="[^"]*--df-color/)
  })

  it('offers the words with the contract’s rule on "Powered by" and the Impressum where required', async () => {
    const northstar = textOf(await view({ tab: 'words' }))
    expect(northstar).toContain(words.words.poweredChoice)
    expect(northstar).not.toContain(words.words.impressumRequired)
    const kaufladen = await view({ tab: 'words' }, 'partner-owner', 'p-kaufladen')
    expect(textOf(kaufladen)).toContain(words.words.poweredFixed)
    expect(textOf(kaufladen)).toContain(words.words.impressumRequired)
    expect(textOf(kaufladen)).toContain(words.words.dpaNeeded)
    expect(kaufladen).toMatch(/<input type="checkbox"[^>]*disabled=""/)
    expect(kaufladen).toMatch(/<input type="checkbox"[^>]*checked=""/)
  })

  it('shows unpublished changes with how many stores they affect, and blocks Publish while the contrast fails', async () => {
    const branding = brandingServer.get('p-northstar', 'partner-owner')
    const original = draftOf(branding)
    const draft = { ...original, look: { ...original.look, primary: '#9ACDD6' } }
    expect(isDirty(draft, original)).toBe(true)
    const html = await view({ draft, contrast: brandingServer.contrast('#9ACDD6', original.look.accent) })
    const text = textOf(html)
    expect(text).toContain('Unpublished changes. Merchants still see the published version. This affects 84 stores.')
    expect(text).toContain(words.look.fails)
    expect(text).toContain('try a darker primary')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Publish…<\/button>/)
    expect(text).toContain(words.fixContrast)
    const passing = await view({ draft: { ...original, look: { ...original.look, productName: 'Northstar Stores' } } })
    expect(passing).toMatch(/<button[^>]*class="df-button df-button--primary"(?! disabled)[^>]*>Publish…<\/button>/)
  })

  it('states what a publish changes, and words each refusal with the API’s fix where it has one', () => {
    expect(publishConsequence(84)).toBe('This changes the merchant portal and emails for 84 stores. Their shops don’t change.')
    expect(publishConsequence(0)).toBe(words.dialog.consequenceNone)
    expect(refusalText({ ok: false, reason: 'CONTRAST_FAILS', fix: 'Try a darker primary.' })).toBe('Try a darker primary.')
    expect(refusalText({ ok: false, reason: 'POWERED_BY_FIXED_BY_CONTRACT' })).toBe(words.refused.POWERED_BY_FIXED_BY_CONTRACT)
  })

  it('marks a colour or address the API would refuse, and never fixes it', () => {
    const original = draftOf(brandingServer.get('p-northstar', 'partner-owner'))
    expect(invalidFields({ ...original, look: { ...original.look, primary: '#12' } })).toEqual(['primary'])
    expect(invalidFields({ ...original, words: { ...original.words, supportEmail: 'help', termsUrl: 'northstar' } }).sort()).toEqual(['supportEmail', 'termsUrl'])
    expect(invalidFields(original)).toEqual([])
  })

  it('disables the controls with the reason for Finance, Support and Read-only', async () => {
    for (const role of ['partner-finance', 'partner-support', 'partner-read-only'] as const) {
      const html = await view({}, role)
      expect(textOf(html)).toContain(words.viewNote)
      expect(html).toMatch(/<input id="brand-product"[^>]*disabled=""/)
    }
  })
})
