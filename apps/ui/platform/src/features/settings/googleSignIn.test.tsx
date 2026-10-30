// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../messages'
import { GoogleSignInPanel } from './GoogleSignInPanel'

const words = messages.settings.integrations.google
// Built, not written out: GitHub's push protection reads a literal in Google's shape as a leaked credential.
const clientId = ['111-a', 'apps', 'googleusercontent', 'com'].join('.')
const secret = ['GOCSPX', 'a'.repeat(28)].join('-')
const off = { enabled: false, clientId: null, secretHint: null, setBy: null, setAt: null, redirectUri: 'https://store.northstar.example/api/auth/google/callback' }
const on = { ...off, enabled: true, clientId, secretHint: 'GOCSPX-…aaaa', setBy: 'Maya Chen', setAt: '2026-10-30T09:00:00Z' }

const sent: string[] = []
let status: object | 'fail' = off
let saved: object = { ok: true, reason: null }
let loads = 0
beforeEach(() => {
  sent.length = 0
  status = off
  saved = { ok: true, reason: null }
  loads = 0
  vi.stubGlobal('fetch', (_: string, init: RequestInit) => {
    const body = String(init.body)
    sent.push(body)
    if (body.includes('savePartnerGoogleSignIn')) return Promise.resolve(new Response(JSON.stringify({ data: { savePartnerGoogleSignIn: saved } })))
    if (body.includes('turnOffPartnerGoogleSignIn')) return Promise.resolve(new Response(JSON.stringify({ data: { turnOffPartnerGoogleSignIn: { ok: true, reason: null } } })))
    loads += 1
    return status === 'fail' ? Promise.reject(new Error('down')) : Promise.resolve(new Response(JSON.stringify({ data: { partnerGoogleSignIn: status } })))
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

describe('Google sign-in on Integrations', () => {
  it('shows the redirect address to register and that it is off', async () => {
    render(<GoogleSignInPanel mayChange onToast={vi.fn()} />)
    expect(await screen.findByText(off.redirectUri)).toBeTruthy()
    expect(screen.getByText(words.off)).toBeTruthy()
    expect(screen.getByRole('button', { name: words.setUp })).toBeTruthy()
  })

  it('says when the address was copied, and when it couldn’t be, with or without a clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve())
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    render(<GoogleSignInPanel mayChange onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: words.copy }))
    expect(writeText).toHaveBeenCalledWith(off.redirectUri)
    expect(await screen.findByText(words.copied)).toBeTruthy()
    writeText.mockImplementation(() => Promise.reject(new Error('denied')))
    await userEvent.click(screen.getByRole('button', { name: words.copy }))
    expect(await screen.findByText(words.copyFailed)).toBeTruthy()
    cleanup()
    vi.stubGlobal('navigator', {})
    render(<GoogleSignInPanel mayChange onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: words.copy }))
    expect(await screen.findByText(words.copyFailed)).toBeTruthy()
  })

  it('saves a client in Google’s shape and turns it on, and holds back one that isn’t', async () => {
    const toast = vi.fn()
    render(<GoogleSignInPanel mayChange onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: words.setUp }))
    await userEvent.type(screen.getByLabelText(words.clientLabel), 'not-a-client')
    await userEvent.type(screen.getByLabelText(words.secretLabel), secret)
    expect(screen.getByText(words.dialog.incomplete)).toBeTruthy()
    await userEvent.clear(screen.getByLabelText(words.clientLabel))
    await userEvent.type(screen.getByLabelText(words.clientLabel), clientId)
    status = on
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.saved))
    expect(sent.some((b) => b.includes('savePartnerGoogleSignIn') && b.includes(clientId))).toBe(true)
    expect(await screen.findByText('GOCSPX-…aaaa')).toBeTruthy()
    expect(screen.queryByText(secret)).toBeNull()
  })

  it('says why the API refused a client', async () => {
    saved = { ok: false, reason: 'INVALID_INPUT' }
    render(<GoogleSignInPanel mayChange onToast={vi.fn()} />)
    await userEvent.click(await screen.findByRole('button', { name: words.setUp }))
    await userEvent.type(screen.getByLabelText(words.clientLabel), clientId)
    await userEvent.type(screen.getByLabelText(words.secretLabel), secret)
    await userEvent.click(screen.getByRole('button', { name: words.dialog.save }))
    expect(await screen.findByText(words.refusals.INVALID_INPUT)).toBeTruthy()
  })

  it('turns it off after restating what that does', async () => {
    status = on
    const toast = vi.fn()
    render(<GoogleSignInPanel mayChange onToast={toast} />)
    await userEvent.click(await screen.findByRole('button', { name: words.turnOff }))
    expect(screen.getByText(words.offDialog.consequence)).toBeTruthy()
    status = { ...on, enabled: false }
    await userEvent.click(screen.getByRole('button', { name: words.offDialog.confirm }))
    await waitFor(() => expect(toast).toHaveBeenCalledWith(words.toasts.off))
    expect(sent.some((b) => b.includes('turnOffPartnerGoogleSignIn'))).toBe(true)
  })

  it('offers no changes to a role that can’t make them', async () => {
    status = on
    render(<GoogleSignInPanel mayChange={false} onToast={vi.fn()} />)
    expect(await screen.findByText(on.clientId)).toBeTruthy()
    expect(screen.queryByRole('button', { name: words.replace })).toBeNull()
    expect(screen.queryByRole('button', { name: words.turnOff })).toBeNull()
  })

  it('says it couldn’t load, and tries again', async () => {
    status = 'fail'
    render(<GoogleSignInPanel mayChange onToast={vi.fn()} />)
    expect(await screen.findByText(words.error.title)).toBeTruthy()
    status = off
    await userEvent.click(screen.getByRole('button', { name: words.error.retry }))
    expect(await screen.findByText(words.off)).toBeTruthy()
    expect(loads).toBe(2)
  })
})
