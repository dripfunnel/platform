import { z } from 'zod'
import { GatewayError } from './gateway'
import { providerHeaders } from './headers'
import { registerModels, type ModelCapability } from './registry'

// DeepInfra's OpenAI-compatible API, reached with an OpenAI key the merchant pasted from DeepInfra (`sk-di-…`, decided
// 2026-11-13): the key's prefix picks this fixed host, never anything a caller sends (SSRF).
export const deepinfraEndpoint = 'https://api.deepinfra.com/v1/openai'

export const isDeepInfraKey = (key: string): boolean => key.startsWith('sk-di-')

/** The OpenAI-style base address a key is sent to. */
export const openaiEndpointFor = (key: string): string => (isDeepInfraKey(key) ? deepinfraEndpoint : 'https://api.openai.com/v1')

/** Tried first in the studio when the key lists it: strong at code and tool calls. */
export const deepinfraPreferred = 'Qwen/Qwen3-Coder-480B-A35B-Instruct-Turbo'
const answerCap = 32_000
const timeoutMs = 15_000

const listed = z.object({
  data: z
    .array(
      z.object({
        id: z.string().min(1).max(200),
        metadata: z
          .object({
            max_tokens: z.number().nullable().optional(),
            tags: z.array(z.string()).nullable().optional(),
            pricing: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional(), cache_read_tokens: z.number().optional() }).nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .max(2000),
})

/** The chat models the key can use, priced from DeepInfra's own list (US dollars per million tokens, kept in cents). */
export const deepinfraModels = async (key: string, fetcher: typeof fetch = fetch): Promise<ModelCapability[]> => {
  let response: Response
  try {
    response = await fetcher(`${deepinfraEndpoint}/models`, { headers: providerHeaders({ provider: 'openai', auth: 'api_key', secret: key, stream: false, hasBody: false }), signal: AbortSignal.timeout(timeoutMs) })
  } catch {
    throw new GatewayError('PROVIDER_UNAVAILABLE')
  }
  if (response.status === 401 || response.status === 403) throw new GatewayError('INVALID_CREDENTIALS')
  if (!response.ok) throw new GatewayError('PROVIDER_UNAVAILABLE')
  const parsed = listed.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new GatewayError('PROVIDER_UNAVAILABLE')
  const models = parsed.data.data.flatMap(({ id, metadata }): ModelCapability[] => {
    const price = metadata?.pricing
    if (!metadata?.tags?.includes('chat') || price?.input_tokens === undefined || price.output_tokens === undefined) return []
    const cents = (dollars: number) => dollars * 100
    return [
      {
        provider: 'openai',
        id,
        maxOutputTokens: Math.min(metadata.max_tokens ?? answerCap, answerCap),
        temperature: [0, 2],
        centsPerMillion: { input: cents(price.input_tokens), output: cents(price.output_tokens), cacheRead: cents(price.cache_read_tokens ?? price.input_tokens), cacheWrite: cents(price.input_tokens) },
      },
    ]
  })
  models.sort((a, b) => Number(b.id === deepinfraPreferred) - Number(a.id === deepinfraPreferred))
  registerModels(models)
  return models
}
