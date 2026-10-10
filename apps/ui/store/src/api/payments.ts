import { z } from 'zod'
import { query } from './client'

// Settings › Payment setup (SetOps, FIRST-RELEASE §15 and §19 "Built on #309"; apps/api/src/apis/store/payments.ts).

const connectionSchema = z.object({ mode: z.enum(['test', 'live']), live: z.boolean(), webhookUrl: z.string().nullable() })
const gatewaySchema = z.object({
  provider: z.string(),
  label: z.string(),
  kind: z.enum(['gateway', 'other']),
  live: z.boolean(),
  bankDetails: z.string().nullable(),
  connectable: z.boolean(),
  connections: z.array(connectionSchema),
})
export type Gateway = z.infer<typeof gatewaySchema>
export type PaymentMode = Gateway['connections'][number]['mode']

/** The region's ways to pay, in its order, with each mode connected. */
export const loadGateways = async (): Promise<Gateway[]> =>
  (await query('{ gateways { provider label kind live bankDetails connectable connections { mode live webhookUrl } } }', z.object({ gateways: z.array(gatewaySchema) }))).gateways

/** Cash on delivery, or a bank transfer with the details shoppers pay to. */
export const turnOnMethod = async (provider: string, bankDetails: string | null): Promise<void> => {
  await query('mutation C($p: String!, $b: String) { connectGateway(provider: $p, bankDetails: $b) }', z.object({ connectGateway: z.boolean() }), { p: provider, b: bankDetails })
}

/** A card provider's keys for one mode, by each provider's own field names (THIRD-PARTY-ACCESS §3.1). */
export const connectKeys = async (provider: string, mode: PaymentMode, keys: Readonly<Record<string, string>>): Promise<void> => {
  await query('mutation C($p: String!, $m: PaymentMode, $k: PaymentGatewayKeysInput) { connectGateway(provider: $p, mode: $m, keys: $k) }', z.object({ connectGateway: z.boolean() }), {
    p: provider,
    m: mode === 'live' ? 'LIVE' : 'TEST',
    k: keys,
  })
}

/** The address on Stripe to approve the platform's app at. */
export const connectStripe = async (): Promise<string> => (await query('mutation { connectStripe }', z.object({ connectStripe: z.string() }))).connectStripe

/** Stripe's one-time key from the way back (apps/api/src/hooks/stripeConnect.ts). */
export const finishStripeConnect = async (key: string): Promise<void> => {
  await query('mutation F($k: String!) { finishStripeConnect(key: $k) }', z.object({ finishStripeConnect: z.boolean() }), { k: key })
}

export const disconnectGateway = async (provider: string): Promise<void> => {
  await query('mutation D($p: String!) { disconnectGateway(provider: $p) }', z.object({ disconnectGateway: z.boolean() }), { p: provider })
}
