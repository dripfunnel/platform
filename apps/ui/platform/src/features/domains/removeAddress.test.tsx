// @vitest-environment jsdom
import { ApiError } from '@dripfunnel/shared/graphql'
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../messages'
import { domainsPages } from './domainsTestData'

const words = messages.domains.remove
const state = vi.hoisted(() => ({ page: null as unknown, role: 'partner-owner', session: null as unknown, invalidate: vi.fn() }))
const remove = vi.hoisted(() => vi.fn())

vi.mock('@tanstack/react-router', () => ({
  getRouteApi: (id: string) => ({ useLoaderData: () => (id === '/_app' ? { me: { role: state.role } } : state.page) }),
  useRouterState: () => '',
  useRouter: () => ({ invalidate: state.invalidate }),
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}))
vi.mock('@dripfunnel/shared/ui', async (original) => ({ ...(await original<object>()), useCurrentStaffSession: () => state.session }))
vi.mock('../../api/domains', async (original) => ({ ...(await original<object>()), removePartnerDomain: remove, recheckPartnerDomain: vi.fn(), loadMerchantDomains: vi.fn() }))

const { DomainsScreen } = await import('./DomainsScreen')

beforeEach(() => {
  state.page = domainsPages.mixed
  state.role = 'partner-owner'
  state.session = null
  state.invalidate.mockReset()
  remove.mockReset()
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(cleanup)

const removeButtons = () => screen.queryAllByRole('button', { name: words.button })
const openFor = async (host: string) => {
  const user = userEvent.setup()
  const card = screen.getByRole('heading', { name: host }).closest('section')
  if (!card) throw new Error('no card')
  await user.click(within(card).getByRole('button', { name: words.button }))
  return { user, dialog: screen.getByRole('dialog') }
}

describe('Remove on the Domains screen', () => {
  it.each(['partner-owner', 'partner-admin'])('shows %s a Remove on each of the four cards', (role) => {
    state.role = role
    render(<DomainsScreen />)
    expect(removeButtons()).toHaveLength(4)
  })

  it.each(['partner-support', 'partner-finance', 'partner-read-only'])('shows %s no Remove', (role) => {
    state.role = role
    render(<DomainsScreen />)
    expect(removeButtons()).toHaveLength(0)
  })

  it('shows no Remove in a support session', () => {
    state.session = { state: 'open', kind: 'impersonation' }
    render(<DomainsScreen />)
    expect(removeButtons()).toHaveLength(0)
  })

  it.each([
    ['portal', 'store.northstar.com', 'Merchants can no longer sign in at store.northstar.com. Their stores keep working.'],
    ['preview', '*.preview.northstar.com', 'Store previews stop working at this address.'],
    ['shops', '*.shops.northstar.com', 'Shops stop answering at this address until you add another.'],
    ['email', 'mail.northstar.com', 'Emails go from no-reply@northstar.dripfunnel-mail.com until you add another sender.'],
  ])('asks before removing the %s address, naming what stops', async (_kind, host, consequence) => {
    render(<DomainsScreen />)
    const { dialog } = await openFor(host)
    expect(within(dialog).getByRole('heading', { name: `Remove ${host}?` })).toBeTruthy()
    expect(dialog.textContent).toContain(consequence)
    expect(remove).not.toHaveBeenCalled()
  })

  it('removes the confirmed kind, closes, says so and reloads', async () => {
    let finish: (r: { ok: true }) => void = () => undefined
    remove.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    render(<DomainsScreen />)
    const { user, dialog } = await openFor('*.shops.northstar.com')
    await user.click(within(dialog).getByRole('button', { name: words.confirm }))
    expect(remove).toHaveBeenCalledWith('shops')
    expect((within(dialog).getByRole('button', { name: words.confirm }) as HTMLButtonElement).disabled).toBe(true)
    finish({ ok: true })
    await waitFor(() => expect(screen.getByText('*.shops.northstar.com removed')).toBeTruthy())
    expect(dialog.hasAttribute('open')).toBe(false)
    expect(state.invalidate).toHaveBeenCalled()
  })

  it('does nothing when cancelled', async () => {
    render(<DomainsScreen />)
    const { user, dialog } = await openFor('mail.northstar.com')
    await user.click(within(dialog).getByRole('button', { name: words.cancel }))
    expect(remove).not.toHaveBeenCalled()
    expect(dialog.hasAttribute('open')).toBe(false)
  })

  it.each([
    ['FORBIDDEN', () => Promise.reject(new ApiError('FORBIDDEN', 'no')), words.refused],
    ['NOT_FOUND', () => Promise.resolve({ ok: false, reason: 'NOT_FOUND' }), 'mail.northstar.com is already removed.'],
    ['a network failure', () => Promise.reject(new TypeError('offline')), words.failed],
  ])('shows %s in the dialog and keeps it open', async (_name, answer, text) => {
    remove.mockImplementation(answer)
    render(<DomainsScreen />)
    const { user, dialog } = await openFor('mail.northstar.com')
    await user.click(within(dialog).getByRole('button', { name: words.confirm }))
    await waitFor(() => expect(dialog.textContent).toContain(text))
    expect(dialog.hasAttribute('open')).toBe(true)
    expect(state.invalidate).not.toHaveBeenCalled()
  })

  it('returns the card to Add an address once the page reloads without it', () => {
    const { rerender } = render(<DomainsScreen />)
    expect(screen.getByRole('heading', { name: 'mail.northstar.com' })).toBeTruthy()
    const partner = domainsPages.mixed.partner
    state.page = { ...domainsPages.mixed, partner: { ...partner, canAdd: true, addresses: partner.addresses.map((a) => (a.kind === 'email' ? { kind: 'email', added: false } : a)) } }
    rerender(<DomainsScreen />)
    expect(screen.queryByRole('heading', { name: 'mail.northstar.com' })).toBeNull()
    expect(screen.getByRole('link', { name: messages.domains.add })).toBeTruthy()
  })
})
