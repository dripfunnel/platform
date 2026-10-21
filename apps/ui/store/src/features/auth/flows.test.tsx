// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode, type ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { messages } from '../../messages'

// The getting-in screens driven as a person would (FIRST-RELEASE §4): what each answer from
// /api/auth/* shows, how often a single-use link is spent, and where focus goes on a new step.

const words = messages.auth

type Answer = Record<string, unknown> | (() => never)
const calls: { route: string; body: unknown }[] = []

/** Answers each auth route in turn from its own queue; a route asked once more than queued fails the test. */
const serve = (answers: Record<string, Answer[]>) => {
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const route = url.replace('/api/auth/', '')
    calls.push({ route, body: JSON.parse(String(init.body)) })
    const next = answers[route]?.shift()
    if (!next) throw new Error(`unexpected call to ${route}`)
    if (typeof next === 'function') next()
    return new Response(JSON.stringify(next))
  })
}

const offline = () => {
  throw new TypeError('offline')
}

const show = async (element: ReactNode, path = '/') => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: [path] }) })
  await act(async () => {
    render(
      <StrictMode>
        <RouterProvider router={router} />
      </StrictMode>,
    )
  })
  return router
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))

afterEach(() => {
  cleanup()
  calls.length = 0
  vi.unstubAllGlobals()
  vi.resetModules()
})

const invitation = { store: 'Northwind Goods', role: 'staff', supplier: null, email: 'farhan@gmail.com', invitedBy: 'Nadia', path: 'join' }

describe('joining a store', () => {
  it('joins once per link even when React runs the effect twice, and says why a failed request failed', async () => {
    serve({ invitation: [{ ok: true, invitation }, { ok: true, invitation }], join: [{ ok: false, code: 'NOT_CONNECTED' }] })
    const { Invitation } = await import('./Invitation')
    await show(<Invitation token="tok-1" path="join" />)
    await settle()
    expect(calls.filter((c) => c.route === 'join')).toHaveLength(1)
    expect(await screen.findByText(words.notConnected)).toBeTruthy()
    expect(screen.queryByText(words.inviteBad.invalid.title)).toBeNull()
  })

  it('joins again only when asked, and goes to the store when it works', async () => {
    serve({ invitation: [{ ok: true, invitation }, { ok: true, invitation }], join: [{ ok: false, code: 'RATE_LIMITED' }, { ok: true, step: 'done' }] })
    const { Invitation } = await import('./Invitation')
    const router = await show(<Invitation token="tok-2" path="join" />)
    await settle()
    fireEvent.click(await screen.findByRole('button', { name: words.invite.joinPrimary }))
    await settle()
    expect(calls.filter((c) => c.route === 'join')).toHaveLength(2)
    expect(router.state.location.pathname).toBe('/stores')
  })

  it('offers to try a failed look-up again rather than calling the link dead', async () => {
    // StrictMode looks it up twice; only the second, current answer is shown.
    serve({ invitation: [offline, offline, { ok: true, invitation: { ...invitation, path: 'new' } }] })
    const { Invitation } = await import('./Invitation')
    await show(<Invitation token="tok-3" path="accept" />)
    await settle()
    expect(await screen.findByText(words.invite.retryTitle)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.invite.retry }))
    await settle()
    expect(await screen.findByRole('heading', { name: 'Join Northwind Goods' })).toBeTruthy()
  })

  it('shows a used link as used', async () => {
    serve({ invitation: [{ ok: false, code: 'INVITATION_USED', invitedBy: 'Nadia' }, { ok: false, code: 'INVITATION_USED', invitedBy: 'Nadia' }] })
    const { Invitation } = await import('./Invitation')
    await show(<Invitation token="tok-4" path="accept" />)
    expect(await screen.findByText(words.inviteBad.used.title)).toBeTruthy()
  })
})

describe('the email change link', () => {
  it('is spent once under StrictMode, and a failed request can be tried again', async () => {
    serve({ 'confirm-email': [offline, { ok: true }] })
    const { ConfirmEmail } = await import('./ConfirmEmail')
    await show(<ConfirmEmail token="link-1" />)
    await settle()
    expect(await screen.findByText(words.confirmEmail.retryTitle)).toBeTruthy()
    expect(calls).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: words.confirmEmail.retry }))
    await settle()
    expect(await screen.findByText(words.confirmEmail.doneTitle)).toBeTruthy()
    expect(calls).toHaveLength(2)
  })

  it('says a refused link no longer works', async () => {
    serve({ 'confirm-email': [{ ok: false, code: 'EMAIL_CHANGE_INVALID' }] })
    const { ConfirmEmail } = await import('./ConfirmEmail')
    await show(<ConfirmEmail token="link-2" />)
    expect(await screen.findByText(words.confirmEmail.badTitle)).toBeTruthy()
  })
})

describe('signing in', () => {
  const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } })

  it('sends a texted code, then the code, and puts focus on each new step’s heading', async () => {
    serve({ 'sign-in': [{ ok: true, step: 'second-factor', method: 'sms' }], 'send-code': [{ ok: true, hint: '•••• 2113' }], 'second-factor': [{ ok: false, code: 'WRONG_CODE', triesLeft: 2 }] })
    const { SignIn } = await import('./SignIn')
    await show(<SignIn next={undefined} />)
    fill(words.fields.email, 'farhan@gmail.com')
    fill(words.fields.password, 'correct horse')
    fireEvent.click(screen.getByRole('button', { name: words.signIn.primary }))
    await settle()
    const heading = await screen.findByRole('heading', { name: words.secondFactor.title })
    expect(document.activeElement).toBe(heading)
    expect(screen.getByText(/2113/)).toBeTruthy()
    fill(words.fields.code, '123456')
    fireEvent.click(screen.getByRole('button', { name: words.secondFactor.primary }))
    await settle()
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(calls.map((c) => c.route)).toEqual(['sign-in', 'send-code', 'second-factor'])
  })

  it('shows the pause after too many tries, and its way to reset the password', async () => {
    serve({ 'sign-in': [{ ok: false, code: 'LOCKED', minutes: 15 }] })
    const { SignIn } = await import('./SignIn')
    await show(<SignIn next={undefined} />)
    fill(words.fields.email, 'farhan@gmail.com')
    fill(words.fields.password, 'wrong')
    fireEvent.click(screen.getByRole('button', { name: words.signIn.primary }))
    await settle()
    expect(await screen.findByRole('heading', { name: words.locked.title.replace('{minutes}', '15') })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: words.locked.primary }))
    expect(await screen.findByRole('heading', { name: words.forgot.title })).toBeTruthy()
  })

  it('says why a resumed text didn’t send, and starts no countdown', async () => {
    serve({ 'send-code': [{ ok: false, code: 'RATE_LIMITED' }] })
    const { SignIn } = await import('./SignIn')
    await show(<SignIn next={undefined} resume={{ step: 'second-factor', method: 'sms' }} />)
    await settle()
    expect(await screen.findByText(words.rateLimited)).toBeTruthy()
    expect(screen.queryByText(/\d+ ?s\b/)).toBeNull()
    expect(calls.filter((c) => c.route === 'send-code')).toHaveLength(1)
  })

  it('sends the reset link again with the forgot flow’s own words', async () => {
    serve({ 'request-password-reset': [{ ok: true }, { ok: true }] })
    const { SignIn } = await import('./SignIn')
    await show(<SignIn next={undefined} start="forgot" />)
    fill(words.fields.email, 'farhan@gmail.com')
    fireEvent.click(screen.getByRole('button', { name: words.forgot.primary }))
    await settle()
    fireEvent.click(await screen.findByRole('button', { name: words.forgot.again }))
    await settle()
    expect(await screen.findByText(words.forgot.resent)).toBeTruthy()
  })

  it('says a failed resend failed, not that it was asked too often', async () => {
    serve({ 'request-password-reset': [{ ok: true }, offline] })
    const { SignIn } = await import('./SignIn')
    await show(<SignIn next={undefined} start="forgot" />)
    fill(words.fields.email, 'farhan@gmail.com')
    fireEvent.click(screen.getByRole('button', { name: words.forgot.primary }))
    await settle()
    fireEvent.click(await screen.findByRole('button', { name: words.forgot.again }))
    await settle()
    expect((await screen.findByRole('alert')).textContent).toBe(words.notConnected)
    expect(screen.queryByText(words.rateLimited)).toBeNull()
  })
})
