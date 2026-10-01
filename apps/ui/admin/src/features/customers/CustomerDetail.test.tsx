import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createCustomersServer, sampleCustomers } from '../../api/customersSample'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import type { StaffRole } from '../shell/staffRoles'
import { CustomerDetail, type CustomerDetailProps } from './CustomerDetail'

const words = messages.customer
const sample = createCustomersServer(sampleCustomers, () => '2026-09-30T00:00:00Z')
const noop = () => undefined

const customerOf = (id: string, role: StaffRole = 'staff-super-admin') => sample.get(id, role)

const render = async (props: Partial<CustomerDetailProps> = {}) => {
  const rootRoute = createRootRoute({
    component: () => <CustomerDetail customer={customerOf('c1')} tab="overview" forced={null} readOnly={false} onReload={noop} {...props} />,
  })
  const router = createRouter({ routeTree: rootRoute, history: createMemoryHistory({ initialEntries: ['/customers/c1'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

describe('Customer detail', () => {
  it('shows full contacts when the API sent them, with whether each is verified', async () => {
    const text = textOf(await render({ customer: customerOf('c1', 'staff-support') }))
    expect(text).toContain('priya.sharma@example.com')
    expect(text).toContain('+91 98765 43210')
    expect(text).toContain(words.overview.verified)
    expect(text).not.toContain(words.overview.masked)
  })

  it('shows masked contacts as they came, and says who may see them in full', async () => {
    const html = await render({ customer: customerOf('c1', 'staff-read-only'), readOnly: true })
    expect(html).not.toContain('priya.sharma@example.com')
    expect(html).not.toContain('98765 43210')
    expect(textOf(html)).toContain('pr***@example.com')
    expect(textOf(html)).toContain(words.overview.masked)
    expect(textOf(html)).toContain(messages.customers.readOnly.title)
  })

  it('says in the header that the view is recorded, and links the store and partner', async () => {
    const html = await render()
    expect(textOf(html)).toContain(words.meta.recorded)
    expect(html).toContain('href="/stores/s1"')
    expect(html).toContain('href="/partners/bz"')
    expect(textOf(html)).toContain('Customer · Bazaar Cloud › Mehta Textiles')
  })

  it('keeps nothing personal on a deleted customer, and says why', async () => {
    const text = textOf(await render({ customer: customerOf('c5', 'staff-support') }))
    expect(text).toContain(messages.customers.deletedName)
    expect(text).toContain('asked for their data to be deleted on Aug 12, 2026')
    expect(text).toMatch(/^[^A-Za-z]*Customers›Deleted customer—/)
    expect(text).not.toContain(words.overview.masked)
  })

  it('says when the store is suspended and its customers cannot sign in', async () => {
    expect(textOf(await render({ customer: customerOf('c6') }))).toContain('Redline Moto Parts is suspended')
  })

  it('never shows addresses, order contents or payment details, and offers no action', async () => {
    const html = await render()
    expect(textOf(html)).toContain(words.overview.never)
    expect(textOf(html)).toContain('12 orders')
    expect(html).not.toContain('<button')
  })

  it('has Overview and Activity tabs', async () => {
    const text = textOf(await render({ tab: 'activity' }))
    expect(text).toContain(words.tabs.overview)
    expect(text).toContain(words.activity.placeholder)
  })

  it('renders not found and the harness states', async () => {
    expect(textOf(await render({ customer: null }))).toContain(words.notFound.title)
    expect(await render({ forced: 'loading' })).toContain('df-skeleton')
    expect(textOf(await render({ forced: 'error' }))).toContain(words.error.title)
  })
})
