import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Partner } from '../../api/partners'
import { createSampleServer, samplePartners } from '../../api/partnersSample'
import { staffRoles, type StaffRole } from '../shell/staffRoles'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { actionDialog } from './actionDialog'
import { startingContract } from './ContractDialog'
import { PartnerDetail, type PartnerDetailProps } from './PartnerDetail'
import { partnerTabs } from './PartnerTabs'

const words = messages.partner
const sample = createSampleServer(samplePartners)
const noop = () => undefined

const partner = (id: string, role: StaffRole = 'staff-super-admin'): Partner => {
  const found = sample.get(id, role)
  if (!found) throw new Error(`No sample partner ${id}`)
  return found
}

const render = async (props: Partial<PartnerDetailProps> = {}) => {
  const rootRoute = createRootRoute({
    component: () => (
      <PartnerDetail
        partner={partner('kl')}
        tab="overview"
        forced={null}
        readOnly={false}
        onAction={noop}
        onRecheck={() => Promise.resolve()}
        onSetContract={noop}
        onImpersonate={noop}
        onReload={noop}
        activity={null}
        {...props}
      />
    ),
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/partners/kl'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

describe('Partner detail', () => {
  it('has the seven tabs FIRST-RELEASE.md §4.2 lists, and no Setup tab', async () => {
    const text = textOf(await render())
    for (const tab of partnerTabs) expect(text).toContain(words.tabs[tab])
    expect(partnerTabs).toHaveLength(7)
    expect(partnerTabs).not.toContain('setup')
  })

  it('shows Approve once, disabled with the failing check as visible text', async () => {
    const html = await render()
    expect(html.match(/>Approve<\/button>/g)).toHaveLength(1)
    expect(html).toMatch(/<button type="button" class="df-button" disabled=""[^>]*>Approve<\/button>/)
    expect(textOf(html)).toContain('1 go-live check failing: Email domain verified.')
    expect(html).not.toContain('Go-live checks')
  })

  it('shows Pause disabled with the reason to a Partner manager, and says why the house partner has none', async () => {
    expect(textOf(await render({ partner: partner('ns', 'staff-partner-manager') }))).toContain('Only a Super admin can pause a partner.')
    expect(textOf(await render({ partner: partner('df') }))).toContain('DripFunnel is the house partner and can’t be paused.')
  })

  it('shows the contract on Overview, or that there is none with Set contract, and the refusal to a role that may not set it', async () => {
    const contract = words.contract
    const kaufladen = textOf(await render())
    expect(kaufladen).toContain('EUR · Euro')
    expect(kaufladen).toContain(contract.poweredByTerms.firstYear)
    expect(kaufladen).toContain(contract.change)

    const bazaar = await render({ partner: partner('bz') })
    expect(textOf(bazaar)).toContain(contract.none)
    expect(bazaar).toMatch(/<button type="button" class="df-button df-button--primary">Set contract<\/button>/)
    expect(textOf(await render({ partner: partner('bz', 'staff-support') }))).toContain('Only a Super admin or Partner manager can set contracts.')
  })

  it('starts a partner with no contract from its country’s currency, at the strictest terms', () => {
    expect(startingContract({ contract: null, country: 'IN' })).toEqual({ feeCurrency: 'INR', currencies: [], poweredBy: 'required' })
    expect(startingContract({ contract: null, country: null })).toEqual({ feeCurrency: 'USD', currencies: [], poweredBy: 'required' })
    expect(startingContract(partner('ns'))).toEqual({ feeCurrency: 'USD', currencies: ['CAD'], poweredBy: 'removable' })
  })

  it('asks for a reason on all four state actions, Resume included, and never for the name typed', () => {
    const paused: Partner = { ...partner('ns'), state: 'paused' }
    for (const [action, target] of [
      ['approve', partner('kl')],
      ['sendBack', partner('kl')],
      ['pause', partner('ns')],
      ['resume', paused],
    ] as const) {
      const dialog = actionDialog(action, target)
      expect(dialog.reason, action).toBeDefined()
      expect(dialog).not.toHaveProperty('typeToConfirm')
    }
    expect(actionDialog('pause', partner('ns')).consequence).toBe('No new merchant signups. Its 86 stores keep running.')
  })

  it('shows read-only panels in the info palette, never the warning one', async () => {
    for (const tab of ['branding', 'plans', 'domains'] as const) {
      const html = await render({ tab })
      expect(html, tab).toContain('df-info-note')
      expect(html, tab).not.toContain('df-state--warning')
    }
  })

  it('lists the setup checklist with who did each item and the API line for it', async () => {
    const text = textOf(await render())
    expect(text).toContain('Done by Priya (DripFunnel)')
    expect(text).toContain('shop.kaufladen.de is live')
    expect(text).toContain('Add the bank account DripFunnel pays you into')
    expect(text).toContain('7 of 9')
    expect(text).toContain('Sent back by Maya Ortiz: Legal pages missing an Impressum')
  })

  it('words a history entry it has no words for by its code, never silently', async () => {
    const odd: Partner = { ...partner('kl'), history: [{ at: '2026-09-27T00:00:00Z', action: 'partner.renamed', by: 'Arjun Menon', note: null }] }
    expect(textOf(await render({ partner: odd }))).toContain('partner.renamed by Arjun Menon')
  })

  it('offers Impersonate on the Team tab as the API allows it, with the reason when refused', async () => {
    const html = await render({ tab: 'team' })
    expect(html).toMatch(/<button type="button" class="df-button">Impersonate<\/button>/)
    const finance = await render({ partner: partner('kl', 'staff-finance'), tab: 'team' })
    expect(finance).toMatch(/<button type="button" class="df-button" disabled=""[^>]*>Impersonate<\/button>/)
    expect(textOf(finance)).toContain(messages.impersonate.refusals.STAFF_ROLE_NOT_ALLOWED)
  })

  it('offers the setup session to Super admins and Partner managers only, and leaves it out for the rest', async () => {
    for (const role of staffRoles) {
      const html = await render({ partner: partner('ts', role) })
      expect(textOf(html).includes(words.actions.setupSession), role).toBe(role === 'staff-super-admin' || role === 'staff-partner-manager')
    }
  })

  it('offers the held invitation on the Team tab', async () => {
    expect(textOf(await render({ partner: partner('nl'), tab: 'team' }))).toContain(words.actions.sendInvite)
  })

  it('shows each plan with its status and limits, and no price until the plans card prices them', async () => {
    const text = textOf(await render({ tab: 'plans' }))
    expect(text).toContain(words.plans.statuses.draft)
    expect(text).toContain('Up to 500 products · 2 staff')
    expect(text).not.toMatch(/[$€£₹]/)
  })

  it('says a partner that does not exist cannot be found', async () => {
    expect(textOf(await render({ partner: null }))).toContain(words.notFound.title)
  })

  it.each(['loading', 'error'] as const)('renders the %s state without the partner', async (forced) => {
    const text = textOf(await render({ forced }))
    expect(text).not.toContain('Kaufladen Digital')
  })
})
