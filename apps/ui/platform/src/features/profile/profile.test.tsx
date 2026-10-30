// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Me } from '../../api/me'
import type { PortalStaffSession } from '@dripfunnel/shared/ui'
import { fill, messages } from '../../messages'
import { Profile } from './ProfileScreen'

// My profile (#1053): the signed-in user's own name and password, and nothing for a staff session.

const words = messages.profile
const me: Me = { id: 'pu-1', name: 'Maya Ortiz', email: 'maya@northstar.com', role: 'partner-read-only', partner: { id: 'p-1', name: 'Northstar Commerce', product: 'Northstar Shops', host: 'store.northstar.com', state: 'live' } }
const staff = (kind: 'impersonation' | 'setup'): PortalStaffSession => ({ id: 's-1', kind, state: 'open', endedBy: null, staffName: 'Priya Shah', actingAs: kind === 'impersonation' ? { name: 'Maya Ortiz', role: 'Read-only', where: 'Northstar Commerce' } : null, partnerName: 'Northstar Commerce', host: 'platform.dripfunnel.ai', expiresAt: '2026-10-31T11:00:00Z' })

const sent: { query: string; variables: Record<string, unknown> }[] = []
let answer: Record<string, unknown> = { ok: true, reason: null, triesLeft: null, minutes: null }

const show = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/profile'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
}

beforeEach(() => {
  sent.length = 0
  answer = { ok: true, reason: null, triesLeft: null, minutes: null }
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> }
    sent.push(body)
    const field = body.query.includes('updateMyName') ? 'updateMyName' : 'changeMyPassword'
    return Promise.resolve(new Response(JSON.stringify({ data: { [field]: answer } })))
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('My profile', () => {
  it('saves a changed name for any role', async () => {
    await show(<Profile me={me} session={null} />)
    const field = screen.getByLabelText(words.name.label)
    expect(screen.getByRole('button', { name: words.name.save })).toHaveProperty('disabled', true)
    await userEvent.clear(field)
    await userEvent.type(field, 'Maya Ortiz-Reyes')
    await userEvent.click(screen.getByRole('button', { name: words.name.save }))
    await waitFor(() => expect(sent[0]?.variables).toEqual({ name: 'Maya Ortiz-Reyes' }))
    expect(await screen.findByText(words.name.saved)).toBeTruthy()
  })

  it('says a password change signs you out elsewhere, and sends the current and the new one', async () => {
    await show(<Profile me={me} session={null} />)
    expect(screen.getByText(words.password.signsOut)).toBeTruthy()
    await userEvent.type(screen.getByLabelText(words.password.current), 'correct horse battery')
    await userEvent.type(screen.getByLabelText(words.password.new), 'a brand new password')
    await userEvent.click(screen.getByRole('button', { name: words.password.save }))
    await waitFor(() => expect(sent[0]?.variables).toEqual({ current: 'correct horse battery', password: 'a brand new password' }))
    expect(await screen.findByText(words.password.saved)).toBeTruthy()
    expect((screen.getByLabelText(words.password.current) as HTMLInputElement).value).toBe('')
  })

  it('holds back a short password, and words a wrong current one with the tries left', async () => {
    await show(<Profile me={me} session={null} />)
    await userEvent.type(screen.getByLabelText(words.password.current), 'whatever')
    await userEvent.type(screen.getByLabelText(words.password.new), 'short')
    await userEvent.click(screen.getByRole('button', { name: words.password.save }))
    expect(screen.getByRole('alert').textContent).toBe(words.refusals.WEAK_PASSWORD)
    expect(sent).toHaveLength(0)
    answer = { ok: false, reason: 'WRONG_PASSWORD', triesLeft: 4, minutes: null }
    await userEvent.type(screen.getByLabelText(words.password.new), ' made longer now')
    await userEvent.click(screen.getByRole('button', { name: words.password.save }))
    expect((await screen.findByRole('alert')).textContent).toBe(fill(words.refusals.WRONG_PASSWORD_TRIES, { tries: '4 tries' }))
  })

  it('is read-only with the reason in an impersonation or a setup session', async () => {
    await show(<Profile me={me} session={staff('impersonation')} />)
    expect(screen.getByText(fill(messages.blocked.BLOCKED_WHILE_IMPERSONATING, { user: 'Maya', partner: 'Northstar Commerce' }))).toBeTruthy()
    expect(screen.getByLabelText(words.name.label)).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: words.password.save })).toHaveProperty('disabled', true)
    cleanup()
    await show(<Profile me={me} session={staff('setup')} />)
    expect(screen.getByText(fill(messages.blocked.PARTNER_ENTERS_THIS_ITSELF, { user: 'Maya', partner: 'Northstar Commerce' }))).toBeTruthy()
    expect(screen.getByLabelText(words.password.current)).toHaveProperty('disabled', true)
  })

  it('says a failed save failed, without claiming anything changed', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')))
    await show(<Profile me={me} session={null} />)
    await userEvent.type(screen.getByLabelText(words.name.label), ' Jr')
    await userEvent.click(screen.getByRole('button', { name: words.name.save }))
    expect((await screen.findByRole('alert')).textContent).toBe(words.failed)
  })
})
