import { ApiError } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// Settings › Integrations (FIRST-RELEASE.md §14.5, #275): the partner's AI key profiles. A key goes up once and
// comes back as its first and last characters.

export const aiProviders = ['anthropic', 'openai'] as const
export type AiProvider = (typeof aiProviders)[number]

const keySchema = z.object({
  id: z.string(),
  provider: z.enum(aiProviders),
  name: z.string(),
  keyPrefix: z.string(),
  status: z.enum(['untested', 'ok', 'rejected']),
  isDefault: z.boolean(),
  lastTestedAt: z.string().nullable(),
  authType: z.enum(['api_key', 'oauth']),
  accountLabel: z.string().nullable(),
})
export type AiKey = z.infer<typeof keySchema>

export const aiKeyRefusals = ['INVALID_INPUT', 'LIMIT_REACHED', 'NAME_TAKEN', 'KEY_REJECTED', 'PROVIDER_UNAVAILABLE', 'NOT_CONFIGURED', 'NOT_FOUND', 'OAUTH_UNAVAILABLE', 'OAUTH_EXPIRED'] as const
export type AiKeyRefusal = (typeof aiKeyRefusals)[number]
export type AiKeyResult<T = object> = ({ ok: true } & T) | { ok: false; reason: AiKeyRefusal }

const resultSchema = z.object({ ok: z.boolean(), reason: z.string().nullable(), status: z.string().nullable().optional(), url: z.string().nullable().optional() })

// A code this console doesn't know is an error with that code, never worded as a known one.
const refusalOf = (reason: string | null): AiKeyRefusal => {
  const known = aiKeyRefusals.find((code) => code === reason)
  if (!known) throw new ApiError(reason ?? 'UNKNOWN', 'The API refused with a code this console does not know.')
  return known
}

export const loadAiKeys = async (): Promise<readonly AiKey[]> =>
  (await query(`{ partnerAiKeys { id provider name keyPrefix status isDefault lastTestedAt authType accountLabel } }`, z.object({ partnerAiKeys: z.array(keySchema) }))).partnerAiKeys

const send = async (document: string, variables: Record<string, unknown>, field: string): Promise<AiKeyResult<{ status: string | null; url: string | null }>> => {
  const answer = await query(document, z.object({ [field]: resultSchema }), variables)
  const r = answer[field]
  if (!r) throw new ApiError('BAD_RESPONSE', `No ${field} in the answer.`)
  return r.ok ? { ok: true, status: r.status ?? null, url: r.url ?? null } : { ok: false, reason: refusalOf(r.reason) }
}

export const addAiKey = (input: { provider: AiProvider; name: string; key: string }) =>
  send(`mutation Add($provider: String!, $name: String!, $key: String!) { addPartnerAiKey(provider: $provider, name: $name, key: $key) { ok reason } }`, input, 'addPartnerAiKey')
export const testAiKey = (id: string) => send(`mutation Test($id: ID!) { testPartnerAiKey(id: $id) { ok reason status } }`, { id }, 'testPartnerAiKey')
export const setDefaultAiKey = (id: string) => send(`mutation Default($id: ID!) { setDefaultPartnerAiKey(id: $id) { ok reason } }`, { id }, 'setDefaultPartnerAiKey')
export const removeAiKey = (id: string) => send(`mutation Remove($id: ID!) { removePartnerAiKey(id: $id) { ok reason } }`, { id }, 'removePartnerAiKey')

const signInSchema = z.object({ provider: z.enum(aiProviders), available: z.boolean(), reason: z.string().nullable() })
export type AiSignIn = z.infer<typeof signInSchema>

export const loadAiSignIn = async (): Promise<readonly AiSignIn[]> =>
  (await query(`{ partnerAiSignIn { provider available reason } }`, z.object({ partnerAiSignIn: z.array(signInSchema) }))).partnerAiSignIn

/** `id` names the sign-in a reconnect replaces. The answer's `url` is where to send the person. */
export const beginAiOauth = (provider: AiProvider, id: string | null) =>
  send(`mutation Begin($provider: String!, $id: ID) { beginPartnerAiOauth(provider: $provider, id: $id) { ok reason url } }`, { provider, id }, 'beginPartnerAiOauth')
/** `response` is what the person pasted back from the provider: its address, or code#state. */
export const finishAiOauth = (response: string) => send(`mutation Finish($response: String!) { finishPartnerAiOauth(response: $response) { ok reason } }`, { response }, 'finishPartnerAiOauth')
