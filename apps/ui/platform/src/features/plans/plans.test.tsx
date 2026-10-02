import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Me } from '../../api/me'
import { createPlansServer, samplePlans } from '../../api/plansSample'
import { messages } from '../../messages'
import type { PartnerRole } from '../shell/partnerRoles'
import { PlanEditor } from './PlanEditor'
import { draftOf, inputOf, isDirty, minorOf, rowsAboveCeiling } from './planDraft'
import { retireDialog, retireInput, saveDialog } from './planDialogs'
import { Plans } from './Plans'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => (match[1] ?? '').replace(/&amp;/g, '&'))
const render = async (element: ReactNode, path = '/plans') => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: [path] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const owner: Me = { id: 'pu-1', name: 'Maya Ortiz', email: 'maya@northstar.com', role: 'partner-owner', partner: { id: 'p-1', name: 'Northstar Commerce', product: 'Northstar Shops', host: 'store.northstar.com', state: 'live' } }
const server = createPlansServer(samplePlans)
const noop = () => undefined
const words = messages.plans

const editorFor = (id: string | null, role: PartnerRole = 'partner-owner') => {
  const editor = server.editor(id, role)
  if (!editor) throw new Error(String(id))
  return editor
}

describe('the Plans list', () => {
  it('shows every plan with its prices per currency, the fee, trial, stores and status, and New plan for Owners', async () => {
    const html = await render(<Plans me={owner} page={server.list('partner-owner')} forced={null} onReload={noop} />)
    const text = textOf(html)
    for (const column of Object.values(words.columns)) expect(text).toContain(column)
    expect(text).toContain('$49.00 / month · $490.00 / year')
    expect(text).toContain('CA$65.00 / month · CA$650.00 / year')
    expect(text).toContain('DripFunnel’s fee $18.00 / store / month')
    expect(text).toContain('14 days')
    expect(text).toContain(words.statuses.retired)
    expect(hrefs(html)).toContain('/stores?plan=growth')
    expect(hrefs(html)).toContain('/plans/growth')
    expect(hrefs(html)).toContain('/plans/new')
    expect(text).toContain('charged by DripFunnel for Northstar')
  })

  it('disables New plan with the reason for Finance, Support and Read-only', async () => {
    for (const role of ['partner-finance', 'partner-support', 'partner-read-only'] as const) {
      const html = await render(<Plans me={{ ...owner, role }} page={server.list(role)} forced={null} onReload={noop} />)
      expect(hrefs(html)).not.toContain('/plans/new')
      expect(textOf(html)).toContain(words.refused.OWNERS_AND_ADMINS_ONLY)
    }
  })
})

describe('the plan editor', () => {
  const editor = editorFor('growth')
  const original = draftOf(editor.plan, editor.currencies, 14)
  const view = (props: Partial<Parameters<typeof PlanEditor>[0]> = {}) =>
    render(
      <PlanEditor me={owner} editor={editor} draft={original} original={original} quoted={editor.plan?.prices ?? []} forced={null} busy={false} onDraft={noop} onSave={noop} onDiscard={noop} onMakeLive={noop} onRetire={noop} onReload={noop} {...props} />,
      '/plans/growth',
    )

  it('shows the matrix with DripFunnel’s ceiling on every row and the margin from the fixture beside each price', async () => {
    const html = await view()
    const text = textOf(html)
    for (const row of Object.values(words.editor.rows)) expect(text).toContain(row)
    expect(text).toContain('DripFunnel max 20,000')
    expect(text).toContain('DripFunnel max 300 / month')
    expect(text).toContain(words.editor.poweredAllowed)
    expect(text).toContain('You keep $31.00 of $49.00')
    expect(text).toContain('DripFunnel’s fee CA$24.32 / month (converted at the contract rate)')
    expect(text).toContain('44 stores are on this plan.')
    expect(text).not.toContain(words.editor.unsaved)
  })

  it('marks a value above the ceiling, disables Save with the reason, and shows the save bar only when something changed', async () => {
    const draft = { ...original, numbers: { ...original.numbers, products: '25000' } }
    const html = await view({ draft })
    expect(isDirty(draft, original)).toBe(true)
    expect(rowsAboveCeiling(draft, editor.ceilings)).toEqual(['products'])
    expect(textOf(html)).toContain('Can’t be more than 20,000.')
    expect(textOf(html)).toContain('Products is above DripFunnel’s maximum.')
    expect(textOf(html)).toContain(words.editor.unsaved)
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save changes<\/button>/)
    expect(textOf(html)).toContain(words.editor.fixRows)
    expect(inputOf(draft)?.entitlements.products).toBe(25000)
  })

  it('lets Finance change prices only, with the reason on the rest', async () => {
    const finance = editorFor('growth', 'partner-finance')
    const html = await render(
      <PlanEditor me={{ ...owner, role: 'partner-finance' }} editor={finance} draft={original} original={original} quoted={finance.plan?.prices ?? []} forced={null} busy={false} onDraft={noop} onSave={noop} onDiscard={noop} onMakeLive={noop} onRetire={noop} onReload={noop} />,
      '/plans/growth',
    )
    expect(textOf(html)).toContain(words.editor.financeNote)
    expect(html).toMatch(/<input id="plan-name"[^>]*disabled=""/)
    expect(html).toMatch(/<input id="price-USD-monthly"(?![^>]*disabled)/)
    expect(html).toMatch(/<input class="df-matrix-input"[^>]*disabled=""/)
  })

  it('blocks a save while a limit is blank, as a new plan starts', async () => {
    const fresh = editorFor(null)
    const blank = draftOf(null, fresh.currencies, 14)
    const html = await render(
      <PlanEditor me={owner} editor={fresh} draft={{ ...blank, name: 'Scale' }} original={blank} quoted={[]} forced={null} busy={false} onDraft={noop} onSave={noop} onDiscard={noop} onMakeLive={noop} onRetire={noop} onReload={noop} />,
      '/plans/new',
    )
    expect(textOf(html)).toContain('Enter a value for Products, Staff seats, Suppliers, Languages, Currencies, “Publish now” presses, AI design prompts.')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Save changes<\/button>/)
    expect(inputOf({ ...blank, name: 'Scale' })).toBeNull()
  })

  it('reads prices as money and keeps a half-typed one as text', () => {
    expect(minorOf('49', 'USD')).toBe(4900)
    expect(minorOf('49.5', 'USD')).toBe(4950)
    expect(minorOf('', 'USD')).toBeNull()
    expect(minorOf('abc', 'USD')).toBe('invalid')
    expect(minorOf('4900', 'JPY')).toBe(4900)
    expect(minorOf('49.00', 'JPY')).toBe('invalid')
    expect(inputOf({ ...original, prices: { ...original.prices, USD: { monthly: 'abc', yearly: '' } } })).toBeNull()
  })

  it('asks the grandfathering question for a plan stores are on and names the stores a retirement affects', () => {
    const save = saveDialog('Growth', 44)
    expect(save.title).toBe('44 stores are on Growth. Who gets the change?')
    expect(save.choices?.[0]?.options.map((option) => option.value)).toEqual(['new', 'renewal'])
    expect(saveDialog('Scale', 0).consequence).toBe(words.dialogs.save.consequence)
    const retire = retireDialog('Growth', 44, editor)
    expect(retire.consequence).toBe('Growth disappears from signup now. 44 stores are on it.')
    expect(retire.choices?.map((choice) => choice.key)).toEqual(['keep', 'moveTo', 'on'])
    expect(retire.choices?.[1]?.when?.({ keep: 'move' })).toBe(true)
    expect(retire.choices?.[1]?.when?.({ keep: 'keep' })).toBe(false)
    expect(retireInput({ keep: 'move' })).toBeNull()
    expect(retireInput({ keep: 'move', moveTo: 'pro', on: '2026-11-01T00:00:00Z' })).toEqual({ keep: false, moveTo: 'pro', on: '2026-11-01T00:00:00Z' })
    expect(retireInput({ keep: 'keep' })).toEqual({ keep: true })
  })
})
