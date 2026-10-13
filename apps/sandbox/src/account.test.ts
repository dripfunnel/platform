import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { basics, chrome, previewOrigin, startPreview, type Preview, type ShopRequest } from './test/preview'

// Card #313: the baseline theme's sign-in and account pages on a preview, where nobody signs in (PREVIEW §5 step 5);
// signing in on a live shop is core's useSignIn and useAccount, tested in storefront-core.
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })

let preview: Preview | null = null
beforeAll(async () => {
  if (chrome) preview = await startPreview()
})
afterAll(async () => preview?.close())

const visit = async (path: string) => {
  if (!preview) throw new Error('no browser')
  const asked: ShopRequest[] = []
  const context = await preview.open((r) => (asked.push(r), basics(r)))
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${previewOrigin}${path}`)
  return { context, page, asked, errors }
}

describe.skipIf(!chrome)('the baseline account pages on a preview', () => {
  it.each(['/sign-in/', '/register/', '/forgot-password/'])('%s says signing in works on the live shop, and asks the Shop API nothing about accounts', async (path) => {
    const { context, page, asked, errors } = await visit(path)
    try {
      await page.getByText('Signing in works on the live shop. On this preview you check out as a guest.').waitFor()
      expect(await page.getByRole('textbox').count()).toBe(0)
      expect(asked.some((r) => /signIn|SignInCode|account \{/.test(r.query))).toBe(false)
      expect(errors).toEqual([])
    } finally {
      await context.close()
    }
  })

  it('sends the account to sign in, which says the same', async () => {
    const { context, page, asked } = await visit('/account/addresses/')
    try {
      await page.waitForURL(`${previewOrigin}/sign-in/?next=%2Faccount%2Faddresses%2F`)
      await page.getByText('Signing in works on the live shop. On this preview you check out as a guest.').waitFor()
      expect(asked.some((r) => r.query.includes('account {'))).toBe(false)
    } finally {
      await context.close()
    }
  })
})
