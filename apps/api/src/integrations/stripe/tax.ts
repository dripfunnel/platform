import { z } from 'zod'
import { stripeTimeoutMs, StripeRefused, StripeUnavailable } from './api'

// Stripe Tax for a US checkout, on the merchant's own Stripe account through Connect (decided on #184, #284):
// one calculation per cart, each line with its class's product tax code. The platform's key acts on the
// connected account by its id; nothing else of the merchant's account is read.

const apiBase = 'https://api.stripe.com/v1'

export interface StripeTaxLine {
  reference: string
  /** Minor units, the line's amount. */
  amount: bigint
  taxCode: string | null
}

export interface StripeTaxRequest {
  accountId: string
  currency: string
  inclusive: boolean
  shipTo: { country: string; region: string | null; postal: string | null }
  lines: readonly StripeTaxLine[]
  /** The delivery charge, taxed as the address's jurisdiction taxes shipping; null for none. */
  shipping?: bigint | null
}

export interface StripeTaxCalculator {
  calculate: (request: StripeTaxRequest) => Promise<{ total: bigint; lines: { reference: string; amount: bigint }[]; shipping: bigint }>
}

const calculation = z
  .object({
    tax_amount_exclusive: z.number().int(),
    tax_amount_inclusive: z.number().int(),
    line_items: z.object({ data: z.array(z.object({ reference: z.string(), amount_tax: z.number().int() }).loose()) }).loose(),
    shipping_cost: z.object({ amount_tax: z.number().int() }).loose().nullish(),
  })
  .loose()

export const stripeTax = ({ secretKey, fetchImpl = fetch }: { secretKey: string; fetchImpl?: typeof fetch }): StripeTaxCalculator => ({
  calculate: async (request) => {
    const body = new URLSearchParams()
    body.set('currency', request.currency.toLowerCase())
    body.set('customer_details[address][country]', request.shipTo.country)
    if (request.shipTo.region) body.set('customer_details[address][state]', request.shipTo.region)
    if (request.shipTo.postal) body.set('customer_details[address][postal_code]', request.shipTo.postal)
    body.set('customer_details[address_source]', 'shipping')
    request.lines.forEach((line, i) => {
      body.set(`line_items[${i}][reference]`, line.reference)
      body.set(`line_items[${i}][amount]`, line.amount.toString())
      body.set(`line_items[${i}][tax_behavior]`, request.inclusive ? 'inclusive' : 'exclusive')
      if (line.taxCode) body.set(`line_items[${i}][tax_code]`, line.taxCode)
    })
    if (request.shipping) {
      body.set('shipping_cost[amount]', request.shipping.toString())
      body.set('shipping_cost[tax_behavior]', request.inclusive ? 'inclusive' : 'exclusive')
    }
    body.append('expand[]', 'line_items')
    let response: Response
    try {
      response = await fetchImpl(`${apiBase}/tax/calculations`, {
        method: 'POST',
        headers: { authorization: `Bearer ${secretKey}`, 'content-type': 'application/x-www-form-urlencoded', 'stripe-account': request.accountId },
        body: body.toString(),
        signal: AbortSignal.timeout(stripeTimeoutMs),
      })
    } catch {
      throw new StripeUnavailable('no answer')
    }
    if (response.status >= 500 || response.status === 429) throw new StripeUnavailable(`answered ${response.status}`)
    const json: unknown = await response.json().catch(() => null)
    if (!response.ok) throw new StripeRefused('tax calculation refused')
    const parsed = calculation.safeParse(json)
    if (!parsed.success) throw new StripeUnavailable('answered in a shape we do not read')
    const total = BigInt(request.inclusive ? parsed.data.tax_amount_inclusive : parsed.data.tax_amount_exclusive)
    return { total, lines: parsed.data.line_items.data.map((l) => ({ reference: l.reference, amount: BigInt(l.amount_tax) })), shipping: BigInt(parsed.data.shipping_cost?.amount_tax ?? 0) }
  },
})
