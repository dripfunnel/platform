import type { ReactElement } from 'react'
import { act, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { ApiError, type ApiClient } from '../../graphql'
import { fakeApi, type Call } from '../../testing/fakeApi'
import { actingAs, press, pressableNamed, pressablesNamed, renderShell } from '../../testing/harness'

// What the supplier tests share. Each test file mocks `expo-router`, safe-area, netinfo and `../../session` itself (jest hoists a mock to its own file).

export { ApiError }
export const mockSession: { client: ApiClient | null } = { client: null }

// The fake network answers over several promise turns; jest-expo runs timers faked, so wait on promises, not on a timer.
export const settle = async () => {
  for (let i = 0; i < 4; i += 1) await act(async () => void (await Promise.all(Array.from({ length: 12 }, () => Promise.resolve()))))
}

type Json = Record<string, unknown>
export type Handlers = Record<string, (variables: Json, headers: Record<string, string>) => unknown>

// The permissions each tier holds (apps/api src/auth/storePermissions.ts); a Supplier admin adds `supplier.team`.
const everyTier = ['catalog.read', 'stock.read', 'stock.write', 'warehouses.write', 'exports.products']
const writesCatalogue = [...everyTier, 'catalog.write', 'catalog.import']
const readsOrders = [...writesCatalogue, 'orders.read', 'sales.read', 'exports.orders']
export const tiers = {
  stock: [...everyTier, 'catalog.propose'],
  catalogue: writesCatalogue,
  ordersRead: readsOrders,
  ordersFulfil: [...readsOrders, 'orders.fulfil', 'orders.refund'],
}

export const access = (permissions: string[], seller: { id: string } | null = { id: 's-1' }) => ({ me: { acting: { permissions, seller } } })

export const supplierSeat = (tier: keyof typeof tiers, admin = false) =>
  actingAs(admin ? 'supplier-admin' : 'supplier-member', { stock: 'vendor-stock', catalogue: 'vendor-catalogue', ordersRead: 'vendor-orders-read', ordersFulfil: 'vendor-orders-fulfil' }[tier])

export const show = async (screen: ReactElement, handlers: Handlers, options: Parameters<typeof renderShell>[1] = {}): Promise<{ renderer: ReactTestRenderer; calls: Call[] }> => {
  const { client, calls } = fakeApi(handlers, { supplier: 's-1' })
  mockSession.client = client
  const renderer = await renderShell(screen, options)
  await settle()
  return { renderer, calls }
}

export const asked = (calls: Call[], text: string): Call[] => calls.filter((call) => call.query.includes(text))

export const click = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressableNamed(renderer, label))
  await settle()
}

// The last button of that name is the one in the sheet that opened over the screen.
export const clickLast = async (renderer: ReactTestRenderer, label: string) => {
  await press(pressablesNamed(renderer, label).at(-1) as ReactTestInstance)
  await settle()
}

export const type = async (renderer: ReactTestRenderer, label: string, value: string) => {
  const found = renderer.root.findAll((node) => node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0]
  if (!found) throw new Error(`no field named "${label}"`)
  await act(async () => found.props.onChangeText(value))
}

export const page = (nodes: unknown[], next: string | null = null) => ({ nodes, pageInfo: { hasNextPage: next !== null, hasPreviousPage: false, startCursor: null, endCursor: next } })
