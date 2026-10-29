import { afterEach, describe, expect, it, vi } from 'vitest'
import { GatewayError, type ChatRequest } from '../gateway'
import { openaiResponsesChat } from './openaiResponses'

const request: ChatRequest = { model: 'gpt-5', system: 'Be brief.', messages: [{ role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' }, { role: 'user', content: 'Again' }], maxTokens: 50 }
const sse = (...events: object[]) => new Response(events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } })

afterEach(() => vi.unstubAllGlobals())
const stub = (response: Response) => {
  const send = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', send)
  return send
}

describe('ChatGPT plan inference', () => {
  it('posts the Codex request: store false, stream true, instructions, the workspace header, no unsupported fields', async () => {
    const send = stub(sse({ type: 'response.output_text.delta', delta: 'Hi' }, { type: 'response.completed', response: { model: 'gpt-5', usage: { input_tokens: 7, output_tokens: 2 } } }))
    const answer = await openaiResponsesChat('tok', 'ws-1').generateResponse(request)
    expect(answer).toEqual({ text: 'Hi', model: 'gpt-5', finish: 'stop', usage: { tokensIn: 7, tokensOut: 2 } })
    const [url, init] = send.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://chatgpt.com/backend-api/codex/responses')
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok', 'chatgpt-account-id': 'ws-1' })
    const body = JSON.parse(String(init.body)) as Record<string, unknown>
    expect(body).toMatchObject({ model: 'gpt-5', instructions: 'Be brief.', store: false, stream: true })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('max_output_tokens')
    expect(JSON.stringify(body['input'])).not.toContain('"system"')
    expect((body['input'] as { content: { type: string }[] }[]).map((m) => m.content[0]?.type)).toEqual(['input_text', 'output_text', 'input_text'])
  })

  it('folds system turns and blocks into instructions, never into the input', async () => {
    const send = stub(sse({ type: 'response.completed', response: { model: 'gpt-5', usage: { input_tokens: 1, output_tokens: 1 } } }))
    await openaiResponsesChat('tok', 'ws-1').generateResponse({ model: 'gpt-5', system: [{ type: 'text', text: 'Block' }], messages: [{ role: 'system', content: 'Turn' }, { role: 'user', content: 'Hi' }], maxTokens: 50 })
    const body = JSON.parse(String((send.mock.calls[0] as [string, RequestInit])[1].body)) as { instructions: string; input: { role: string }[] }
    expect(body.instructions).toBe('Block\nTurn')
    expect(body.input.map((m) => m.role)).toEqual(['user'])
  })

  it('refuses temperature and provider options instead of dropping them', async () => {
    stub(sse())
    const adapter = openaiResponsesChat('tok')
    await expect(adapter.generateResponse({ ...request, temperature: 0.5 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(adapter.generateResponse({ ...request, options: { top_p: 1 } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('streams text and ends only on response.completed', async () => {
    stub(sse({ type: 'response.output_text.delta', delta: 'a' }, { type: 'response.output_text.delta', delta: 'b' }, { type: 'response.completed', response: {} }))
    const out: string[] = []
    for await (const chunk of openaiResponsesChat('tok').streamResponse(request)) out.push(chunk.kind === 'text' ? chunk.text : chunk.kind)
    expect(out).toEqual(['a', 'b', 'end'])
  })

  it('treats a stream that stops short as a failure, not a short answer', async () => {
    stub(sse({ type: 'response.output_text.delta', delta: 'a' }))
    await expect(openaiResponsesChat('tok').generateResponse(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })

  it('maps the plan usage limit to rate limited and other failures to unavailable', async () => {
    stub(sse({ type: 'response.failed', response: { error: { code: 'subscription_sharing_usage_limit_exceeded' } } }))
    await expect(openaiResponsesChat('tok').generateResponse(request)).rejects.toMatchObject({ code: 'RATE_LIMITED' })
    stub(sse({ type: 'response.failed', response: { error: { code: 'server_error' } } }))
    await expect(openaiResponsesChat('tok').generateResponse(request)).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
  })

  it('maps HTTP statuses without the body, and a refused token to invalid credentials', async () => {
    stub(new Response('secret detail', { status: 401 }))
    const failure = await openaiResponsesChat('tok').generateResponse(request).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(GatewayError)
    expect((failure as GatewayError).code).toBe('INVALID_CREDENTIALS')
    expect(JSON.stringify(failure)).not.toContain('secret detail')
    stub(new Response('', { status: 429, headers: { 'retry-after': '3' } }))
    await expect(openaiResponsesChat('tok').generateResponse(request)).rejects.toMatchObject({ code: 'RATE_LIMITED', retryAfter: 3 })
  })
})
