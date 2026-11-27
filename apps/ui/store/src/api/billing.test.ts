import { afterEach, describe, expect, it, vi } from 'vitest'

const answering = (url: string | null) => vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ data: { downloadInvoice: url } })))

afterEach(() => vi.unstubAllGlobals())

describe('an invoice’s PDF', () => {
  it('opens Stripe’s PDF and Razorpay’s invoice page (#1759)', async () => {
    const { invoicePdf } = await import('./billing')
    for (const url of ['https://pay.stripe.com/invoice/x/pdf', 'https://rzp.io/i/inv_T0001', 'https://invoices.razorpay.com/inv_T0001']) {
      answering(url)
      expect(await invoicePdf('i1')).toBe(url)
    }
  })

  it('refuses a link on any other host, or none', async () => {
    const { invoicePdf } = await import('./billing')
    for (const url of ['https://rzp.io.evil.example/i/x', 'http://rzp.io/i/x', 'https://razorpay.com.evil.example/x', null]) {
      answering(url)
      await expect(invoicePdf('i1')).rejects.toMatchObject({ code: 'NO_PDF' })
    }
  })
})
