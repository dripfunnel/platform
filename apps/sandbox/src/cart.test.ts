import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { cartApi } from './test/cart'
import { chrome, previewOrigin, startPreview, type Preview, type ShopRequest } from './test/preview'

// Card #313: the baseline theme's cart page in preview mode, against a cart the test's Shop API keeps.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

let preview: Preview | null = null
beforeAll(async () => {
  if (chrome) preview = await startPreview()
})
afterAll(async () => preview?.close())

const openCart = async (answer: (r: ShopRequest) => unknown, token = true) => {
  if (!preview) throw new Error('no browser')
  const context = await preview.open(answer)
  if (token) await context.addInitScript(() => localStorage.setItem('df-cart', 'tok'))
  const page = await context.newPage()
  await page.goto(`${previewOrigin}/cart/`)
  return { context, page }
}

describe.skipIf(!chrome)('the baseline cart page', () => {
  it('changes a quantity, keeps − off at one, and applies a code with the theme’s words', async () => {
    const api = cartApi([{ versionId: 'a', quantity: 1, problem: null, available: 5 }])
    const { context, page } = await openCart(api.answer)
    try {
      await page.getByRole('heading', { level: 1, name: 'Your cart' }).waitFor()
      expect(await page.getByRole('button', { name: 'One fewer' }).isDisabled()).toBe(true)
      await page.getByRole('button', { name: 'One more' }).click()
      await expect.poll(() => page.getByRole('group', { name: 'Quantity of Tee a' }).textContent()).toContain('2')
      expect(api.state.lines[0]?.quantity).toBe(2)
      await page.getByLabel('Discount code').fill('nope')
      await page.getByRole('button', { name: 'Apply' }).click()
      await page.getByRole('alert').filter({ hasText: "That code isn't valid. Check it and try again." }).waitFor()
      await page.getByLabel('Discount code').fill('AUTUMN')
      await page.getByRole('button', { name: 'Apply' }).click()
      await page.getByText('Code applied.').waitFor()
      expect(await page.getByRole('button', { name: 'Remove the code AUTUMN' }).count()).toBe(1)
    } finally {
      await context.close()
    }
  })

  it('says why a line can’t be bought and holds Checkout back until it is changed', async () => {
    const api = cartApi([{ versionId: 'a', quantity: 3, problem: 'short', available: 2 }])
    const { context, page } = await openCart(api.answer)
    try {
      await page.getByText('Only 2 left').waitFor()
      await page.getByText("Something in your cart can't be bought right now. Change or remove it to check out.").waitFor()
      expect(await page.getByRole('link', { name: 'Checkout' }).count()).toBe(0)
      expect(await page.getByRole('button', { name: 'Checkout' }).isDisabled()).toBe(true)
    } finally {
      await context.close()
    }
  })

  it('takes a refused change back and says so', async () => {
    const api = cartApi([{ versionId: 'a', quantity: 1, problem: null, available: 5 }])
    api.state.refuse = true
    const { context, page } = await openCart(api.answer)
    try {
      await page.getByRole('button', { name: 'One more' }).click()
      await page.getByRole('alert').filter({ hasText: "That change didn't go through. Try again." }).waitFor()
      expect(await page.getByRole('group', { name: 'Quantity of Tee a' }).textContent()).toContain('1')
    } finally {
      await context.close()
    }
  })

  it('shows the empty state without a cart, and the failed state with Try again', async () => {
    const api = cartApi([])
    const empty = await openCart(api.answer, false)
    try {
      await empty.page.getByRole('heading', { level: 1, name: 'Your cart is empty' }).waitFor()
    } finally {
      await empty.context.close()
    }
    api.state.down = true
    api.state.lines = [{ versionId: 'a', quantity: 1, problem: null, available: 5 }]
    const failed = await openCart(api.answer)
    try {
      await failed.page.getByRole('heading', { level: 1, name: "We couldn't load your cart" }).waitFor()
      api.state.down = false
      await failed.page.getByRole('button', { name: 'Try again' }).click()
      await failed.page.getByRole('heading', { level: 1, name: 'Your cart' }).waitFor()
    } finally {
      await failed.context.close()
    }
  })
})
