// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../messages'
import { IntegrationsTab } from './IntegrationsTab'

const words = messages.settings.integrations
const key = (id: string, o: object = {}) => ({ id, provider: 'anthropic', name: 'Production', keyPrefix: 'sk-ant-…x7Qd', status: 'ok', isDefault: true, lastTestedAt: '2026-10-27T09:00:00Z', authType: 'api_key', accountLabel: null, ...o })
const signIn = (o: object = {}) => key('k3', { provider: 'openai', name: 'ChatGPT sign-in', keyPrefix: '', isDefault: false, authType: 'oauth', accountLabel: 'ai@northstar.example', ...o })
const secret = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAx7Qd'

const sent: string[] = []
const open = vi.fn()
let keys: object[] = []
let chatgpt = true
let begun: object = { ok: true, reason: null, url: 'https://auth.openai.com/oauth/authorize?state=s' }
let finished: object = { ok: true, reason: null }
beforeEach(() => {
  sent.length = 0
  open.mockReset()
  vi.stubGlobal('open', open)
  chatgpt = true
  begun = { ok: true, reason: null, url: 'https://auth.openai.com/oauth/authorize?state=s' }
  finished = { ok: true, reason: null }
  keys = [key('k1'), key('k2', { provider: 'openai', name: 'Cheaper', keyPrefix: 'sk-…m2Zp', status: 'untested', isDefault: false, lastTestedAt: null })]
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => {
    const body = String(init.body)
    sent.push(body)
    const data = body.includes('addPartnerAiKey')
      ? { addPartnerAiKey: { ok: true, reason: null } }
      : body.includes('beginPartnerAiOauth')
        ? { beginPartnerAiOauth: begun }
        : body.includes('finishPartnerAiOauth')
          ? { finishPartnerAiOauth: finished }
          : body.includes('partnerAiSignIn')
            ? { partnerAiKeys: keys, partnerAiSignIn: [{ provider: 'openai', available: chatgpt, reason: chatgpt ? null : 'CLIENT_NOT_CONFIGURED' }, { provider: 'anthropic', available: true, reason: null }] }
            : { partnerAiKeys: keys }
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

describe('Sign in with ChatGPT or Claude', () => {
  const sentWith = (name: string) => sent.filter((b) => b.includes(name))

  it('opens the provider in a new tab, then finishes with the pasted code once', async () => {
    const user = userEvent.setup()
    const toast = vi.fn()
    render(<IntegrationsTab mayChange onToast={toast} />)
    await user.click(await screen.findByRole('button', { name: words.signIn.chatgpt.button }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://auth.openai.com/oauth/authorize?state=s', '_blank', 'noopener,noreferrer'))
    expect(sentWith('beginPartnerAiOauth')[0]).toContain('"provider":"openai"')
    expect(sentWith('beginPartnerAiOauth')[0]).toContain('"id":null')
    const field = await screen.findByLabelText(words.signIn.pasteLabel)
    expect(field.getAttribute('type')).toBe('password')
    await user.click(screen.getByRole('button', { name: words.signIn.finish }))
    expect(await screen.findByText(words.signIn.missing)).toBeTruthy()
    expect(sentWith('finishPartnerAiOauth')).toHaveLength(0)
    await user.type(field, ' code123#state456 ')
    await user.click(screen.getByRole('button', { name: words.signIn.finish }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.connected))
    expect(sentWith('finishPartnerAiOauth')).toHaveLength(1)
    expect(sentWith('finishPartnerAiOauth')[0]).toContain('"response":"code123#state456"')
  })

  it('starts Claude\'s sign-in the same way', async () => {
    begun = { ok: true, reason: null, url: 'https://claude.ai/oauth/authorize?state=s' }
    const user = userEvent.setup()
    render(<IntegrationsTab mayChange onToast={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: words.signIn.claude.button }))
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://claude.ai/oauth/authorize?state=s', '_blank', 'noopener,noreferrer'))
    expect(sentWith('beginPartnerAiOauth')[0]).toContain('"provider":"anthropic"')
  })

  it('never opens an address that is not https', async () => {
    begun = { ok: true, reason: null, url: 'http://evil.example/' }
    const user = userEvent.setup()
    const toast = vi.fn()
    render(<IntegrationsTab mayChange onToast={toast} />)
    await user.click(await screen.findByRole('button', { name: words.signIn.chatgpt.button }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.failed))
    expect(open).not.toHaveBeenCalled()
  })

  it('says why a pasted code was refused', async () => {
    finished = { ok: false, reason: 'OAUTH_EXPIRED' }
    const user = userEvent.setup()
    render(<IntegrationsTab mayChange onToast={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: words.signIn.chatgpt.button }))
    await user.type(await screen.findByLabelText(words.signIn.pasteLabel), 'bad#code')
    await user.click(screen.getByRole('button', { name: words.signIn.finish }))
    expect(await screen.findByText(words.refusals.OAUTH_EXPIRED)).toBeTruthy()
  })

  it('says why sign-in is off for a provider the API does not offer', async () => {
    chatgpt = false
    render(<IntegrationsTab mayChange onToast={vi.fn()} />)
    expect(await screen.findByText(words.signIn.off)).toBeTruthy()
    expect(screen.getByRole('button', { name: words.signIn.chatgpt.button }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText(words.signIn.claude.risk)).toBeTruthy()
    expect(screen.getByRole('button', { name: words.signIn.claude.button }).hasAttribute('disabled')).toBe(false)
  })

  it('shows a connected sign-in with its account and reconnects that profile', async () => {
    keys = [key('k1'), signIn()]
    const user = userEvent.setup()
    render(<IntegrationsTab mayChange onToast={vi.fn()} />)
    expect(await screen.findByText('Signed in · ai@northstar.example')).toBeTruthy()
    expect(screen.getByText(words.signInStatuses.ok)).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.signIn.chatgpt.button })).toBeNull()
    expect(screen.getByRole('button', { name: words.signIn.claude.button })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: words.reconnect }))
    await waitFor(() => expect(open).toHaveBeenCalled())
    expect(sentWith('beginPartnerAiOauth')[0]).toContain('"id":"k3"')
    expect(sentWith('beginPartnerAiOauth')[0]).toContain('"provider":"openai"')
  })

  it('says a rejected sign-in needs reconnecting, and disconnects it after saying what happens', async () => {
    keys = [signIn({ status: 'rejected', isDefault: true })]
    const user = userEvent.setup()
    render(<IntegrationsTab mayChange onToast={vi.fn()} />)
    expect(await screen.findByText(words.signInStatuses.rejected)).toBeTruthy()
    expect(screen.getByText(words.signInRejectedNote)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: words.disconnect }))
    expect(await screen.findByText(new RegExp(words.removeDialog.signInLead.slice(0, 30)))).toBeTruthy()
  })
})

describe('Integrations without permission', () => {
  it('says why, instead of a blank page, when a role that may not opens the address directly', async () => {
    const { PermissionDenied } = await import('@dripfunnel/shared/ui')
    render(<PermissionDenied actionLabel={words.title} reason={words.mayNot} />)
    expect(screen.getByText(words.mayNot)).toBeTruthy()
  })
})
