// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Provided, shopAnswering } from '../../test/shop'
import { createShopClient } from '../platform/api/client'
import { shopperToken, storedShopState } from '../platform/api/tokens'
import type { RenderMode } from '../platform/store/context'
import { useAccount, useSignIn, type AccountPage, type SignInPage } from './account'

let signIn: SignInPage | null = null
let account: AccountPage | null = null
const SignInProbe = () => {
  signIn = useSignIn()
  return null
}
const AccountProbe = () => {
  account = useAccount()
  return null
}
const shown = <T,>(value: T | null): T => {
  if (!value) throw new Error('not rendered')
  return value
}
const show = async (probe: 'signIn' | 'account', mode: RenderMode = 'live') => {
  render(<Provided mode={mode} client={createShopClient({ state: storedShopState })}>{probe === 'signIn' ? <SignInProbe /> : <AccountProbe />}</Provided>)
  await act(async () => undefined)
}
const assign = vi.fn()
const at = (address: string) => {
  const url = new URL(address, location.origin)
  vi.stubGlobal('location', { ...location, assign, origin: url.origin, pathname: url.pathname, search: url.search })
}

beforeEach(() => at('/sign-in/'))
afterEach(() => {
  cleanup()
  signIn = null
  account = null
  localStorage.clear()
  sessionStorage.clear()
  assign.mockReset()
  vi.unstubAllGlobals()
})

const session = { sessionToken: 'sess-1', created: false }

describe('useSignIn', () => {
  it('signs in by email and password, keeps the session for this visit only without "Keep me signed in", and goes to the account', async () => {
    const asked = shopAnswering((a) => (a.query.includes('signInOptions') ? { data: { signInOptions: { email: true, phone: false } } } : { data: { signIn: session } }))
    await show('signIn')
    expect(shown(signIn).ways).toEqual({ email: true, phone: false })
    let problems = {}
    await act(async () => {
      problems = await shown(signIn).signIn({ email: 'maya', password: '', remember: false })
    })
    expect(problems).toEqual({ email: 'invalid', password: 'required' })
    await act(async () => {
      problems = await shown(signIn).signIn({ email: ' maya@example.com ', password: 'correct horse', remember: false })
    })
    expect(problems).toEqual({})
    expect(asked.find((a) => a.query.includes('signIn('))?.variables).toEqual({ email: 'maya@example.com', password: 'correct horse' })
    expect(sessionStorage.getItem('df-session')).toBe('sess-1')
    expect(localStorage.getItem('df-session')).toBeNull()
    expect(assign).toHaveBeenCalledWith('/account/')
  })

  it('says why a sign-in was refused, and goes on to ?next= once in, remembering the session when asked', async () => {
    at('/sign-in/?next=/checkout/')
    let refuse = true
    shopAnswering((a) =>
      a.query.includes('signInOptions') ? { data: { signInOptions: { email: true, phone: true } } } : refuse ? { errors: [{ message: 'no', extensions: { code: 'SIGN_IN_REFUSED' } }] } : { data: { signIn: session } },
    )
    await show('signIn')
    await act(async () => void (await shown(signIn).signIn({ email: 'maya@example.com', password: 'wrong one!', remember: true })))
    expect(shown(signIn).error).toBe('SIGN_IN_REFUSED')
    expect(shopperToken('session')).toBeUndefined()
    refuse = false
    await act(async () => void (await shown(signIn).signIn({ email: 'maya@example.com', password: 'correct horse', remember: true })))
    expect(shown(signIn).error).toBeNull()
    expect(localStorage.getItem('df-session')).toBe('sess-1')
    expect(assign).toHaveBeenCalledWith('/checkout/')
  })

  it('signs in by a mobile code: asks for it, then proves it, and never follows ?next= off the shop', async () => {
    at('/sign-in/?next=//evil.example/')
    const asked = shopAnswering((a) =>
      a.query.includes('signInOptions') ? { data: { signInOptions: { email: true, phone: true } } } : a.query.includes('requestSignInCode') ? { data: { requestSignInCode: true } } : { data: { verifySignInCode: { ...session, created: true } } },
    )
    await show('signIn')
    let problems = {}
    await act(async () => {
      problems = await shown(signIn).sendCode({ channel: 'phone', to: '12' })
    })
    expect(problems).toEqual({ to: 'invalid' })
    await act(async () => void (await shown(signIn).sendCode({ channel: 'phone', to: '+91 98765 43210' })))
    expect(shown(signIn).sent).toEqual({ channel: 'phone', to: '+91 98765 43210' })
    expect(asked.find((a) => a.query.includes('requestSignInCode'))?.variables).toEqual({ channel: 'PHONE', to: '+91 98765 43210' })
    await act(async () => {
      problems = await shown(signIn).verify({ code: '12a', remember: true })
    })
    expect(problems).toEqual({ code: 'invalid' })
    await act(async () => void (await shown(signIn).verify({ code: '123456', remember: true })))
    expect(asked.find((a) => a.query.includes('verifySignInCode'))?.variables).toEqual({ channel: 'PHONE', to: '+91 98765 43210', code: '123456', name: null, password: null })
    expect(assign).toHaveBeenCalledWith('/account/')
  })

  it('creates an account, or sets a new password, with an email code, a name and a password of at least 10 characters', async () => {
    const asked = shopAnswering((a) => (a.query.includes('requestSignInCode') ? { data: { requestSignInCode: true } } : a.query.includes('signInOptions') ? { data: { signInOptions: { email: true, phone: true } } } : { data: { verifySignInCode: { ...session, created: true } } }))
    await show('signIn')
    await act(async () => void (await shown(signIn).sendCode({ channel: 'email', to: 'maya@example.com' })))
    let problems = {}
    await act(async () => {
      problems = await shown(signIn).verify({ code: '123456', name: ' ', password: 'short', remember: true })
    })
    expect(problems).toEqual({ name: 'required', password: 'invalid' })
    await act(async () => void (await shown(signIn).verify({ code: '123456', name: 'Maya Chen', password: 'a long password', remember: true })))
    expect(asked.find((a) => a.query.includes('verifySignInCode'))?.variables).toEqual({ channel: 'EMAIL', to: 'maya@example.com', code: '123456', name: 'Maya Chen', password: 'a long password' })
    act(() => shown(signIn).restart())
    expect(shown(signIn).sent).toBeNull()
  })

  it('asks the Shop API nothing on a preview, where nobody signs in', async () => {
    const asked = shopAnswering(() => ({ data: {} }))
    await show('signIn', 'preview')
    expect(shown(signIn).previewOnly).toBe(true)
    await act(async () => void (await shown(signIn).signIn({ email: 'maya@example.com', password: 'correct horse', remember: true })))
    expect(shown(signIn).error).toBe('NOT_IN_PREVIEW')
    expect(asked).toHaveLength(0)
  })
})

const raw = { id: 'cu-1', name: 'Maya Chen', email: 'maya@example.com', phone: null, emailVerified: true, phoneVerified: false, addresses: [{ id: 'a-1', name: 'Maya Chen', line1: '88 Neil Ave', line2: null, city: 'Columbus', region: 'OH', postalCode: '43215', country: 'US', phone: null, isDefault: true }] }

describe('useAccount', () => {
  it('is signed out without a session, and on a preview, asking nothing', async () => {
    const asked = shopAnswering(() => ({ data: { account: raw } }))
    await show('account')
    expect(shown(account).status).toBe('signedOut')
    cleanup()
    sessionStorage.setItem('df-session', 'sess-1')
    await show('account', 'preview')
    expect(shown(account).status).toBe('signedOut')
    expect(asked).toHaveLength(0)
  })

  it('reads the signed-in shopper’s details and addresses, and is signed out once the session has ended', async () => {
    sessionStorage.setItem('df-session', 'sess-1')
    let ended = false
    const asked = shopAnswering(() => ({ data: { account: ended ? null : raw, store: { markets: [{ countries: ['US', 'CA'] }, { countries: ['US'] }] } } }))
    await show('account')
    expect(asked.map((a) => a.query.includes('account {'))).toEqual([true])
    expect(shown(account).countries).toEqual(['US', 'CA'])
    expect(shown(account)).toMatchObject({ status: 'ready', account: { name: 'Maya Chen', email: 'maya@example.com', emailVerified: true, addresses: [{ id: 'a-1', line1: '88 Neil Ave', line2: '', isDefault: true }] } })
    ended = true
    await act(async () => shown(account).retry())
    expect(shown(account).status).toBe('signedOut')
  })

  it('renames, saves an address after core’s checks, removes one, each asking the account again; a refusal is kept', async () => {
    sessionStorage.setItem('df-session', 'sess-1')
    let refuse = false
    const asked = shopAnswering((a) => (a.query.includes('account {') ? { data: { account: raw } } : refuse ? { errors: [{ message: 'no', extensions: { code: 'TOO_MANY' } }] } : { data: { updateAccount: true, saveAddress: 'a-2', deleteAddress: true } }))
    await show('account')
    await act(async () => void (await shown(account).rename(' Maya ')))
    expect(asked.find((a) => a.query.includes('updateAccount'))?.variables).toEqual({ name: 'Maya' })
    const draft = { name: 'Maya Chen', line1: '1 Main St', line2: '', city: 'Austin', region: 'TX', postalCode: '7870', country: 'US', phone: '' }
    let problems: unknown = null
    await act(async () => {
      problems = await shown(account).saveAddress({ id: null, address: draft, isDefault: false })
    })
    expect(problems).toEqual({ postalCode: 'invalid' })
    await act(async () => {
      problems = await shown(account).saveAddress({ id: null, address: { ...draft, postalCode: '78701', phone: '(555) 123-4567' }, isDefault: false })
    })
    expect(problems).toEqual({ phone: 'invalid' })
    await act(async () => {
      problems = await shown(account).saveAddress({ id: null, address: { ...draft, postalCode: '78701' }, isDefault: true })
    })
    expect(problems).toEqual({})
    expect(asked.find((a) => a.query.includes('saveAddress'))?.variables).toEqual({ id: null, isDefault: true, address: { name: 'Maya Chen', line1: '1 Main St', line2: null, city: 'Austin', region: 'TX', postalCode: '78701', country: 'US', phone: null } })
    refuse = true
    await act(async () => void (await shown(account).removeAddress('a-1')))
    expect(shown(account).error).toEqual({ code: 'TOO_MANY', of: 'addresses' })
    expect(asked.filter((a) => a.query.includes('account {')).length).toBeGreaterThanOrEqual(3)
  })

  it('makes a saved address the default as it was saved, and keeps the Shop API’s refusal to show', async () => {
    sessionStorage.setItem('df-session', 'sess-1')
    // Saved before today's checks: no state, which core would now ask for.
    const old = { ...raw, addresses: [{ ...raw.addresses[0], id: 'a-2', region: null, isDefault: false }] }
    let refuse = false
    const asked = shopAnswering((a) => (a.query.includes('account {') ? { data: { account: old } } : refuse ? { errors: [{ message: 'no', extensions: { code: 'INVALID_INPUT' } }] } : { data: { saveAddress: 'a-2' } }))
    await show('account')
    let made = false
    await act(async () => {
      made = await shown(account).makeDefault('a-2')
    })
    expect(made).toBe(true)
    expect(asked.find((a) => a.query.includes('saveAddress'))?.variables).toEqual({ id: 'a-2', isDefault: true, address: { name: 'Maya Chen', line1: '88 Neil Ave', line2: null, city: 'Columbus', region: null, postalCode: '43215', country: 'US', phone: null } })
    refuse = true
    await act(async () => {
      made = await shown(account).makeDefault('a-2')
    })
    expect(made).toBe(false)
    expect(shown(account).error).toEqual({ code: 'INVALID_INPUT', of: 'addresses' })
  })

  it('says which part a refusal came from, and is signed out when the session ended during a change', async () => {
    sessionStorage.setItem('df-session', 'sess-1')
    let code = 'INVALID_INPUT'
    shopAnswering((a) => (a.query.includes('account {') ? { data: { account: raw } } : { errors: [{ message: 'no', extensions: { code } }] }))
    await show('account')
    await act(async () => void (await shown(account).rename('Maya')))
    expect(shown(account).error).toEqual({ code: 'INVALID_INPUT', of: 'details' })
    code = 'SIGNED_OUT'
    await act(async () => void (await shown(account).removeAddress('a-1')))
    expect(shopperToken('session')).toBeUndefined()
    expect(shown(account).status).toBe('signedOut')
  })

  it('signs out: ends the session on the server, forgets it here, and goes home', async () => {
    localStorage.setItem('df-session', 'sess-1')
    const asked = shopAnswering((a) => (a.query.includes('signOut') ? { data: { signOut: true } } : { data: { account: raw } }))
    await show('account')
    await act(async () => shown(account).signOut())
    expect(asked.some((a) => a.query.includes('signOut'))).toBe(true)
    expect(shopperToken('session')).toBeUndefined()
    expect(assign).toHaveBeenCalledWith('/')
  })
})
