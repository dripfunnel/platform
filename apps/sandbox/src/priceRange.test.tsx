import type { ReactNode } from 'react'
import { fileURLToPath } from 'node:url'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { completeStore, createShopClient, moneySchema, PrefilledProvider, StorefrontProvider } from '@dripfunnel/storefront-core'

// #1330: Classic draws a product whose versions differ in price as a range, on its cards and on its page until a version is picked.

// The theme's own source, loaded by path: the sandbox never typechecks a theme (its CSS Modules and packages are the theme's own).
const themeFile = (path: string) => fileURLToPath(new URL(`../../../templates/storefront/themes/classic/src/theme/${path}`, import.meta.url))
const { ProductCard } = (await import(/* @vite-ignore */ themeFile('components/ProductCard.tsx'))) as { ProductCard: (props: { product: unknown }) => ReactNode }
const { ProductPage } = (await import(/* @vite-ignore */ themeFile('pages/ProductPage.tsx'))) as { ProductPage: () => ReactNode }

const store = completeStore({ name: 'Smstore', mainLanguage: 'en', pricingCurrency: 'INR', pricesIncludeTax: true, timeZone: 'Asia/Kolkata' })
const inr = (amount: number) => moneySchema.parse({ amount: String(amount), currency: 'INR' })
const range = '₹4,999.00 – ₹5,399.00'

const render = (element: unknown, address: string, answers = new Map<string, unknown>()) =>
  renderToString(
    <StorefrontProvider value={{ client: createShopClient(), store, locale: 'en-IN', mode: 'live', poweredBy: null }} address={address}>
      <PrefilledProvider value={{ answers: { has: (k) => answers.has(k), get: (k) => answers.get(k) } }}>{element as never}</PrefilledProvider>
    </StorefrontProvider>,
  )

/** What the page's sealed price says, with the markup taken out. */
const priceOf = (html: string) => {
  const hosts = [...html.matchAll(/data-df-sealed="price"[^>]*>([\s\S]*?)<\/df-sealed>/g)].map((m) => (m[1] ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim())
  return hosts
}

const card = (maxPrice: number | null) => ({ id: 'p1', name: 'Kurta', href: '/products/kurta/', price: inr(499900), compareAt: inr(600000), from: maxPrice !== null, maxPrice: maxPrice === null ? null : inr(maxPrice), stock: { inStock: true, available: null }, photo: null, badges: [] })

describe('the Classic product card', () => {
  it('shows the range with the tax label once, and no "From" or crossed-out price, when the versions differ in price', () => {
    const html = render(<ProductCard product={card(539900)} />, '/collections/all/')
    expect(priceOf(html)).toEqual([`${range} incl. tax`])
    expect(html).not.toContain('From')
  })

  it('shows one price, as before, when every version costs the same', () => {
    const html = render(<ProductCard product={card(null)} />, '/collections/all/')
    expect(priceOf(html)).toEqual(['₹4,999.00 ₹6,000.00 incl. tax'])
    expect(html).not.toContain('From')
  })
})

const product = (maxPrice: number | null) => ({
  id: 'p1', name: 'Kurta', slug: 'kurta', productType: 'physical', giftCard: null, download: null, service: null, description: null, highlights: [], inStock: true,
  price: inr(499900), compareAt: null, maxPrice: maxPrice === null ? null : inr(maxPrice), badges: [], photos: [], video: null,
  options: [{ id: 'size', name: 'Size', values: [{ id: 's', name: 'Small' }, { id: 'l', name: 'Large' }] }],
  versions: [
    { id: 'v-s', name: null, choices: [{ optionId: 'size', valueId: 's' }], price: inr(499900), compareAt: null, inStock: true, available: 4 },
    { id: 'v-l', name: null, choices: [{ optionId: 'size', valueId: 'l' }], price: inr(maxPrice ?? 499900), compareAt: null, inStock: true, available: 4 },
  ],
  specs: [], faqs: [], sizeChart: null, compliance: [], returns: null, warranty: null, seoTitle: null, seoDescription: null, related: [], questions: [], story: [], storyTemplate: null,
})
const answerFor = (maxPrice: number | null) => new Map<string, unknown>([[JSON.stringify(['product', 'kurta']), { product: product(maxPrice), store: null }]])

describe('the Classic product page', () => {
  it('shows the range before a version is picked', () => {
    const html = render(<ProductPage />, '/products/kurta/', answerFor(539900))
    expect(priceOf(html)[0]).toBe(`${range} incl. tax`)
    expect(html).not.toContain('From')
  })

  it('shows the picked version’s own price, and not the range', () => {
    expect(priceOf(render(<ProductPage />, '/products/kurta/v-l/', answerFor(539900)))[0]).toBe('₹5,399.00 incl. tax')
    expect(priceOf(render(<ProductPage />, '/products/kurta/v-s/', answerFor(539900)))[0]).toBe('₹4,999.00 incl. tax')
  })

  it('shows one price, with no "From" and no range, when every version costs the same', () => {
    const html = render(<ProductPage />, '/products/kurta/', answerFor(null))
    expect(priceOf(html)[0]).toBe('₹4,999.00 incl. tax')
    expect(html).not.toContain('From')
  })
})
