import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Partner } from '../../api/partners'
import { createSampleServer, samplePartners } from '../../api/partnersSample'
import type { StaffRole } from '../shell/staffRoles'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { actionDialog } from './actionDialog'
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
    expect(actionDialog('setupSession', partner('ts')).reason?.label).toBe(words.dialogs.setupSession.reason)
    expect(actionDialog('pause', partner('ns')).consequence).toBe('No new merchant signups. Its 86 stores keep running.')
  })

  it('shows read-only panels in the info palette, never the warning one', async () => {
    for (const tab of ['branding', 'plans', 'domains'] as const) {
      const html = await render({ tab })
      expect(html, tab).toContain('df-info-note')
      expect(html, tab).not.toContain('df-state--warning')
    }
  })

  it('lists the setup checklist with who did each item', async () => {
    const text = textOf(await render())
    expect(text).toContain('Done by Priya (DripFunnel)')
    expect(text).toContain('Kaufladen Digital enters this itself')
    expect(text).toContain('Sent back by Maya Ortiz: Legal pages missing an Impressum')
  })

  it('shows Impersonate disabled, with the reason, until impersonation is connected', async () => {
    const html = await render({ tab: 'team' })
    expect(html).toMatch(/<button type="button" class="df-button" disabled=""[^>]*>Impersonate<\/button>/)
    expect(textOf(html)).toContain(words.team.impersonateUnavailable)
  })

  it('offers the held invitation on the Team tab', async () => {
    expect(textOf(await render({ partner: partner('nl'), tab: 'team' }))).toContain(words.actions.sendInvite)
  })

  it('formats plan prices as money, and says when one is not priced', async () => {
    const text = textOf(await render({ tab: 'plans' }))
    expect(text).toContain('€25.00 / month')
    expect(text).toContain(words.plans.notPriced)
  })

  it('says a partner that does not exist cannot be found', async () => {
    expect(textOf(await render({ partner: null }))).toContain(words.notFound.title)
  })

  it.each(['loading', 'error'] as const)('renders the %s state without the partner', async (forced) => {
    const text = textOf(await render({ forced }))
    expect(text).not.toContain('Kaufladen Digital')
  })
})
