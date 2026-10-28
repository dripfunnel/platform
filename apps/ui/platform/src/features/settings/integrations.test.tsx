// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../messages'
import { IntegrationsTab } from './IntegrationsTab'

const words = messages.settings.integrations
const key = (id: string, o: object = {}) => ({ id, provider: 'anthropic', name: 'Production', keyPrefix: 'sk-ant-…x7Qd', status: 'ok', isDefault: true, lastTestedAt: '2026-10-27T09:00:00Z', ...o })
const secret = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAx7Qd'

const sent: string[] = []
let keys: object[] = []
beforeEach(() => {
  sent.length = 0
  keys = [key('k1'), key('k2', { provider: 'openai', name: 'Cheaper', keyPrefix: 'sk-…m2Zp', status: 'untested', isDefault: false, lastTestedAt: null })]
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => {
    const body = String(init.body)
    sent.push(body)
    const data = body.includes('addPartnerAiKey') ? { addPartnerAiKey: { ok: true, reason: null } } : { partnerAiKeys: keys }
    return Promise.resolve(new Response(JSON.stringify({ data })))
  })
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Integrations', () => {
  it('lists each profile with its masked key, status and default tag', async () => {
    render(<IntegrationsTab mayChange onToast={vi.fn()} />)
    expect(await screen.findByText('Production')).toBeTruthy()
    expect(screen.getByText(/sk-ant-…x7Qd/)).toBeTruthy()
    expect(screen.getByText(words.statuses.untested)).toBeTruthy()
    expect(screen.getByText(words.default)).toBeTruthy()
    const [defaultOne, other] = screen.getAllByRole('button', { name: words.makeDefault })
    expect(defaultOne?.hasAttribute('disabled')).toBe(true)
    expect(other?.hasAttribute('disabled')).toBe(false)
  })

  it('shows the empty state when there are no keys', async () => {
    keys = []
    render(<IntegrationsTab mayChange onToast={vi.fn()} />)
    expect(await screen.findByText(words.empty)).toBeTruthy()
  })

  it('offers no change to a role that may not', async () => {
    render(<IntegrationsTab mayChange={false} onToast={vi.fn()} />)
    await screen.findByText('Production')
    expect(screen.queryByRole('button', { name: words.add })).toBeNull()
    expect(screen.queryByRole('button', { name: words.remove })).toBeNull()
  })

  it('sends the typed key once, in a masked field, and the list never carries it back', async () => {
    const user = userEvent.setup()
    const toast = vi.fn()
    render(<IntegrationsTab mayChange onToast={toast} />)
    await user.click(await screen.findByRole('button', { name: words.add }))
    const field = await screen.findByLabelText(words.addDialog.key)
    expect(field.getAttribute('type')).toBe('password')
    await user.type(await screen.findByLabelText(words.addDialog.name), 'Backup')
    await user.type(field, secret)
    await user.click(screen.getByRole('button', { name: words.addDialog.testAndSave }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.added))
    expect(sent.filter((b) => b.includes(secret))).toHaveLength(1)
    expect(sent.filter((b) => b.includes('partnerAiKeys') && b.includes(secret))).toHaveLength(0)
  })
})

describe('Integrations without permission', () => {
  it('says why, instead of a blank page, when a role that may not opens the address directly', async () => {
    const { PermissionDenied } = await import('@dripfunnel/shared/ui')
    render(<PermissionDenied actionLabel={words.title} reason={words.mayNot} />)
    expect(screen.getByText(words.mayNot)).toBeTruthy()
  })
})
