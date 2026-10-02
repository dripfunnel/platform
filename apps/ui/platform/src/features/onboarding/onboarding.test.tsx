import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Me } from '../../api/me'
import { onboardingFor } from '../../api/onboarding'
import { messages } from '../../messages'
import type { PartnerRole } from '../shell/partnerRoles'
import { LiveMoment } from './LiveMoment'
import { Onboarding } from './Onboarding'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')
const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/dashboard'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const me = (role: PartnerRole = 'partner-owner'): Me => ({ id: 'pu-1', name: 'Jonas Weber', email: 'jonas@kaufladen.de', role, partner: { id: 'p-kl', name: 'Kaufladen Digital', product: 'Kaufladen Shops', state: 'draft' } })
const words = messages.onboarding

describe('the setup checklist', () => {
  it('lists every item with a link or a button, and Submit as the last step', async () => {
    const html = await render(<Onboarding me={me()} onboarding={onboardingFor('draft', 'partner')} staffSetup={false} welcome={false} />)
    const text = textOf(html)
    for (const item of Object.values(words.items)) expect(text).toContain(item.label)
    for (const to of ['/settings', '/branding', '/domains', '/plans']) expect(html).toContain(`href="${to}"`)
    expect(text).toContain(words.runTest)
    expect(text).toContain(words.submit)
    expect(text).toContain('2 of 11 done')
  })

  it('disables Submit while items are left, saying how many, and keeps payout items out of the count', async () => {
    const html = await render(<Onboarding me={me()} onboarding={onboardingFor('draft', 'partner')} staffSetup={false} welcome={false} />)
    expect(html).toMatch(/<button[^>]*class="df-button df-button--primary"[^>]*disabled=""/)
    expect(textOf(html)).toContain('Finish the 6 items above first. Payment method and payout details can come later.')
  })

  it.each(['partner-support', 'partner-read-only', 'partner-finance'] as const)('shows %s the checklist but a disabled Submit with the reason', async (role) => {
    const html = await render(<Onboarding me={me(role)} onboarding={{ ...onboardingFor('awaiting', 'partner'), state: 'draft' }} staffSetup={false} welcome={false} />)
    expect(textOf(html)).toContain(words.refused.OWNERS_AND_ADMINS_ONLY)
    expect(html).toMatch(/<button[^>]*class="df-button df-button--primary"[^>]*disabled=""/)
  })

  it('says Done by DripFunnel only on items staff completed', async () => {
    const staffSetUp = await render(<Onboarding me={me()} onboarding={onboardingFor('draft', 'dripfunnel')} staffSetup={false} welcome={true} />)
    const byStaff = onboardingFor('draft', 'dripfunnel').items.filter((x) => x.doneBy === 'DripFunnel').length
    expect(staffSetUp.match(/Done by DripFunnel/g)?.length).toBe(byStaff)
    expect(textOf(staffSetUp)).toContain('Welcome, Jonas.')
    const ownSetup = await render(<Onboarding me={me()} onboarding={onboardingFor('draft', 'partner')} staffSetup={false} welcome={false} />)
    expect(ownSetup.match(/Done by DripFunnel/g)?.length).toBe(1)
    expect(textOf(ownSetup)).toContain('Done by Jonas')
  })

  it('locks payment method and payout details for a staff member in a setup session', async () => {
    const html = await render(<Onboarding me={me()} onboarding={onboardingFor('draft', 'dripfunnel')} staffSetup={true} welcome={false} />)
    const text = textOf(html)
    expect(text.match(/Kaufladen Digital enters this itself/g)?.length).toBe(2)
    expect(text).not.toContain(words.yourTurn)
    const owner = textOf(await render(<Onboarding me={me()} onboarding={onboardingFor('draft', 'dripfunnel')} staffSetup={false} welcome={false} />))
    expect(owner.match(/Your turn/g)?.length).toBe(2)
    const admin = textOf(await render(<Onboarding me={me('partner-admin')} onboarding={onboardingFor('draft', 'dripfunnel')} staffSetup={false} welcome={false} />))
    expect(admin.match(/Owner adds this/g)?.length).toBe(2)
  })
})

describe('the partner states', () => {
  it('shows what happens next while awaiting approval, with no Submit step', async () => {
    const html = await render(<Onboarding me={me()} onboarding={onboardingFor('awaiting', 'dripfunnel')} staffSetup={false} welcome={false} />)
    const text = textOf(html)
    expect(html).not.toContain('df-checklist-row--submit')
    expect(text).toContain(words.awaiting.title)
    expect(text).toContain('Submitted by DripFunnel on Sep 27, 2026.')
    expect(text).toContain('9 of 11 done')
    for (const step of words.awaiting.next) expect(text).toContain(step.title)
    expect(text).toContain(words.awaiting.note)
  })

  it('shows DripFunnel’s reason, the fix as a link and Submit again when sent back', async () => {
    const html = await render(<Onboarding me={me()} onboarding={onboardingFor('sentback', 'partner')} staffSetup={false} welcome={false} />)
    const text = textOf(html)
    expect(text).toContain(words.sentBack.title)
    expect(html).toMatch(/role="alert"/)
    expect(text).toContain('no Impressum')
    expect(html).toContain('href="/branding"')
    expect(text).toContain('Add an Impressum to your legal pages')
    expect(text).toContain(words.submitAgain)
  })

  it('announces the Live moment once with the sign-up link', async () => {
    const text = textOf(await render(<LiveMoment product="Kaufladen Shops" host="shop.kaufladen.de" />))
    expect(text).toContain('Kaufladen Shops is live at shop.kaufladen.de.')
    expect(text).toContain('shop.kaufladen.de/signup')
  })
})
