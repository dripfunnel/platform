import { describe, expect, it, vi } from 'vitest'
import { deepinfraEndpoint, deepinfraModels, deepinfraPreferred, isDeepInfraKey, openaiEndpointFor } from './deepinfra'
import { executorFor } from './executors/registry'
import { GatewayError } from './gateway'
import { capabilityOf } from './registry'

const key = 'sk-di-4rblMT8wxGZPEaMfVtsc0vebOBn11AYE'
const model = (id: string, tags: string[], pricing: Record<string, number> | null, maxTokens: number | null = 131_072) => ({ id, object: 'model', metadata: { tags, pricing, max_tokens: maxTokens } })
const listing = { data: [model('zai-org/GLM-4.6', ['chat'], { input_tokens: 0.5, output_tokens: 2, cache_read_tokens: 0.1 }), model('black-forest-labs/FLUX', ['image-gen'], { per_image_unit: 0.01 }), model('Qwen/Qwen3-Embedding-4B', ['embed'], { input_tokens: 0.02 }), model(deepinfraPreferred, ['chat'], { input_tokens: 0.3, output_tokens: 1 }, 8_000)] }

describe('DeepInfra through an OpenAI key (sk-di-)', () => {
  it('sends a DeepInfra key to DeepInfra’s fixed host and every other key to OpenAI’s', async () => {
    expect(isDeepInfraKey(key)).toBe(true)
    expect(openaiEndpointFor(key)).toBe(deepinfraEndpoint)
    expect(openaiEndpointFor('sk-proj-abcdefghijklmnopqrstuvwxyz')).toBe('https://api.openai.com/v1')
    const send = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}')))
    for (const secret of [key, 'sk-proj-abc']) {
      const connection = { connectionId: 'c', provider: 'openai' as const, authType: 'api_key' as const, secret }
      await executorFor(connection, { fetch: send }).execute({ body: {}, stream: false }, connection)
    }
    expect(send.mock.calls.map((c) => c[0])).toEqual([`${deepinfraEndpoint}/chat/completions`, 'https://api.openai.com/v1/chat/completions'])
  })

  it('lists the key’s chat models only, the preferred first, priced in cents and known to capabilityOf', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(listing)))
    const models = await deepinfraModels(key, fetcher)
    expect(fetcher.mock.calls[0]?.[0]).toBe(`${deepinfraEndpoint}/models`)
    expect(models.map((m) => m.id)).toEqual([deepinfraPreferred, 'zai-org/GLM-4.6'])
    expect(models[1]).toMatchObject({ provider: 'openai', maxOutputTokens: 32_000, centsPerMillion: { input: 50, output: 200, cacheRead: 10, cacheWrite: 50 } })
    expect(models[0]?.maxOutputTokens).toBe(8_000)
    expect(capabilityOf('openai', 'zai-org/GLM-4.6')).toEqual(models[1])
    expect(capabilityOf('anthropic', 'zai-org/GLM-4.6')).toBeNull()
  })

  it('says a refused key is invalid and anything else is unavailable', async () => {
    await expect(deepinfraModels(key, vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))).rejects.toEqual(new GatewayError('INVALID_CREDENTIALS'))
    await expect(deepinfraModels(key, vi.fn().mockResolvedValue(new Response('not json')))).rejects.toEqual(new GatewayError('PROVIDER_UNAVAILABLE'))
    await expect(deepinfraModels(key, vi.fn().mockRejectedValue(new Error('offline')))).rejects.toEqual(new GatewayError('PROVIDER_UNAVAILABLE'))
  })
})
