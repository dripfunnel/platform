// @vitest-environment happy-dom
import { act, cleanup, render, screen } from '@testing-library/react'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Brand } from '../../api/brand'
import { setBrand } from '../../brand/current'
import { fill, messages } from '../../messages'
import { SignIn } from './SignIn'
import { SignUp } from './SignUp'

// "Continue with Google" on Sign in and Create your store (#1047; ACCESS.md §2): shown only while the partner's
// client is on, and every way back from Google worded.

const words = messages.auth
const brand = (googleSignIn: boolean): Brand => ({
  productName: 'Northstar Shops',
  primaryColor: null,
  accentColor: null,
  font: null,
  corner: null,
  background: null,
  files: { logoLight: null, logoDark: null, mark: null, favicon: null },
  supportEmail: null,
  supportUrl: null,
  helpUrl: null,
  termsUrl: null,
  privacyUrl: null,
  poweredBy: true,
  googleSignIn,
})

const show = async (element: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => element }), history: createMemoryHistory({ initialEntries: ['/'] }) })
  await act(async () => {
    render(<RouterProvider router={router} />)
  })
  return router
}

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const googleLink = () => screen.queryByRole('link', { name: words.google.button })

beforeEach(() => setBrand(brand(true)))
afterEach(() => {
  cleanup()
  setBrand(null)
  vi.unstubAllGlobals()
})

describe('the Google button', () => {
  it('starts Google sign-in, coming back to the store chooser and the page the person was going to', async () => {
    await show(<SignIn next="/orders" />)
    const href = new URL(googleLink()?.getAttribute('href') ?? '', 'https://store.example')
    expect(href.pathname).toBe('/api/auth/google/start')
    expect(href.searchParams.get('intent')).toBe('sign-in')
    expect(href.searchParams.get('next')).toBe('/stores?next=%2Forders')
    expect(screen.getByText(words.google.or)).toBeTruthy()
  })

  it('starts Google sign-up from Create your store', async () => {
    await show(<SignUp />)
    expect(googleLink()?.getAttribute('href')).toBe('/api/auth/google/start?intent=sign-up')
  })

  it('isn’t there while the partner has no Google client on', async () => {
    setBrand(brand(false))
    await show(<SignIn next={undefined} />)
    expect(googleLink()).toBeNull()
    expect(screen.queryByText(words.google.or)).toBeNull()
    cleanup()
    await show(<SignUp />)
    expect(googleLink()).toBeNull()
  })
})

describe('back from Google', () => {
  it('says there’s no account for the address, naming the partner, and offers Create your store', async () => {
    await show(<SignIn next={undefined} google="no-account" />)
    expect(screen.getByText(fill(words.google.outcomes.noAccount, { product: 'Northstar Shops' }))).toBeTruthy()
    expect(screen.getByRole('button', { name: words.signIn.footLink })).toBeTruthy()
  })

  it('words a cancel, an outage, a refusal and too many tries', async () => {
    for (const [outcome, text] of [['cancelled', words.google.outcomes.cancelled], ['unavailable', words.google.outcomes.unavailable], ['refused', words.google.outcomes.refused], ['busy', words.rateLimited]] as const) {
      await show(<SignIn next={undefined} google={outcome} />)
      expect(screen.getByText(text)).toBeTruthy()
      cleanup()
    }
  })

  it('shows the lock the account is under', async () => {
    await show(<SignIn next={undefined} google={{ locked: 12 }} />)
    expect(screen.getByText(fill(words.locked.title, { minutes: '12' }))).toBeTruthy()
  })

  it('carries a Google sign-up on at the store step with what the API knows of it', async () => {
    const asked: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      asked.push(url)
      return new Response(JSON.stringify({ ok: true, step: 'store', name: 'Zoë New', email: 'zoe@gmail.example', countries: [{ code: 'US', name: 'United States', currency: 'USD' }], shopDomain: 'my-store.one' }))
    })
    await show(<SignUp fromGoogle />)
    await settle()
    expect(asked).toEqual(['/api/auth/sign-up/resume'])
    expect(screen.getByRole('heading', { name: words.signup.su3.title })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'United States · USD' })).toBeTruthy()
  })

  it('starts again when the sign-up Google opened has gone, and says why it couldn’t start', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: false, code: 'SIGNUP_EXPIRED' }), { status: 400 }))
    await show(<SignUp fromGoogle />)
    await settle()
    expect(screen.getByRole('heading', { name: words.signup.su1.title })).toBeTruthy()
    expect(screen.getByText(words.signup.expired)).toBeTruthy()
    cleanup()
    await show(<SignUp google="closed" />)
    expect(screen.getByText(words.signup.su1.closed)).toBeTruthy()
  })
})
