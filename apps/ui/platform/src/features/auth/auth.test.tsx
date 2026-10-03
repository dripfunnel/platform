import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { messages } from '../../messages'
import { AcceptInvite } from './AcceptInvite'
import { acceptInviteStates, credentialsView, sampleInvitation, signInReducer, signInStates, type AcceptInviteState } from './authStates'
import { refusalWords, SignIn } from './SignIn'

const textOf = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&#x27;/g, '’').replace(/&amp;/g, '&')

// The screens read ?state= from the router's location, so each render gets its own memory history.
const render = async (element: ReactNode, search = '') => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: [`/${search}`] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}
const signInAt = (search: string, props: { next?: string; outcome?: string } = {}) => render(<SignIn search={props} />, search)

const inviteAt = (state: AcceptInviteState) => render(<AcceptInvite search={{}} loaded={sampleInvitation(state)} />, `?state=${state}`)

const signIn = messages.signIn
const invite = messages.acceptInvite

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
    enrol: invite.twoFactor.title,
    rateLimited: signIn.credentials.title,
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

  it('makes a user whose partner requires 2-factor enrol before the console, with no Skip', async () => {
    const text = textOf(await signInAt('?state=enrol'))
    expect(text).toContain(invite.twoFactor.bodyRequired)
    expect(text).toContain('JBSW Y3DP EHPK 3PXP')
    expect(text).not.toContain(invite.twoFactor.skip)
    expect(text).not.toContain(invite.twoFactor.step)
  })

  it('words a lock with the minutes the API says are left, and the tries left on a wrong code', () => {
    expect(refusalWords('LOCKED', undefined, 7)).toContain('paused for 7 minutes')
    expect(refusalWords('WRONG_CODE', 1)).toBe('That code isn’t right. 1 try left.')
    expect(refusalWords('RATE_LIMITED')).toBe(messages.auth.rateLimited)
    expect(refusalWords('INVITATION_USED')).toBe(messages.auth.notConnected)
  })

  it('reads ?outcome=expired as the Worker’s real result', async () => {
    expect(textOf(await signInAt('', { outcome: 'expired' }))).toContain(signIn.expired.title)
  })
})

describe('accepting an invitation', () => {
  it.each(['expired', 'used', 'replaced', 'invalid'] as const)('explains a %s link and offers only sign in', async (state) => {
    const text = textOf(await inviteAt(state))
    expect(text).toContain(invite.links[state].title)
    expect(text).toContain(messages.auth.goToSignIn)
    expect(text).not.toContain(invite.name)
  })

  it('shows the Owner invitation from DripFunnel with the partner, role and fixed email', async () => {
    const owner = { partner: 'Kaufladen Digital', role: 'partner-owner', email: 'jonas@kaufladen.de', invitedBy: 'DripFunnel', secondFactorRequired: false } as const
    const text = textOf(await render(<AcceptInvite search={{ token: 'tok' }} loaded={{ ok: true, invitation: owner }} />))
    expect(text).toContain('Join Kaufladen Digital')
    expect(text).toContain('DripFunnel invited you to be the Owner')
    expect(text).toContain('jonas@kaufladen.de')
    expect(text).toContain('The email can’t be changed')
  })

  it('shows a team invitation from the Owner by name', async () => {
    const text = textOf(await inviteAt('member'))
    expect(text).toContain('Jonas Weber, the Owner invited you')
    expect(text).toContain(messages.shell.roles['partner-admin'])
  })

  it('offers to skip 2-factor unless the partner requires it', async () => {
    const optional = textOf(await inviteAt('twoFactor'))
    expect(optional).toContain(invite.twoFactor.title)
    expect(optional).toContain(invite.twoFactor.skip)
    const required = textOf(await inviteAt('required'))
    expect(required).toContain(invite.twoFactor.bodyRequired)
    expect(required).not.toContain(invite.twoFactor.skip)
  })

  it('says sign-in is not connected rather than blaming the link', async () => {
    const html = await render(<AcceptInvite search={{}} loaded={{ ok: false, code: 'NOT_CONNECTED' }} />)
    expect(textOf(html)).toContain(messages.auth.notConnected)
    expect(textOf(html)).not.toContain(invite.links.invalid.body)
  })

  it('covers every harness state', async () => {
    for (const state of acceptInviteStates) expect(await inviteAt(state)).not.toBe('')
  })
})

describe('no path suggests an account can be created here', () => {
  // The shell's words do say merchants "sign up" at the partner's portal, which is a fact
  // about merchants, not a path here; the signed-out screens themselves must have none.
  it('has no sign-up, create-account or Google words on the signed-out screens', () => {
    const signedOut = JSON.stringify({ auth: messages.auth, signIn: messages.signIn, acceptInvite: messages.acceptInvite })
    expect(signedOut).not.toMatch(/sign up|sign-up|signup|create an account|create account|google/i)
  })
})

describe('moving between the sign-in steps', () => {
  const expiredStart = { ...credentialsView, expired: true }

  it('drops the session-expired words once the user moves on', () => {
    const afterForgot = signInReducer(expiredStart, { type: 'forgot' })
    expect(afterForgot.expired).toBe(false)
    expect(signInReducer(afterForgot, { type: 'back' })).toEqual(credentialsView)
    expect(signInReducer(expiredStart, { type: 'code' }).expired).toBe(false)
  })

  it('unlocks the code step when another account signs in', () => {
    const locked = signInReducer({ ...credentialsView, step: 'code' }, { type: 'locked', error: 'locked' })
    expect(locked.locked).toBe(true)
    expect(signInReducer(locked, { type: 'back' })).toEqual(credentialsView)
  })
})
