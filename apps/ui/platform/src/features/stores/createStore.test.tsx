import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Me } from '../../api/me'
import type { ProvisioningProgress } from '../../api/stores'
import { createStoresServer, sampleStores } from '../../api/storesSample'
import { formatWait, messages } from '../../messages'
import type { PartnerRole } from '../shell/partnerRoles'
import { CreateStore } from './CreateStore'
import { ProvisioningPanel } from './ProvisioningPanel'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')
const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/stores/new'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const owner: Me = { id: 'pu-1', name: 'Maya Ortiz', email: 'maya@northstar.com', role: 'partner-owner', partner: { id: 'p-1', name: 'Northstar Commerce', product: 'Northstar Shops', host: 'store.northstar.com', state: 'live' } }
const server = createStoresServer(sampleStores)
const words = messages.stores.new
const form = (role: PartnerRole, state: Me['partner']['state'] = 'live') =>
  render(<CreateStore me={{ ...owner, role }} form={server.form(role, state)} forced={null} onCreate={() => Promise.reject(new Error('not in this test'))} progressOf={() => Promise.reject(new Error('not in this test'))} />)

describe('Create store', () => {
  it('asks for the prototype’s fields, prices the plan in the country’s currency and says the owner gets an invitation', async () => {
    const html = await form('partner-owner')
    const text = textOf(html)
    for (const label of Object.values(words.fields)) if (label !== words.fields.namePlaceholder) expect(text).toContain(label)
    expect(text).toContain('$29.00 / month, charged by DripFunnel for Northstar, after a 14-day trial.')
    expect(text).toContain('Starter · $29.00 / month')
    expect(text).toContain(words.invitation)
    expect(text).toContain('Merchants can also sign up at store.northstar.com/signup.')
    expect(html).toMatch(/<button type="submit"[^>]*>Create store<\/button>/)
  })

  it('is refused with the reason for Finance, Support and Read-only, and before the partner is live', async () => {
    for (const role of ['partner-support', 'partner-finance', 'partner-read-only'] as const) {
      const html = await form(role)
      expect(html).toMatch(/<button type="button"[^>]*disabled=""[^>]*>Create store<\/button>/)
      expect(textOf(html)).toContain(messages.stores.refused.OWNERS_AND_ADMINS_ONLY)
    }
    expect(textOf(await form('partner-owner', 'draft'))).toContain('Stores can be created once Northstar Shops is live.')
  })

  it('shows the signup steps as they run, then the way into the store', async () => {
    const running: ProvisioningProgress = {
      steps: [
        { key: 'account', state: 'done' },
        { key: 'store', state: 'running' },
        { key: 'portal', state: 'waiting' },
        { key: 'storefront', state: 'waiting' },
        { key: 'done', state: 'waiting' },
      ],
      done: false,
      elapsedSeconds: 1,
    }
    const panel = (progress: ProvisioningProgress) => render(<ProvisioningPanel storeId="st-cascade" storeName="Cascade Coffee" ownerName="Rin Ota" progress={progress} onAgain={() => undefined} />)
    const text = textOf(await panel(running))
    expect(text).toContain('Setting up Cascade Coffee')
    expect(text).toContain(words.setup.note)
    for (const step of Object.values(words.setup.steps)) expect(text).toContain(step)
    expect(text).toContain(words.setup.states.running)
    const finished = await panel({ ...running, steps: running.steps.map((step) => ({ ...step, state: 'done' })), done: true, elapsedSeconds: 102 })
    expect(textOf(finished)).toContain(`Ready in ${formatWait(102)}. Rin Ota has an invitation to set their password.`)
    expect(finished).toContain('href="/stores/st-cascade"')
    expect(textOf(finished)).toContain(words.setup.again)
  })
})
