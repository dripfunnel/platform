import type { ReactElement } from 'react'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import type { ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { press, pressableNamed, pressablesNamed, renderShell } from '../../testing/harness'

/** The client the screens under test get from `sessionClient()` (each test file's jest.mock of ../../session reads it). */
export const session: { client: ApiClient | null } = { client: null }

// The fake network answers over several promise turns; jest-expo runs timers faked, so wait on promises, not on a timer.
export const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

export type Handlers = Record<string, (variables: Record<string, unknown>, headers: Record<string, string>) => unknown>
export type Options = Parameters<typeof renderShell>[1]

export const paged = <T,>(nodes: T[], extra: Record<string, unknown> = {}) => ({ nodes, ...extra, pageInfo: { hasNextPage: false, hasPreviousPage: false, startCursor: null, endCursor: null } })
export const noRule = { text: null, valueId: null, productId: null, versionId: null, currency: null, min: null, max: null }
export const valueRule = (valueId: string) => ({ ...noRule, kind: 'filter_value', valueId })

export const filters = [
  { id: 'f-fabric', name: 'Fabric', position: 0, revision: 2, shopperVisible: true, values: [{ id: 'linen', name: 'Linen', products: 9 }, { id: 'cotton', name: 'Cotton', products: 14 }] },
  { id: 'f-occasion', name: 'Occasion', position: 1, revision: 1, shopperVisible: true, values: [{ id: 'wedding', name: 'Wedding', products: 4 }] },
  { id: 'f-colour', name: 'Colour', position: 2, revision: 1, shopperVisible: true, values: [{ id: 'off-white', name: 'Off-white', products: 6 }, { id: 'off white', name: 'Off white', products: 2 }] },
  { id: 'f-reorder', name: 'Reorder soon', position: 3, revision: 1, shopperVisible: false, values: [{ id: 'yes', name: 'Yes', products: 2 }] },
]

export const summary = (id: string, name: string, over: Record<string, unknown> = {}) => ({ id, name, kind: 'manual', visible: true, parentId: null, inheritParent: false, match: 'all', rules: [], products: 0, computedAt: '2026-10-05T09:00:00Z', ...over })
export const collections = [
  summary('c-summer', 'Summer edit', { kind: 'automatic', rules: [valueRule('linen'), valueRule('cotton')], products: 18 }),
  summary('c-men', 'Men', { products: 42 }),
  summary('c-shirts', 'Shirts', { parentId: 'c-men', inheritParent: true, kind: 'automatic', rules: [valueRule('linen')], products: 12 }),
  summary('c-wedding', 'Wedding guest', { kind: 'automatic', rules: [valueRule('wedding')], products: 7, computedAt: null }),
  summary('c-offer', 'Staff picks', { visible: false, products: 5 }),
]

export const full = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  name: 'Summer edit',
  slug: 'summer-edit',
  description: 'Light things',
  kind: 'automatic',
  match: 'all',
  parentId: null,
  inheritParent: false,
  visible: true,
  imageAssetId: 'img-1',
  sort: 'newest',
  seoTitle: 'Summer',
  seoDescription: null,
  revision: 4,
  rules: [valueRule('linen')],
  ...over,
})

export const owner = ['catalog.read', 'catalog.write']
export const readOnlyState = { readOnly: true, status: null, trialEndsAt: null, pastDueSince: null, provisioning: null, support: null }

export const base = (over: { permissions?: string[]; seller?: { id: string } | null; collections?: unknown[]; countries?: string[]; features?: unknown[] } = {}): Handlers => ({
  'acting { permissions': () => ({ me: { acting: { permissions: over.permissions ?? owner, seller: over.seller ?? null } } }),
  'collections(first': () => ({ collections: paged(over.collections ?? collections) }),
  'facets(first': () => ({ facets: paged(filters) }),
  catalogueSettings: () => ({ catalogueSettings: { pricingCurrency: 'INR', unitSystem: 'metric', features: over.features ?? [{ key: 'sizeCharts', enabled: true, inPlan: true }] } }),
  'markets(first': () => ({ markets: paged([{ active: true, countries: over.countries ?? ['ZZ'] }]) }),
})

export const show = async (element: ReactElement, handlers: Handlers, options: Options & { supplier?: string } = {}) => {
  const { client, calls } = fakeApi(handlers, { supplier: options.supplier ?? null })
  session.client = client
  const renderer = await renderShell(element, options)
  await settle()
  return { renderer, calls }
}

export const input = (renderer: ReactTestRenderer, label: string) => {
  const found = renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!found) throw new Error(`no field named "${label}"`)
  return found
}
export const type = async (renderer: ReactTestRenderer, label: string, value: string) => {
  await act(async () => input(renderer, label).props.onChangeText(value))
}
// The live preview and the product search ask a moment after typing stops.
export const pause = async () => {
  await act(async () => void jest.advanceTimersByTime(400))
  await settle()
}
export const asked = (calls: Call[], text: string) => calls.filter((call) => call.query.includes(text))
export const tab = async (renderer: ReactTestRenderer, name: string) => {
  await press(pressablesNamed(renderer, name).find((node) => node.props.accessibilityRole === 'tab') ?? pressableNamed(renderer, name))
  await settle()
}
