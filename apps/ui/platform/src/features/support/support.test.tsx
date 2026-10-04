import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { partnerRoles } from '../shell/partnerRoles'
import { fill, messages } from '../../messages'
import { storeAs } from '../stores/storesTestData'
import { SupportTab } from '../stores/tabs/SupportTab'
import { SessionsTab } from './SessionsTab'
import { blockingSession, codeComplete, firstStep, openIn, startWith, type OpeningTab } from './startFlow'
import { reauthText } from './StartSupportDialog'
import { SupportRefused } from './Support'
import { session, target } from './supportTestData'
import { refusalText, supportAllowed, supportStartOffered } from './supportText'
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

  it('offers a store tab’s start to those roles only, and never in a staff session', () => {
    expect(partnerRoles.filter((role) => supportStartOffered(role, false))).toEqual(['partner-owner', 'partner-admin', 'partner-support'])
    expect(partnerRoles.filter((role) => supportStartOffered(role, true))).toEqual([])
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

  it('words a refused code from the API’s facts only, never an invented lock time', () => {
    expect(reauthText({ ok: false, reason: 'LOCKED', triesLeft: null, lockedMinutes: 10 })).toBe('Too many wrong codes. Try again in 10 min.')
    expect(reauthText({ ok: false, reason: 'LOCKED', triesLeft: null, lockedMinutes: null })).toBe(words.start.reauth.LOCKED_NO_TIME)
    expect(reauthText({ ok: false, reason: 'WRONG_CODE', triesLeft: 2, lockedMinutes: null })).toContain('2 more tries')
    expect(reauthText({ ok: false, reason: 'WRONG_CODE', triesLeft: 0, lockedMinutes: null })).toBe(words.start.reauth.WRONG_CODE_LAST)
  })

  it('takes only a full 6-digit code', () => {
    expect(codeComplete('123456')).toBe(true)
    expect(codeComplete('12345')).toBe(false)
    expect(codeComplete('12345a')).toBe(false)
  })
})

describe('The start and the return', () => {
  const tab = () => {
    const opened: string[] = []
    const t: OpeningTab & { opened: string[]; closed: number } = { opened, closed: 0, go: (url) => void opened.push(url), close: () => void (t.closed += 1) }
    return t
  }
  const link = 'https://shop.northstar.example/support/enter?token=t'

  it('sends only a proof to the start, and opens the link in the reserved tab', async () => {
    const t = tab()
    const start = vi.fn((proof: string) => Promise.resolve({ ok: true as const, link: `${link}&p=${proof}` }))
    expect(await startWith(t, '123456', { reauthenticate: () => Promise.resolve({ ok: true, proof: 'pr' }), start })).toEqual({ kind: 'opened' })
    expect(start).toHaveBeenCalledWith('pr')
    expect(t.opened).toEqual([`${link}&p=pr`])
    expect(t.closed).toBe(0)
  })

  it('never starts when the code is refused, and closes the tab', async () => {
    const t = tab()
    const start = vi.fn()
    const refusal = { ok: false as const, reason: 'WRONG_CODE' as const, triesLeft: 2, lockedMinutes: null }
    expect(await startWith(t, '000000', { reauthenticate: () => Promise.resolve(refusal), start })).toEqual({ kind: 'badCode', refusal })
    expect(start).not.toHaveBeenCalled()
    expect(t.closed).toBe(1)
  })

  it('closes the tab on every refusal and every failure', async () => {
    for (const reason of ['REAUTH_REQUIRED', 'PORTAL_NOT_LIVE', 'SUPPORT_OFF'] as const) {
      const t = tab()
      expect(await openIn(t, () => Promise.resolve({ ok: false, reason, sessionId: null }))).toEqual({ kind: 'refused', reason })
      expect(t.closed).toBe(1)
      expect(t.opened).toEqual([])
    }
    const t = tab()
    await expect(openIn(t, () => Promise.reject(new Error('down')))).rejects.toThrow('down')
    expect(t.closed).toBe(1)
  })

  it('ends the session the API names, not the page’s stale copy', async () => {
    const t = tab()
    const outcome = await openIn(t, () => Promise.resolve({ ok: false, reason: 'SUPPORT_SESSION_ALREADY_OPEN', sessionId: 'ss9' }))
    expect(outcome).toEqual({ kind: 'busy', sessionId: 'ss9' })
    expect(t.closed).toBe(1)
    const stale = session({ id: 'ss1' })
    expect(blockingSession('ss9', stale)).toEqual({ id: 'ss9', session: null })
    expect(blockingSession('ss1', stale)).toEqual({ id: 'ss1', session: stale })
    expect(blockingSession(null, stale)).toEqual({ id: 'ss1', session: stale })
    expect(blockingSession(null, null)).toBeNull()
  })
})

describe('Sessions', () => {
  const now = Date.parse('2026-10-04T10:18:00.000Z')

  it('shows the open ones with minutes left, Return to tab on yours and End when allowed', async () => {
    const theirs = session({ id: 'ss2', you: false, agent: { id: 'p2', name: 'Sam Lee' }, return: { allowed: false, reason: 'NOT_SESSION_OWNER' }, end: { allowed: false, reason: 'NOT_SESSION_OWNER' } })
    const html = await render(<SessionsTab open={[session(), theirs]} history={[]} now={now} returning={false} more={more} onReturn={noop} onEnd={noop} onMore={noop} />)
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
    const html = await render(<SessionsTab open={[]} history={[ended, expired]} now={now} returning={false} more={more} onReturn={noop} onEnd={noop} onMore={noop} />)
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
