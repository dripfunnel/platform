import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Invitation } from '../../api/auth'
import { messages } from '../../messages'
import { BackupCodes } from './BackupCodes'
import { strength } from './fields'
import { storeStates } from '../staff-session/StaffSessionRoot'
import { confirmEmailStates, invitationStates, resetStates, signInStates, signUpStates } from './authStates'
import { badInvitationKey, refusalText, roleWords, signupText } from './refusals'
import { SignIn } from './SignIn'
import { SignUp } from './SignUp'

const words = messages.auth

const render = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/sign-in'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

describe('refusal words', () => {
  it('counts the tries left only when the API counts them', () => {
    expect(refusalText({ ok: false, code: 'WRONG_CODE' })).toBe(words.secondFactor.wrongPlain)
    expect(refusalText({ ok: false, code: 'WRONG_CODE', triesLeft: 1 })).toContain('1')
    expect(refusalText({ ok: false, code: 'WRONG_CODE', triesLeft: 1 })).not.toBe(refusalText({ ok: false, code: 'WRONG_CODE', triesLeft: 3 }))
  })

  it('words anything it does not know as not connected', () => {
    expect(refusalText({ ok: false, code: 'NOT_CONNECTED' })).toBe(words.notConnected)
    expect(refusalText({ ok: false, code: 'INVITATION_USED' })).toBe(words.notConnected)
  })

  it('offers a taken address’s alternatives, and falls back to sign-in’s words', () => {
    expect(signupText({ ok: false, code: 'SUBDOMAIN_TAKEN', suggestions: ['ada-2', 'ada-shop'] })).toContain('ada-shop')
    expect(signupText({ ok: false, code: 'SUBDOMAIN_TAKEN', suggestions: [] })).toBe(words.signup.su3.takenNone)
    expect(signupText({ ok: false, code: 'RATE_LIMITED' })).toBe(words.rateLimited)
  })

  it('picks the inviteBad view by code', () => {
    expect(badInvitationKey({ ok: false, code: 'INVITATION_EXPIRED' })).toBe('expired')
    expect(badInvitationKey({ ok: false, code: 'INVITATION_REPLACED' })).toBe('replaced')
    expect(badInvitationKey({ ok: false, code: 'NOT_CONNECTED' })).toBe('invalid')
  })
})

describe('roleWords', () => {
  const invitation = (role: string, supplier: string | null = null): Invitation => ({ store: 'Northstar', role, supplier, email: 'a@b.co', invitedBy: 'Ada', path: 'new' })

  it('names the merchant role, an unknown role as staff, and a supplier seat by its seller', () => {
    expect(roleWords(invitation('owner')).role).toBe(words.invite.roles.owner)
    expect(roleWords(invitation('something-new')).role).toBe(words.invite.roles.staff)
    expect(roleWords(invitation('supplier-admin', 'Loom & Co')).role).toContain('Loom & Co')
    expect(roleWords(invitation('supplier-admin', 'Loom & Co')).can).toBe(words.invite.can.supplier)
  })
})

describe('strength', () => {
  it('scores length, mixed case, digits, and symbols or extra length', () => {
    expect(strength('')).toBe(0)
    expect(strength('abcdefghij')).toBe(1)
    expect(strength('Abcdefghij')).toBe(2)
    expect(strength('Abcdefghi1')).toBe(3)
    expect(strength('Abcdefgh1!')).toBe(4)
  })
})

describe('the harness states', () => {
  it('never share a name with the staff session’s, which every screen reads too', () => {
    const ours: readonly string[] = [...signInStates, ...signUpStates, ...invitationStates, ...resetStates, ...confirmEmailStates]
    expect(ours.filter((state) => (storeStates as readonly string[]).includes(state))).toEqual([])
  })
})

describe('the screens', () => {
  beforeAll(() => vi.stubGlobal('window', { location: { hostname: 'store.northstar.example', origin: 'https://store.northstar.example' } }))
  afterAll(() => vi.unstubAllGlobals())

  it('signs in with the prototype’s words and a link to sign up', async () => {
    const html = await render(<SignIn next={undefined} />)
    expect(html).toContain(words.signIn.title)
    expect(html).toContain(words.signIn.forgot)
    expect(html).toContain(words.signIn.footLink)
  })

  it('says why the person is back at sign-in', async () => {
    expect(await render(<SignIn next={undefined} note="expired" />)).toContain(words.signIn.expired)
  })

  it('resumes at the set-up step for a new Owner', async () => {
    const html = await render(<SignIn next="/home" resume={{ step: 'enrol' }} />)
    expect(html).toContain(words.enrol.title)
    expect(html).not.toContain(words.signIn.title)
  })

  it('starts sign-up at the account step of four', async () => {
    const html = await render(<SignUp />)
    expect(html).toContain(words.signup.su1.title)
    expect(html).toContain(words.signup.steps[0])
    expect(html.match(/class="df-on"/g)).toHaveLength(1)
  })

  it('shows each backup code once with a way to keep them', async () => {
    const html = await render(<BackupCodes codes={['abcd-efgh', 'ijkl-mnop']} onDone={() => undefined} />)
    expect(html).toContain('ABCD-EFGH')
    expect(html).toContain('IJKL-MNOP')
    expect(html).toContain(words.codes.download)
  })
})
