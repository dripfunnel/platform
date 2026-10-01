import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { messages } from '../../messages'
import { signInStates } from './authStates'
import { SignIn } from './SignIn'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')

// The screens read ?state= from the router's location, so each render gets its own memory history.
const render = async (element: ReactNode, search = '') => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: [`/${search}`] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const signInAt = (search: string, props: { next?: string; outcome?: string } = {}) => render(<SignIn search={props} />, search)

const signIn = messages.signIn

describe('the sign-in screen', () => {
  it('starts with email and password, offers forgot password, and points newcomers at their invitation', async () => {
    const html = await signInAt('')
    const text = textOf(html)
    expect(text).toContain(signIn.credentials.title)
    expect(html).toContain('type="password"')
    expect(html).toMatch(/autocomplete="current-password"/i)
    expect(text).toContain(signIn.credentials.forgot)
    expect(text).toContain(messages.auth.footer)
  })

  const titles: Record<(typeof signInStates)[number], string> = {
    wrong: signIn.credentials.title,
    notConnected: signIn.credentials.title,
    code: signIn.code.title,
    wrongCode: signIn.code.title,
    expiredCode: signIn.code.title,
    locked: signIn.code.title,
    forgot: signIn.forgot.title,
    sent: signIn.sent.title,
    expired: signIn.expired.title,
  }
  it.each(signInStates)('renders the %s state through ?state=', async (state) => {
    expect(textOf(await signInAt(`?state=${state}`))).toContain(titles[state])
  })

  it('tells a refused password and an unknown email the same thing', async () => {
    const text = textOf(await signInAt('?state=wrong'))
    expect(text).toContain(signIn.credentials.refused)
    expect(signIn.credentials.refused).not.toMatch(/account|exist|unknown/i)
  })

  it('shows the lock as an alert and disables the code form', async () => {
    const html = await signInAt('?state=locked')
    expect(html).toMatch(/role="alert"[^>]*>Too many wrong codes/)
    expect(html).toMatch(/<input[^>]*autocomplete="one-time-code"[^>]*disabled=""/i)
  })

  it('reads ?outcome=expired as the Worker’s real result', async () => {
    expect(textOf(await signInAt('', { outcome: 'expired' }))).toContain(signIn.expired.title)
  })
})

describe('no path suggests an account can be created here', () => {
  // The shell's words do say merchants "sign up" at the partner's portal, which is a fact
  // about merchants, not a path here; the signed-out screens themselves must have none.
  it('has no sign-up, create-account or Google words on the signed-out screens', () => {
    const signedOut = JSON.stringify({ auth: messages.auth, signIn: messages.signIn })
    expect(signedOut).not.toMatch(/sign up|sign-up|signup|create an account|create account|google/i)
  })
})
