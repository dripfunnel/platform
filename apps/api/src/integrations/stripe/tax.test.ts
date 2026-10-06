import { describe, expect, it } from 'vitest'
import { StripeRefused, StripeUnavailable } from './api'
import { stripeTax } from './tax'

describe('Stripe Tax on a connected account', () => {
  it('asks for one calculation on the merchant’s account, each line with its tax code, and reads the tax back', async () => {
    let asked: { url: string; account: string | null; body: URLSearchParams } | null = null
    const tax = stripeTax({
      secretKey: 'sk_test_x',
      fetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers)
        asked = { url: String(url), account: headers.get('stripe-account'), body: new URLSearchParams(String(init?.body)) }
        return Response.json({ tax_amount_exclusive: 115, tax_amount_inclusive: 0, line_items: { data: [{ reference: 'v1', amount_tax: 115 }] } })
      },
    })
    const result = await tax.calculate({ accountId: 'acct_123', currency: 'USD', inclusive: false, shipTo: { country: 'US', region: 'OH', postal: '43215' }, lines: [{ reference: 'v1', amount: 2000n, taxCode: 'txcd_99999999' }] })
    expect(result).toEqual({ total: 115n, lines: [{ reference: 'v1', amount: 115n }] })
    expect(asked).toMatchObject({ url: 'https://api.stripe.com/v1/tax/calculations', account: 'acct_123' })
    const body = (asked as unknown as { body: URLSearchParams }).body
    expect(Object.fromEntries(body)).toMatchObject({ currency: 'usd', 'customer_details[address][state]': 'OH', 'line_items[0][amount]': '2000', 'line_items[0][tax_code]': 'txcd_99999999', 'line_items[0][tax_behavior]': 'exclusive' })
  })

  it('says Stripe is down when it is, and refused when it refuses', async () => {
    const request = { accountId: 'acct_1', currency: 'USD', inclusive: false, shipTo: { country: 'US', region: null, postal: null }, lines: [] }
    await expect(stripeTax({ secretKey: 'k', fetchImpl: async () => new Response('', { status: 503 }) }).calculate(request)).rejects.toBeInstanceOf(StripeUnavailable)
    await expect(stripeTax({ secretKey: 'k', fetchImpl: async () => Response.json({ error: { code: 'x' } }, { status: 400 }) }).calculate(request)).rejects.toBeInstanceOf(StripeRefused)
  })
})
