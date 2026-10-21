import { z } from 'zod'
import { typedQuery, type ApiClient } from '../graphql'

// Settings › Payment setup (SetOps; FIRST-RELEASE (store) §15; apps/api src/apis/store/payments.ts). Stripe connects on the portal page, so
// `connectStripe` and `finishStripeConnect` are not called here (ARCHITECTURE.md §5, decided on #504).

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

/** The region's ways to pay, in its order, with each mode connected. Keys and secrets are never read back. */
export const loadGateways = async (client: ApiClient): Promise<Gateway[]> =>
  (await typedQuery(client)('{ gateways { provider label kind live bankDetails connectable connections { mode live webhookUrl } } }', z.object({ gateways: z.array(gatewaySchema).nullable() }))).gateways ?? []

/** Cash on delivery, or a bank transfer with the details shoppers pay to. */
export const turnOnMethod = async (client: ApiClient, provider: string, bankDetails: string | null): Promise<void> => {
  await typedQuery(client)('mutation TurnOnMethod($p: String!, $b: String) { connectGateway(provider: $p, bankDetails: $b) }', z.object({ connectGateway: z.boolean().nullable() }), { p: provider, b: bankDetails })
}

/** A card provider's keys for one mode, by each provider's own field names (THIRD-PARTY-ACCESS §3.1). */
export const connectKeys = async (client: ApiClient, provider: string, mode: PaymentMode, keys: Readonly<Record<string, string>>): Promise<void> => {
  await typedQuery(client)(
    'mutation ConnectKeys($p: String!, $m: PaymentMode, $k: PaymentGatewayKeysInput) { connectGateway(provider: $p, mode: $m, keys: $k) }',
    z.object({ connectGateway: z.boolean().nullable() }),
    { p: provider, m: mode === 'live' ? 'LIVE' : 'TEST', k: keys },
  )
}

/** Turns a way to pay off, or removes a card provider's keys; never the store's only live way to pay (`LAST_METHOD`). */
export const disconnectGateway = async (client: ApiClient, provider: string): Promise<void> => {
  await typedQuery(client)('mutation DisconnectGateway($p: String!) { disconnectGateway(provider: $p) }', z.object({ disconnectGateway: z.boolean().nullable() }), { p: provider })
}
