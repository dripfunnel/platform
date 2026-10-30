import { describe, expect, it } from 'vitest'
import { GatewayError } from '../gateway'
import { UnsupportedFeature, type CanonicalRequest } from '../canonical'
import { base, bare, caps, png, run, withTools } from './fixtures'
import { openaiChatRequest as request, openaiChatResponse as response, openaiChatStream as stream } from './openai-chat'

const translate = (r: CanonicalRequest, c = caps) => request.translate(r, c)

describe('openai-chat request', () => {
  it('sends system and developer messages first, and max_completion_tokens', () => {
    const body = translate({ ...base, system: 's', developer: 'd', stop: ['x'] })
    expect(body.messages.slice(0, 2)).toEqual([{ role: 'system', content: 's' }, { role: 'developer', content: 'd' }])
    expect(body).toMatchObject({ max_completion_tokens: 100, stop: ['x'] })
    expect(body.messages[2]).toEqual({ role: 'user', content: 'hi' })
  })
  it('refuses developer instructions without the capability, and more than four stop sequences', () => {
    expect(() => translate({ ...base, developer: 'd' }, { ...caps, developerRole: false })).toThrow(UnsupportedFeature)
    expect(() => translate({ ...base, stop: ['1', '2', '3', '4', '5'] })).toThrow(UnsupportedFeature)
  })
  it('clamps temperature to 2', () => {
    expect(translate({ ...base, temperature: 3 }).temperature).toBe(2)
    expect(translate({ ...base, temperature: 1.5 }).temperature).toBe(1.5)
  })
  it('allows consecutive same-role turns as they are', () => {
    const user = (text: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text }] })
    expect(translate({ ...base, messages: [user('a'), user('b')] }).messages).toHaveLength(2)
  })
  it('sends images as data URLs', () => {
    const body = translate({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'see' }, png] }] })
    expect(body.messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: 'see' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } }] })
    expect(() => translate({ ...base, messages: [{ role: 'user', content: [png] }] }, bare)).toThrow(UnsupportedFeature)
  })
  it('translates tool definitions, calls and results to tool_calls and the tool role', () => {
    const body = translate({ ...withTools, toolChoice: { name: 'get_weather' } })
    expect(body.tools).toEqual([{ type: 'function', function: { name: 'get_weather', description: 'Weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } } }])
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'get_weather' } })
    expect(body.messages[1]).toEqual({ role: 'assistant', content: 'checking', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Pune"}' } }] })
    expect(body.messages[2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '31C' })
    expect(translate({ ...withTools, toolChoice: 'required' }).tool_choice).toBe('required')
  })
  it('refuses tools when unsupported and unpaired results', () => {
    expect(() => translate(withTools, bare)).toThrow(UnsupportedFeature)
    expect(() => translate({ ...withTools, messages: withTools.messages.slice(0, 2) })).toThrow(GatewayError)
  })
  it('refuses a tool result error flag rather than show a failure as a success', () => {
    const failing = { ...withTools, messages: [...withTools.messages.slice(0, 2), { role: 'tool' as const, content: [{ type: 'tool_result' as const, callId: 'c1', content: 'x', isError: true }] }] }
    expect(() => translate(failing)).toThrow(UnsupportedFeature)
  })
  it('sends reasoning effort and structured output', () => {
    const body = translate({ ...base, reasoningEffort: 'medium', structuredOutput: { name: 'out', schema: { type: 'object' } } })
    expect(body).toMatchObject({ reasoning_effort: 'medium', response_format: { type: 'json_schema', json_schema: { name: 'out', schema: { type: 'object' } } } })
    expect(() => translate({ ...base, reasoningEffort: 'low' }, bare)).toThrow(UnsupportedFeature)
    expect(() => translate({ ...base, structuredOutput: { name: 'out', schema: {} } }, bare)).toThrow(UnsupportedFeature)
    expect(() => translate({ ...base, structuredOutput: { name: 'bad name', schema: {} } })).toThrow(GatewayError)
  })
})

describe('openai-chat response', () => {
  const completion = (message: object, finish_reason: string | null = 'stop') => ({ model: 'gpt-x', choices: [{ message, finish_reason }], usage: { prompt_tokens: 9, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 4 } } })
  it('parses text, finish and cached usage', () => {
    expect(response.parse(completion({ content: 'hello' }))).toEqual({ text: 'hello', toolCalls: [], finish: 'stop', usage: { tokensIn: 9, tokensOut: 3, cachedTokensIn: 4 }, model: 'gpt-x' })
  })
  it('parses tool calls and maps finish reasons', () => {
    const parsed = response.parse(completion({ content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'f', arguments: '{"a":1}' } }] }, 'tool_calls'))
    expect(parsed).toMatchObject({ text: '', toolCalls: [{ id: 'c', name: 'f', arguments: '{"a":1}' }], finish: 'tool_use' })
    expect(['length', 'content_filter', 'weird'].map((f) => response.parse(completion({ content: 'x' }, f)).finish)).toEqual(['length', 'refusal', 'other'])
    expect(response.parse(completion({ content: null, refusal: 'no' })).finish).toBe('refusal')
  })
  it('turns error bodies, no choices and malformed bodies into gateway errors', () => {
    expect(() => response.parse({ error: { code: 'rate_limit_exceeded' } })).toThrow(expect.objectContaining({ code: 'RATE_LIMITED' }))
    expect(() => response.parse({ error: { code: 'invalid_api_key' } })).toThrow(expect.objectContaining({ code: 'INVALID_CREDENTIALS' }))
    expect(() => response.parse({ model: 'm', choices: [] })).toThrow(GatewayError)
    expect(() => response.parse(null)).toThrow(GatewayError)
  })
})

describe('openai-chat stream', () => {
  const chunk = (delta: object, finish_reason: string | null = null, extra: object = {}) => ({ model: 'gpt-x', choices: [{ delta, finish_reason }], ...extra })
  const usage = { model: 'gpt-x', choices: [], usage: { prompt_tokens: 9, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 2 } } }

  it('streams text, then usage and end at [DONE]', () => {
    const events = run(stream, [chunk({ role: 'assistant', content: '' }), chunk({ content: 'he' }), chunk({ content: 'llo' }), chunk({}, 'stop'), usage, '[DONE]'])
    expect(events).toEqual([
      { kind: 'text', text: 'he' },
      { kind: 'text', text: 'llo' },
      { kind: 'usage', usage: { tokensIn: 9, tokensOut: 3, cachedTokensIn: 2 } },
      { kind: 'end', finish: 'stop', model: 'gpt-x' },
    ])
  })
  it('accumulates tool-call arguments per index, with two calls in parallel', () => {
    const events = run(stream, [
      chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'f', arguments: '' } }] }),
      chunk({ tool_calls: [{ index: 1, id: 'b', function: { name: 'g', arguments: '{"y"' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '{"x":' } }] }),
      chunk({ tool_calls: [{ index: 0, function: { arguments: '1}' } }, { index: 1, function: { arguments: ':2}' } }] }),
      chunk({}, 'tool_calls'),
      usage,
      '[DONE]',
    ])
    const calls = events.filter((e) => e.kind.startsWith('tool_call'))
    expect(calls).toEqual([
      { kind: 'tool_call_start', index: 0, id: 'a', name: 'f' },
      { kind: 'tool_call_start', index: 1, id: 'b', name: 'g' },
      { kind: 'tool_call_delta', index: 1, arguments: '{"y"' },
      { kind: 'tool_call_delta', index: 0, arguments: '{"x":' },
      { kind: 'tool_call_delta', index: 0, arguments: '1}' },
      { kind: 'tool_call_delta', index: 1, arguments: ':2}' },
      { kind: 'tool_call_end', index: 0 },
      { kind: 'tool_call_end', index: 1 },
    ])
    expect(events.at(-1)).toEqual({ kind: 'end', finish: 'tool_use', model: 'gpt-x' })
  })
  it('ends cleanly when the source drops [DONE] after the usage chunk, but not before it', () => {
    expect(run(stream, [chunk({ content: 'a' }), chunk({}, 'stop'), usage]).at(-1)).toMatchObject({ kind: 'end' })
    expect(run(stream, [chunk({ content: 'a' }), chunk({}, 'stop')]).at(-1)).toMatchObject({ kind: 'error' })
  })
  it('errors on a stream cut before any finish reason, on a bare [DONE], and on truncated tool arguments', () => {
    expect(run(stream, [chunk({ content: 'partial' })]).at(-1)).toEqual({ kind: 'error', code: 'PROVIDER_UNAVAILABLE', retryAfter: null })
    expect(run(stream, ['[DONE]']).at(-1)).toMatchObject({ kind: 'error' })
    const cut = run(stream, [chunk({ tool_calls: [{ index: 0, id: 'a', function: { name: 'f', arguments: '{"x"' } }] }), chunk({}, 'tool_calls'), usage, '[DONE]'])
    expect(cut.some((e) => e.kind === 'end')).toBe(false)
    expect(cut.at(-1)).toMatchObject({ kind: 'error' })
  })
  it('maps a mid-stream error object and ignores what follows', () => {
    const events = run(stream, [chunk({ content: 'a' }), { error: { code: 'rate_limit_exceeded' } }, chunk({ content: 'late' }), '[DONE]'])
    expect(events).toEqual([{ kind: 'text', text: 'a' }, { kind: 'error', code: 'RATE_LIMITED', retryAfter: null }])
  })
  it('maps length, content_filter and streamed refusals', () => {
    expect(run(stream, [chunk({}, 'length'), '[DONE]']).at(-1)).toMatchObject({ finish: 'length' })
    expect(run(stream, [chunk({}, 'content_filter'), '[DONE]']).at(-1)).toMatchObject({ finish: 'refusal' })
    expect(run(stream, [chunk({ refusal: 'no' }), chunk({}, 'stop'), '[DONE]']).at(-1)).toMatchObject({ finish: 'refusal' })
  })
  it('fails on a malformed chunk', () => {
    expect(run(stream, [{ choices: 'x' }]).at(-1)).toMatchObject({ kind: 'error' })
  })
})
