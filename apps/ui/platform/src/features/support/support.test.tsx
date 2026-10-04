import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { partnerRoles } from '../shell/partnerRoles'
import { fill, messages } from '../../messages'
import { storeAs } from '../stores/storesTestData'
import { SupportTab } from '../stores/tabs/SupportTab'
import { SessionsTab } from './SessionsTab'
import { codeComplete, firstStep } from './startFlow'
import { SupportRefused } from './Support'
import { session, target } from './supportTestData'
import { refusalText, supportAllowed } from './supportText'
import { UsersTab } from './UsersTab'

const words = messages.support
const noop = () => undefined
const textOf = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, '’').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ')
const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/support'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const more = { show: false, busy: false, failed: false }
const usersTab = (users: Parameters<typeof UsersTab>[0]['users'], search?: string) =>
  render(<UsersTab users={users} search={search} partner="Northstar Commerce" me="Priya Shah" more={more} onSearch={noop} onMore={noop} onOpen={noop} />)

describe('Support access', () => {
  it('is for Owners, Admins and Support only', () => {
    expect(partnerRoles.filter(supportAllowed)).toEqual(['partner-owner', 'partner-admin', 'partner-support'])
  })

  it('says why a role or a staff session has no Support', async () => {
    const text = textOf(await render(<SupportRefused reason={fill(words.denied, { role: 'Finance' })} />))
    expect(text).toContain('Your role (Finance) has no Support.')
  })
})

describe('Users', () => {
  it('shows the rules with the partner and the caller, and each user’s store and role', async () => {
    const text = textOf(await usersTab([target(), target({ membershipId: 'm2', name: 'Ola Berg', type: 'supplier', role: 'supplier-admin', supplier: 'Loomcraft' })]))
    expect(text).toContain('No extension. Start a new session if you need more time.')
    expect(text).toContain('“Northstar support (Priya) is signed in as Jenna. Ends in 28 min.”')
    expect(text).toContain('Juniper & Co. Owner')
    expect(text).toContain('Supplier admin for Loomcraft')
    expect(text).toContain(words.types.supplier)
    expect(text).toContain(words.open)
  })

  it('words every refusal by code, beside a disabled button', async () => {
    const off = target({ start: { allowed: false, reason: 'SUPPORT_OFF' }, storeOwner: 'Jenna Park' })
    expect(refusalText('SUPPORT_OFF', off)).toBe('Jenna Park has turned off partner support for Juniper & Co.. Ask them to turn it on in Settings › Support access.')
    expect(refusalText('SUPPORT_OFF', target())).toBe(fill(words.refusals.SUPPORT_OFF_NO_OWNER, { store: 'Juniper & Co.' }))
    expect(refusalText('NOT_ACCEPTED', target())).toBe('Jenna hasn’t accepted the invitation yet.')
    expect(refusalText('SUSPENDED', target())).toBe('Jenna’s account is suspended in Juniper & Co..')
    expect(refusalText('STORE_CANCELLED', target())).toBe('Juniper & Co. is cancelled.')
    expect(refusalText('COLLEAGUE_IN_SESSION', target({ colleague: { name: 'Sam Lee', minutesLeft: 12 } }))).toBe('Sam Lee is signed in as Jenna now. Ends in 12 min.')
    const html = await usersTab([off])
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Open support session/)
    expect(textOf(html)).toContain('Ask them to turn it on in Settings › Support access.')
  })

  it('offers Return to session on the caller’s own, and says when nothing matches', async () => {
    expect(textOf(await usersTab([target({ mySessionId: 'ss1' })]))).toContain(words.returnTo)
    expect(textOf(await usersTab([], 'zed'))).toContain(words.noMatch)
    expect(textOf(await usersTab([]))).toContain(words.noUsers)
  })
})

describe('Starting a session', () => {
  it('opens in the prototype’s order: already in it, refused, busy elsewhere, then why', () => {
    expect(firstStep(target({ mySessionId: 'ss1' }), session())).toBe('return')
    expect(firstStep(target({ start: { allowed: false, reason: 'SUSPENDED' } }), null)).toBe('blocked')
    expect(firstStep(target(), session())).toBe('busy')
    expect(firstStep(target(), null)).toBe('why')
  })

  it('takes only a full 6-digit code', () => {
    expect(codeComplete('123456')).toBe(true)
    expect(codeComplete('12345')).toBe(false)
    expect(codeComplete('12345a')).toBe(false)
  })
})

describe('Sessions', () => {
  const now = Date.parse('2026-10-04T10:18:00.000Z')

  it('shows the open ones with minutes left, Return to tab on yours and End when allowed', async () => {
    const theirs = session({ id: 'ss2', you: false, agent: { id: 'p2', name: 'Sam Lee' }, return: { allowed: false, reason: 'NOT_SESSION_OWNER' }, end: { allowed: false, reason: 'NOT_SESSION_OWNER' } })
    const html = await render(<SessionsTab open={[session(), theirs]} history={[]} now={now} more={more} onReturn={noop} onEnd={noop} onMore={noop} />)
    const text = textOf(html)
    expect(text).toContain('12 min left')
    expect(text.match(new RegExp(words.returnToTab, 'g'))).toHaveLength(1)
    expect(text).toContain('Sam Lee')
    expect(text).toContain(words.refusals.NOT_SESSION_OWNER)
    expect(html).toContain('href="https://help.northstar.example/t/48213"')
    expect(text).toContain(words.noHistory)
  })

  it('shows the history: ended by whom, or expired, and never links a ticket that isn’t https', async () => {
    const ended = session({ id: 'h1', endedAt: '2026-10-04T10:20:00.000Z', endedBy: 'colleague', endedByName: 'Maya Chen', ticket: 'javascript:alert(1)' })
    const expired = session({ id: 'h2', endedAt: '2026-10-04T10:30:00.000Z', endedBy: 'expired' })
    const html = await render(<SessionsTab open={[]} history={[ended, expired]} now={now} more={more} onReturn={noop} onEnd={noop} onMore={noop} />)
    const text = textOf(html)
    expect(text).toContain(words.noOpen)
    expect(text).toContain('Ended by Maya Chen')
    expect(text).toContain(words.endedBy.expired)
    expect(html).not.toContain('href="javascript')
  })
})

describe('A store’s Support tab', () => {
  it('starts the same flow per person, and only when the caller may and the merchant allows', async () => {
    const store = storeAs('st-juniper')
    const tab = (allowed: boolean, onStart?: () => void) => render(<SupportTab store={{ ...store, support: { ...store.support, allowed } }} partner="Northstar" onStart={onStart} />)
    expect(textOf(await tab(true, noop))).toContain(words.open)
    expect(textOf(await tab(true))).toContain(messages.store.support.readOnly)
    expect(textOf(await tab(false, noop))).not.toContain(words.open)
  })
})
