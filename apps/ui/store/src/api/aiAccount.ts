import { z } from 'zod'
import { query } from './client'

// Storefront › AI (SetAi, card #950; apps/api/src/apis/store/aiAccount.ts): the store's own AI account, never its key.

export const aiProviders = ['anthropic', 'openai'] as const
export type AiProvider = (typeof aiProviders)[number]

const accountSchema = z.object({
  provider: z.enum(aiProviders),
  keyPrefix: z.string(),
  status: z.enum(['untested', 'ok', 'rejected']),
  lastTestedAt: z.string().nullable(),
  useWhenPlanUsed: z.boolean(),
  connectedBy: z.string(),
  authType: z.enum(['api_key', 'oauth']),
  accountLabel: z.string().nullable(),
})
export type StoreAiAccount = z.infer<typeof accountSchema>

const runsSchema = z.object({ ownKey: z.boolean(), aiPromptsUsed: z.number().int(), aiPromptsAllowed: z.number().int().nullable() })
/** This month's plan runs; `allowed` is null when the plan has no limit. */
export interface PlanRuns {
  used: number
  allowed: number | null
}

export const loadStoreAiAccount = async (): Promise<StoreAiAccount | null> =>
  (await query('{ storeAiAccount { provider keyPrefix status lastTestedAt useWhenPlanUsed connectedBy authType accountLabel } }', z.object({ storeAiAccount: accountSchema.nullable() }))).storeAiAccount

export const loadPlanRuns = async (): Promise<PlanRuns> => {
  const { aiPromptsUsed, aiPromptsAllowed } = (await query('{ storefront { usage { ownKey aiPromptsUsed aiPromptsAllowed } } }', z.object({ storefront: z.object({ usage: runsSchema }) }))).storefront.usage
  return { used: aiPromptsUsed, allowed: aiPromptsAllowed }
}

export const connectStoreAiAccount = async (provider: AiProvider, key: string): Promise<void> => {
  await query('mutation C($p: String!, $k: String!) { connectStoreAiAccount(provider: $p, key: $k) }', z.object({ connectStoreAiAccount: z.boolean() }), { p: provider, k: key })
}

export const testStoreAiAccount = async (): Promise<StoreAiAccount['status']> =>
  (await query('mutation { testStoreAiAccount { status } }', z.object({ testStoreAiAccount: z.object({ status: z.enum(['untested', 'ok', 'rejected']) }) }))).testStoreAiAccount.status

export const setStoreAiSwitch = async (on: boolean): Promise<void> => {
  await query('mutation S($on: Boolean!) { setStoreAiSwitch(on: $on) }', z.object({ setStoreAiSwitch: z.boolean() }), { on })
}

export const removeStoreAiAccount = async (): Promise<void> => {
  await query('mutation { removeStoreAiAccount }', z.object({ removeStoreAiAccount: z.boolean() }))
}

/** Whether signing in with each provider can start (SAAS §9.3); a provider the API doesn't list is unavailable. */
export const loadStoreAiSignIn = async (): Promise<Record<AiProvider, boolean>> => {
  const { storeAiSignIn } = await query('{ storeAiSignIn { provider available } }', z.object({ storeAiSignIn: z.array(z.object({ provider: z.string(), available: z.boolean() })) }))
  return { anthropic: storeAiSignIn.some((p) => p.provider === 'anthropic' && p.available), openai: storeAiSignIn.some((p) => p.provider === 'openai' && p.available) }
}

export const beginStoreAiOauth = async (provider: AiProvider): Promise<string> =>
  (await query('mutation B($p: String!) { beginStoreAiOauth(provider: $p) }', z.object({ beginStoreAiOauth: z.string() }), { p: provider })).beginStoreAiOauth

/** `response` is what the person pasted back from the provider: its address, or code#state. */
export const finishStoreAiOauth = async (response: string): Promise<void> => {
  await query('mutation F($r: String!) { finishStoreAiOauth(response: $r) }', z.object({ finishStoreAiOauth: z.boolean() }), { r: response })
}
