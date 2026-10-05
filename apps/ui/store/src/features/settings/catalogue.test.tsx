// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { optionalParam } from '@dripfunnel/shared/search'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { ProductBasics } from '../../api/productEditor'
import type { Acting } from '../../api/shell'
import { messages } from '../../messages'

// Settings › Catalogue driven as the Owner would (CatSettings): sections by plan, presets, badges.

const w = messages.settings.catalogue
const page = messages.settings

const settings = vi.hoisted(() => ({ saveSections: vi.fn(), saveBadge: vi.fn(), deleteBadge: vi.fn(), loadStoreInfo: vi.fn(), loadLocale: vi.fn() }))
vi.mock('../../api/settings', async (actual) => ({ ...(await actual<typeof import('../../api/settings')>()), ...settings }))
const editor = vi.hoisted(() => ({ loadProductBasics: vi.fn() }))
vi.mock('../../api/productEditor', async (actual) => ({ ...(await actual<typeof import('../../api/productEditor')>()), ...editor }))

const { SettingsPage } = await import('./SettingsPage')

const owner: Acting = { store: { id: 's1', name: 'Kesari' }, role: 'owner', tier: null, seller: null, plan: { id: 'p1', name: 'Growth' }, permissions: ['catalog.read', 'settings'] }

const keys = ['sizeCharts', 'specs', 'highlights', 'faqs', 'badges', 'related', 'aplus', 'video']
const basics = (on: string[], notInPlan: string[] = []): ProductBasics => ({
  pricingCurrency: 'INR',
  unitSystem: 'metric',
  mainLanguage: 'en-IN',
  translationLanguages: [],
  features: keys.map((key) => ({ key, enabled: on.includes(key), inPlan: !notInPlan.includes(key) })),
  badges: [
    { id: 'b1', label: 'New', rule: 'new_30_days', tone: 'ok' },
    { id: 'b2', label: 'Handmade', rule: 'manual', tone: 'neutral' },
  ],
})

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const dialog = () => within(document.querySelector('dialog') as HTMLElement)

const show = async (acting: Acting = owner, readOnly = false) => {
  const root = createRootRoute({ component: Outlet })
  const app = createRoute({ getParentRoute: () => root, id: '_app', loader: () => ({ acting, state: { readOnly } }), component: Outlet })
  const page = createRoute({ getParentRoute: () => app, path: '/settings', validateSearch: z.looseObject({ tab: optionalParam(z.enum(['store', 'people', 'supplier', 'warehouse', 'tax', 'markets', 'catalogue'])) }), component: SettingsPage })
  const billing = createRoute({ getParentRoute: () => app, path: '/billing', component: () => <p>Billing</p> })
  const router = createRouter({ routeTree: root.addChildren([app.addChildren([page, billing])]), history: createMemoryHistory({ initialEntries: ['/settings?tab=catalogue'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  await settle()
  await settle()
}

const toggle = (name: string) => screen.getByRole('switch', { name })

beforeEach(() => {
  editor.loadProductBasics.mockResolvedValue(basics(['sizeCharts', 'specs', 'badges'], ['video']))
  settings.saveSections.mockResolvedValue(undefined)
  settings.saveBadge.mockResolvedValue('b9')
  settings.deleteBadge.mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
})

describe('catalogue settings', () => {
  it('show each section switched as saved, the plan named, and a section the plan lacks locked with a way to see plans', async () => {
    await show()
    expect(screen.getByText('Your plan: Growth')).toBeTruthy()
    expect(toggle(w.sections.specs).getAttribute('aria-checked')).toBe('true')
    expect(toggle(w.sections.faqs).getAttribute('aria-checked')).toBe('false')
    expect((toggle(w.sections.video) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('link', { name: w.seePlans })).toBeTruthy()
  })

  it('switch sections by a preset or one at a time, then save them all together', async () => {
    await show()
    expect((screen.getByRole('button', { name: w.saveSections }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: w.presets.electronics }))
    fireEvent.click(toggle(w.sections.aplus))
    fireEvent.click(screen.getByRole('button', { name: w.saveSections }))
    await settle()
    const sent = settings.saveSections.mock.calls[0]?.[0] as { key: string; enabled: boolean }[]
    expect(Object.fromEntries(sent.map((f) => [f.key, f.enabled]))).toEqual({ sizeCharts: false, specs: true, highlights: true, faqs: true, badges: true, related: true, aplus: true, video: false })
    expect(screen.getByText(w.sectionsSaved)).toBeTruthy()
    expect((screen.getByRole('button', { name: w.saveSections }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('add a badge with when it shows, edit and delete one, and say why one was refused', async () => {
    await show()
    const badges = within(screen.getByRole('region', { name: w.badgesTitle }))
    expect(badges.getByText(w.rules.new_30_days)).toBeTruthy()
    fireEvent.click(badges.getByRole('button', { name: w.addBadge }))
    fireEvent.change(dialog().getByLabelText(w.badgeText), { target: { value: 'Organic' } })
    fireEvent.click(dialog().getByRole('button', { name: w.saveBadge }))
    await settle()
    expect(settings.saveBadge).toHaveBeenCalledWith(null, { label: 'Organic', rule: 'manual', tone: 'neutral' })
    expect(screen.getByText('“Organic” added — pick it on any product under Badges')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Edit “New”' }))
    fireEvent.change(dialog().getByRole('combobox'), { target: { value: 'few_left' } })
    fireEvent.click(dialog().getByRole('button', { name: w.saveBadge }))
    await settle()
    expect(settings.saveBadge).toHaveBeenLastCalledWith('b1', { label: 'New', rule: 'few_left', tone: 'peach' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete “Handmade”?' }))
    fireEvent.click(dialog().getByRole('button', { name: w.delete }))
    await settle()
    expect(settings.deleteBadge).toHaveBeenCalledWith('b2')
    settings.saveBadge.mockRejectedValueOnce(new ApiError('DUPLICATE_LABEL', 'dup'))
    fireEvent.click(screen.getByRole('button', { name: w.addBadge }))
    fireEvent.change(dialog().getByLabelText(w.badgeText), { target: { value: 'New' } })
    fireEvent.click(dialog().getByRole('button', { name: w.saveBadge }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(w.refused.DUPLICATE_LABEL)
  })

  it('say it’s loading, then show the error with a retry that reads the settings again', async () => {
    let finish: (b: ProductBasics) => void = () => undefined
    editor.loadProductBasics.mockReturnValueOnce(new Promise<ProductBasics>((resolve) => (finish = resolve)))
    await show()
    expect(screen.getByText(page.loading)).toBeTruthy()
    await act(async () => finish(basics(['specs'])))
    expect(toggle(w.sections.specs).getAttribute('aria-checked')).toBe('true')
    cleanup()
    editor.loadProductBasics.mockRejectedValueOnce(new Error('down'))
    await show()
    expect(screen.getByText(page.error.title)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: page.error.retry }))
    await settle()
    expect(toggle(w.sections.specs).getAttribute('aria-checked')).toBe('true')
  })

  it('let a read-only store look without changing anything', async () => {
    await show(owner, true)
    expect((toggle(w.sections.specs) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('button', { name: w.saveSections })).toBeNull()
    expect(screen.queryByRole('button', { name: w.addBadge })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Edit “New”' })).toBeNull()
    expect((screen.getByRole('button', { name: w.presets.clothing }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('say when there are no badges yet', async () => {
    editor.loadProductBasics.mockResolvedValue({ ...basics(['badges']), badges: [] })
    await show()
    expect(screen.getByText(w.noBadges)).toBeTruthy()
  })

  it('keep the switches as set when a save is refused, so it can be tried again', async () => {
    settings.saveSections.mockRejectedValueOnce(new ApiError('PLAN_LIMIT', 'plan'))
    await show()
    fireEvent.click(toggle(w.sections.faqs))
    fireEvent.click(screen.getByRole('button', { name: w.saveSections }))
    await settle()
    expect(screen.getByRole('alert').textContent).toBe(w.refused.PLAN_LIMIT)
    expect(toggle(w.sections.faqs).getAttribute('aria-checked')).toBe('true')
    expect((screen.getByRole('button', { name: w.saveSections }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('check a badge’s text before sending it: some text, and 18 characters at most', async () => {
    await show()
    fireEvent.click(screen.getByRole('button', { name: w.addBadge }))
    fireEvent.click(dialog().getByRole('button', { name: w.saveBadge }))
    expect(dialog().getByText(w.badgeMissing)).toBeTruthy()
    fireEvent.change(dialog().getByLabelText(w.badgeText), { target: { value: 'Nineteen characters' } })
    fireEvent.click(dialog().getByRole('button', { name: w.saveBadge }))
    expect(dialog().getByText(w.badgeLong)).toBeTruthy()
    expect(settings.saveBadge).not.toHaveBeenCalled()
  })

  it('read a section the plan no longer has as off, so saving the others never sends it on', async () => {
    editor.loadProductBasics.mockResolvedValue(basics(['specs', 'video'], ['video']))
    await show()
    expect(toggle(w.sections.video).getAttribute('aria-checked')).toBe('false')
    expect((screen.getByRole('button', { name: w.saveSections }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(toggle(w.sections.faqs))
    fireEvent.click(screen.getByRole('button', { name: w.saveSections }))
    await settle()
    const sent = settings.saveSections.mock.calls[0]?.[0] as { key: string; enabled: boolean }[]
    expect(sent.find((f) => f.key === 'video')?.enabled).toBe(false)
  })

  it('tell a seat that isn’t the owner to ask the owner, never offering plans', async () => {
    editor.loadProductBasics.mockResolvedValue(basics([], ['video', 'aplus']))
    await show({ ...owner, role: 'manager', permissions: ['catalog.read', 'settings'] })
    expect(screen.queryByRole('link', { name: w.seePlans })).toBeNull()
    expect(screen.getAllByText(w.askOwner)).toHaveLength(2)
    expect(screen.queryByRole('region', { name: w.badgesTitle })).toBeNull()
  })
})
