import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Me } from '../../api/me'
import { messages } from '../../messages'
import type { PartnerRole } from '../shell/partnerRoles'
import { LiveMoment } from './LiveMoment'
import { Onboarding } from './Onboarding'
import { allChecksPass, sampleOnboarding } from './onboardingSample'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')
const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/dashboard'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const me = (role: PartnerRole = 'partner-owner'): Me => ({ id: 'pu-1', name: 'Jonas Weber', email: 'jonas@kaufladen.de', role, partner: { id: 'p-kl', name: 'Kaufladen Digital', product: 'Kaufladen Shops', host: 'shop.kaufladen.de', state: 'draft' } })
const words = messages.onboarding

describe('the setup checklist', () => {
  it('lists every item with the API’s link, and Submit as the last step', async () => {
    const html = await render(<Onboarding me={me()} state="draft" onboarding={sampleOnboarding()} staffSetup={false} welcome={false} />)
    const text = textOf(html)
    for (const item of Object.values(words.items)) expect(text).toContain(item.label)
    for (const to of ['/settings', '/branding', '/domains', '/plans']) expect(html).toContain(`href="${to}"`)
    expect(text).toContain(words.submit)
    expect(text).toContain('2 of 10 done')
  })

  it('shows the API’s detail, and the item’s own hint when the API has none', async () => {
    const text = textOf(await render(<Onboarding me={me()} state="draft" onboarding={sampleOnboarding()} staffSetup={false} welcome={false} />))
    expect(text).toContain('shop.kaufladen.de: waiting for DNS')
    expect(text).toContain(words.items.legal.hint)
  })

  it('disables Submit while the API’s go-live checks fail, counting those checks', async () => {
    const html = await render(<Onboarding me={me()} state="draft" onboarding={sampleOnboarding()} staffSetup={false} welcome={false} />)
    expect(html).toMatch(/<button[^>]*class="df-button df-button--primary"[^>]*disabled=""/)
    expect(textOf(html)).toContain('Finish the 3 items above first. Payment method and payout details can come later.')
    const enabled = await render(<Onboarding me={me()} state="draft" onboarding={sampleOnboarding({ checks: allChecksPass })} staffSetup={false} welcome={false} />)
    expect(enabled).not.toMatch(/<button[^>]*class="df-button df-button--primary"[^>]*disabled=""/)
    expect(textOf(enabled)).not.toContain('Finish the')
  })

  // The verdict is the API's (canSubmit); the screen never works out who may submit.
  it.each(['OWNERS_AND_ADMINS_ONLY', 'ALREADY_SUBMITTED', 'ALREADY_APPROVED'] as const)('disables Submit with the words for the API’s %s', async (reason) => {
    const html = await render(<Onboarding me={me('partner-owner')} state="draft" onboarding={sampleOnboarding({ checks: allChecksPass, canSubmit: { allowed: false, reason } })} staffSetup={false} welcome={false} />)
    expect(textOf(html)).toContain(words.refused[reason])
    expect(html).toMatch(/<button[^>]*class="df-button df-button--primary"[^>]*disabled=""/)
  })

  it('says Done by whoever the API names', async () => {
    const html = await render(<Onboarding me={me()} state="draft" onboarding={sampleOnboarding()} staffSetup={false} welcome={true} />)
    expect(html.match(/Done by DripFunnel/g)?.length).toBe(1)
    expect(textOf(html)).toContain('Done by Jonas')
    expect(textOf(html)).toContain('Welcome, Jonas.')
  })

  it('locks payment method and payout details for a staff member in a setup session', async () => {
    const text = textOf(await render(<Onboarding me={me()} state="draft" onboarding={sampleOnboarding()} staffSetup={true} welcome={false} />))
    expect(text.match(/Kaufladen Digital enters this itself/g)?.length).toBe(2)
    expect(text).not.toContain(words.yourTurn)
    const owner = textOf(await render(<Onboarding me={me()} state="draft" onboarding={sampleOnboarding()} staffSetup={false} welcome={false} />))
    expect(owner.match(/Your turn/g)?.length).toBe(2)
    const admin = textOf(await render(<Onboarding me={me('partner-admin')} state="draft" onboarding={sampleOnboarding()} staffSetup={false} welcome={false} />))
    expect(admin.match(/Owner adds this/g)?.length).toBe(2)
  })
})

describe('the partner states', () => {
  const submitted = sampleOnboarding({
    items: sampleOnboarding().items.map((x) => (x.key === 'paymentMethod' || x.key === 'payoutDetails' ? x : { ...x, status: 'done' as const })),
    checks: allChecksPass,
    submittedAt: '2026-09-27T09:00:00.000Z',
    submittedBy: 'DripFunnel',
    canSubmit: { allowed: false, reason: 'ALREADY_SUBMITTED' },
  })

  it('shows what happens next while awaiting approval, with no Submit step', async () => {
    const html = await render(<Onboarding me={me()} state="awaiting" onboarding={submitted} staffSetup={false} welcome={false} />)
    const text = textOf(html)
    expect(html).not.toContain('df-checklist-row--submit')
    expect(text).toContain(words.awaiting.title)
    expect(text).toContain('Submitted by DripFunnel on Sep 27, 2026.')
    expect(text).toContain('8 of 10 done')
    for (const step of words.awaiting.next) expect(text).toContain(step.title)
    expect(text).toContain(words.awaiting.note)
  })

  it('shows DripFunnel’s reason verbatim, each fix as a link to its screen, and Submit again', async () => {
    const sentBack = sampleOnboarding({ sentBackReason: 'Your legal pages have no Impressum.', fixes: [{ item: 'legal', to: '/branding' }] })
    const html = await render(<Onboarding me={me()} state="sentback" onboarding={sentBack} staffSetup={false} welcome={false} />)
    const text = textOf(html)
    expect(text).toContain(words.sentBack.title)
    expect(html).toMatch(/role="alert"/)
    expect(text).toContain('Your legal pages have no Impressum.')
    expect(html).toMatch(/<a[^>]*href="\/branding"[^>]*>Fix: Legal pages<\/a>/)
    expect(text).toContain(words.submitAgain)
  })

  it('announces the Live moment once with the sign-up link', async () => {
    const text = textOf(await render(<LiveMoment product="Kaufladen Shops" host="shop.kaufladen.de" />))
    expect(text).toContain('Kaufladen Shops is live at shop.kaufladen.de.')
    expect(text).toContain('shop.kaufladen.de/signup')
  })
})
