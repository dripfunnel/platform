// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useSyncExternalStore } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PortalSessionRoot } from './PortalSessionRoot'
import type { PortalSession } from './portalSession'
import type { PortalStaffSession } from './staffSession'
import { staffSessionCopy, type StaffSessionWords } from './staffSessionCopy'
import { sessionPollMs } from './usePolling'

// #1531: the ended card belongs to the tab that was in the session, not to every later visit on the host.

const now = Date.parse('2026-11-16T09:00:00Z')
const inMinutes = (minutes: number) => new Date(now + minutes * 60_000).toISOString()

const session = (over: Partial<PortalStaffSession>): PortalStaffSession => ({
  id: 'imp-1',
  kind: 'impersonation',
  state: 'open',
  endedBy: null,
  staffName: 'Neha Rao',
  actingAs: { name: 'Rohan Verma', role: 'Manager', where: 'Mehta Textiles' },
  partnerName: 'Bazaar Cloud',
  host: 'mystore.dripfunnel.com',
  expiresAt: inMinutes(30),
  ...over,
})

const words: StaffSessionWords = {
  impersonating: 'Impersonating {user}',
  impersonatingDetail: '({role}, {where}) · Support session by {staff}',
  setup: 'Setup session for {partner}',
  setupDetail: '· You’re in as {staff} (DripFunnel)',
  endsIn: 'Ends in {time}',
  end: 'End session',
  endFailed: 'That didn’t go through.',
  back: 'Back',
  action: 'Back to the admin console',
  close: 'Close',
  notice: 'Support ({staff}) is signed in as {user}. Ends in {time}.',
  noticeSetup: 'DripFunnel is setting up your console: {staff}, until {time}.',
  ended: 'This session has ended',
  expired: 'Your time as {user} is up',
  expiredSetup: 'Your time is up',
  endedBody: { admin: 'Ended from the admin console.', portal: 'You ended it here.', expiry: 'It timed out.' },
}
const copy = staffSessionCopy(words, { wait: (seconds) => `${seconds / 60} min`, time: (iso) => iso.slice(11, 16) })

// A tab's session client: `changed` is another tab entering or ending one, which remounts the layer.
const clientOf = (current: () => Promise<PortalStaffSession | null>) => {
  let version = 0
  const listeners = new Set<() => void>()
  const client: PortalSession = {
    exchange: () => Promise.resolve(null),
    current,
    notice: () => Promise.resolve(null),
    end: () => Promise.resolve(),
    harness: () => undefined,
    useVersion: () =>
      useSyncExternalStore(
        (listener) => {
          listeners.add(listener)
          return () => void listeners.delete(listener)
        },
        () => version,
      ),
  }
  const changed = () => {
    version += 1
    for (const listener of listeners) listener()
  }
  return { client, changed }
}

const renderRoot = async (current: () => Promise<PortalStaffSession | null>) => {
  const { client, changed } = clientOf(current)
  render(<PortalSessionRoot client={client} copy={copy} adminUrl="https://admin.dripfunnel.ai" forced={null} invalid={{ title: 'This link no longer works', body: '' }} />)
  await act(async () => {})
  return { changed: () => act(async () => changed()) }
}

const advance = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
  vi.setSystemTime(now)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('a tab opened after the session ended', () => {
  it('shows no end card for a session already ended', async () => {
    await renderRoot(() => Promise.resolve(session({ state: 'ended', endedBy: 'portal' })))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows no end card for a session already expired', async () => {
    await renderRoot(() => Promise.resolve(session({ state: 'expired', endedBy: 'expiry', expiresAt: inMinutes(-5) })))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('the tab that was in the session', () => {
  it('shows the end card once the server says it ended', async () => {
    const load = vi.fn<() => Promise<PortalStaffSession | null>>().mockResolvedValueOnce(session({})).mockResolvedValue(session({ state: 'ended', endedBy: 'portal' }))
    await renderRoot(load)
    expect(screen.getByRole('button', { name: 'End session' })).toBeTruthy()
    await advance(sessionPollMs)
    expect(screen.getByRole('dialog', { name: 'This session has ended' }).textContent).toContain('You ended it here.')
  })

  it('shows the end card once the clock passes its end', async () => {
    await renderRoot(() => Promise.resolve(session({ expiresAt: inMinutes(1) })))
    await advance(61_000)
    expect(screen.getByRole('dialog', { name: 'Your time as Rohan is up' }).textContent).toContain('It timed out.')
  })

  it('shows the end card when another of its tabs ended it', async () => {
    const load = vi.fn<() => Promise<PortalStaffSession | null>>().mockResolvedValueOnce(session({})).mockResolvedValue(session({ state: 'ended', endedBy: 'portal' }))
    const tab = await renderRoot(load)
    await tab.changed()
    expect(screen.getByRole('dialog', { name: 'This session has ended' })).toBeTruthy()
  })
})

// #1757: the ended card can be closed, and the tab then shows the portal without a session.
describe('closing the end card', () => {
  const ended = () => vi.fn<() => Promise<PortalStaffSession | null>>().mockResolvedValueOnce(session({})).mockResolvedValue(session({ state: 'ended', endedBy: 'portal' }))
  const openCard = async () => {
    await renderRoot(ended())
    await advance(sessionPollMs)
    expect(screen.getByRole('dialog', { name: 'This session has ended' })).toBeTruthy()
  }

  it('closes with the ✕, named Close', async () => {
    await openCard()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes with Esc', async () => {
    await openCard()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('stays closed at the next read, and still links back to the admin console while open', async () => {
    await openCard()
    expect(screen.getByRole('link', { name: 'Back to the admin console' }).getAttribute('href')).toBe('https://admin.dripfunnel.ai')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    await advance(sessionPollMs)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
