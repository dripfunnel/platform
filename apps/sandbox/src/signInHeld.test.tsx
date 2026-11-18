// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReactNode } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyCodemods, coreUpgradeNotes, notesBetween } from '@dripfunnel/storefront-core/guard'
import { completeStore, createShopClient, StorefrontProvider } from '@dripfunnel/storefront-core'

// #1490: the sign-in and create-account pages draw only their heading until the store's setting is known, then the right
// form once; a store made before it gets the same view from core's upgrade.

const here = dirname(fileURLToPath(import.meta.url))
const themeFile = (theme: string, path: string) => resolve(here, '../../../templates/storefront/themes', theme, path)
const viewPath = 'src/theme/components/interactive/SignInView.tsx'
type View = (props: { purpose: 'signIn' | 'register' | 'reset' }) => ReactNode
const viewOf = async (theme: string): Promise<View> => ((await import(/* @vite-ignore */ themeFile(theme, viewPath))) as { SignInView: View }).SignInView
// Classic is rendered here; the other starting themes' views are the same lines, checked below (Baseline imports `clsx`, which a browser-like test can't resolve here).
const Classic = await viewOf('classic')

// The theme's own English words (`shop.json` is the `shop.` keys, `pages.json` the `pages.` keys).
const words: Record<string, string> = {}
const flatten = (prefix: string, value: unknown) => {
  if (typeof value === 'string') words[prefix] = value
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) flatten(`${prefix}.${k}`, v)
}
flatten('shop', JSON.parse(readFileSync(themeFile('classic', 'content/en/shop.json'), 'utf8')))
flatten('pages', JSON.parse(readFileSync(themeFile('classic', 'content/en/pages.json'), 'utf8')))
const t = ((key: string) => words[key] ?? key) as never
const store = completeStore({ name: 'Baby Cloth', mainLanguage: 'en', pricingCurrency: 'USD', pricesIncludeTax: false, timeZone: 'UTC' })

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

/** The page, with the Shop API's answer to `signInOptions` held back until `answer` is called. */
const show = (View: View, purpose: 'signIn' | 'register') => {
  let answer: (ways: { email: boolean; phone: boolean }) => void = () => undefined
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (answer = (ways) => resolve(Response.json({ data: { signInOptions: ways } }))))))
  render(
    <StorefrontProvider value={{ client: createShopClient(), store, locale: 'en-US', mode: 'live', poweredBy: null, t }}>
      <View purpose={purpose} />
    </StorefrontProvider>,
  )
  return (ways: { email: boolean; phone: boolean }) => act(async () => answer(ways))
}
const mobileTab = () => screen.queryByRole('button', { name: 'Mobile number' })
const emailTab = () => screen.queryByRole('button', { name: 'Email' })

describe.each([
  ['Classic', Classic, 'signIn'],
  ['Classic', Classic, 'register'],
] as const)('the %s %s page', (_, View, purpose) => {
  const title = purpose === 'signIn' ? 'Sign in' : 'Create an account'

  it('shows only its heading, with no tabs or fields, until the store answers', () => {
    show(View, purpose)
    expect(screen.getByRole('heading', { name: title })).toBeTruthy()
    expect(document.querySelectorAll('input, button, form')).toHaveLength(0)
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
  })

  it('draws Email and password alone, and never the Mobile number tab, once the store answers email only', async () => {
    const answer = show(View, purpose)
    expect(mobileTab()).toBeNull()
    await answer({ email: true, phone: false })
    expect(screen.getByLabelText('Email')).toBeTruthy()
    expect(mobileTab()).toBeNull()
    expect(emailTab()).toBeNull()
    await act(async () => new Promise((resolve) => setTimeout(resolve, 30)))
    expect(mobileTab()).toBeNull()
    expect(screen.getByLabelText('Email')).toBeTruthy()
  })

  it('draws both tabs at the first draw of the form when the store answers Both', async () => {
    const answer = show(View, purpose)
    expect([mobileTab(), emailTab()]).toEqual([null, null])
    await answer({ email: true, phone: true })
    expect(emailTab()).toBeTruthy()
    expect(mobileTab()).toBeTruthy()
  })

  it('draws the mobile form alone when the store answers Mobile number only', async () => {
    const answer = show(View, purpose)
    await answer({ email: false, phone: true })
    expect(screen.getByLabelText('Mobile number')).toBeTruthy()
    expect(screen.queryByLabelText('Email')).toBeNull()
    expect([emailTab(), mobileTab()]).toEqual([null, null])
  })
})

describe('the sign-in view for a store made before #1490', () => {
  const themes = ['classic', 'baseline', 'beauty', 'electronics', 'fashion', 'grocery', 'home', 'jewelry']
  const held = /\n {2}\/\/ The store's setting isn't known until it answers:[\s\S]*?\n {2}}\n/
  const read = (theme: string) => readFileSync(themeFile(theme, viewPath), 'utf8').replace(/\r\n/g, '\n')
  const codemods = notesBetween('1.0.0', '2.0.0', coreUpgradeNotes).flatMap((n) => n.codemods)

  it.each(themes)('brings the shipped %s view back exactly from the one before, and a second run changes nothing', (theme) => {
    const shipped = read(theme)
    const before = new Map([[viewPath, shipped.replace(held, '')]])
    expect(before.get(viewPath)).not.toBe(shipped)
    expect(before.get(viewPath)).not.toContain('waysKnown')
    const once = applyCodemods(before, codemods)
    expect(once.get(viewPath)).toBe(shipped)
    expect(applyCodemods(once, codemods).get(viewPath)).toBe(shipped)
  })

  it.each(themes)('has the %s view hold its form, with the heading alone, right after its preview check, before it reads any way', (theme) => {
    const view = read(theme)
    const held = view.indexOf('if (!s.waysKnown) {')
    expect(held).toBeGreaterThan(view.indexOf('if (s.previewOnly) {'))
    expect(held).toBeLessThan(view.indexOf('s.ways.email'))
    expect(view.slice(held, held + 220)).toContain('aria-busy="true"')
  })

  it('leaves a theme whose sign-in view is its own as it is', () => {
    const custom = new Map([[viewPath, "export const SignInView = () => <form><input type='email' /></form>\n"]])
    expect(applyCodemods(custom, codemods).get(viewPath)).toBe(custom.get(viewPath))
  })
})
