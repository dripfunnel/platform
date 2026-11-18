// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { completeStore, createShopClient, StorefrontProvider } from '@dripfunnel/storefront-core'

// #1292: the Classic theme's Add to cart button says "Adding…", with a spinner, from the press until the engine answers.

// Built from the file's own path: happy-dom's URL is not the one `fileURLToPath` takes.
const here = dirname(fileURLToPath(import.meta.url))
const themeFile = (path: string) => resolve(here, '../../../templates/storefront/themes/classic', path)
const { BuyButtons } = (await import(/* @vite-ignore */ themeFile('src/theme/components/interactive/BuyButtons.tsx'))) as { BuyButtons: (props: { page: never }) => ReactNode }

// The theme's own English words, as its content files give them (`shop.json` is the `shop.` keys).
const words: Record<string, string> = {}
const flatten = (prefix: string, value: unknown) => {
  if (typeof value === 'string') words[prefix] = value
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) flatten(`${prefix}.${k}`, v)
}
flatten('shop', JSON.parse(readFileSync(themeFile('content/en/shop.json'), 'utf8')))
const t = ((key: string) => words[key] ?? key) as never

const store = completeStore({ name: 'Baby Cloth', mainLanguage: 'en', pricingCurrency: 'USD', pricesIncludeTax: false, timeZone: 'UTC' })
const page = { product: null, version: { id: 'v1', stock: { inStock: true } } } as never

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const show = () =>
  render(
    <StorefrontProvider value={{ client: createShopClient(), store, locale: 'en-US', mode: 'live', poweredBy: null, t }}>
      <BuyButtons page={page} />
    </StorefrontProvider>,
  )

describe('the Classic Add to cart button while adding', () => {
  it('says "Adding…" with a spinner from the press, disabled and aria-busy, and goes back when the engine answers', async () => {
    let answer = () => {}
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => (answer = () => resolve(Response.json({ errors: [{ message: 'gone', extensions: { code: 'UNAVAILABLE' } }] }))))))
    show()
    const button = screen.getByRole('button', { name: 'Add to cart' })
    expect(button.querySelector('span')).toBeNull()
    expect(button.getAttribute('aria-busy')).toBeNull()

    await act(async () => void fireEvent.click(button))
    expect(screen.getByRole('button', { name: 'Adding…' })).toBe(button)
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button).toHaveProperty('disabled', true)
    // The spinner is decoration: a screen reader hears the words and the busy state, not a ring.
    expect(button.querySelector('span')?.getAttribute('aria-hidden')).toBe('true')

    await act(async () => answer())
    expect(screen.getByRole('button', { name: 'Add to cart' })).toBe(button)
    expect(button.getAttribute('aria-busy')).toBeNull()
    expect(button).toHaveProperty('disabled', false)
    // A failed add still says so, as before.
    expect(screen.getByRole('status').textContent).toBe("We couldn't add that. Try again.")
  })

  it('has its words in the theme’s content, and no spinner under reduced motion, where a ring that cannot turn would look broken', () => {
    expect(words['shop.product.adding']).toBe('Adding…')
    const css = readFileSync(themeFile('src/theme/styles/shop.module.css'), 'utf8').replace(/\r\n/g, '\n').replace(/\s+/g, ' ')
    expect(css).toMatch(/\.spinner \{[^}]*animation: spin [^}]*\}/)
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.spinner \{ display: none; \} \}/)
  })
})
