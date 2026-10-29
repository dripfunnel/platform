import { describe, expect, it } from 'vitest'
import { GatewayError } from '../gateway'
import { UnsupportedFeature, type CanonicalRequest } from '../canonical'
import { anthropicMessagesRequest as request, anthropicMessagesResponse as response, anthropicMessagesStream as stream } from './anthropic-messages'
import { base, bare, caps, png, run, withTools } from './fixtures'

const translate = (r: CanonicalRequest, c = caps) => request.translate(r, c)
const user = (text: string) => ({ role: 'user' as const, content: [{ type: 'text' as const, text }] })
const assistant = (text: string) => ({ role: 'assistant' as const, content: [{ type: 'text' as const, text }] })

describe('anthropic-messages request', () => {
  it('puts the system top-level and maps maxTokens and stop sequences', () => {
    expect(translate({ ...base, system: 'be brief', stop: ['END'] })).toEqual({
      model: 'm',
      max_tokens: 100,
      system: 'be brief',
      stop_sequences: ['END'],
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })
  })
  it('clamps temperature to 1 and 0', () => {
    expect(translate({ ...base, temperature: 1.7 }).temperature).toBe(1)
    expect(translate({ ...base, temperature: -1 }).temperature).toBe(0)
    expect(translate({ ...base, temperature: 0.4 }).temperature).toBe(0.4)
  })
  it('merges adjacent same-role turns and drops no text', () => {
    const body = translate({ ...base, messages: [user('a'), user('b'), assistant('c'), assistant('d'), user('e')] })
    expect(body.messages.map((m) => [m.role, m.content.length])).toEqual([['user', 2], ['assistant', 2], ['user', 1]])
  })
  it('rejects a conversation that opens with an assistant turn', () => {
    expect(() => translate({ ...base, messages: [assistant('x'), user('y')] })).toThrow(UnsupportedFeature)
  })
  it('refuses developer instructions even when the capability claims them', () => {
    expect(() => translate({ ...base, developer: 'rules' })).toThrow(UnsupportedFeature)
  })
  it('sends base64 images as image blocks', () => {
    const body = translate({ ...base, messages: [{ role: 'user', content: [{ type: 'text', text: 'see' }, png] }] })
    expect(body.messages[0]?.content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' } })
  })
  it('refuses images when unsupported, an unlisted type, and malformed base64', () => {
    const images = { ...base, messages: [{ role: 'user' as const, content: [png] }] }
    expect(() => translate(images, bare)).toThrow(UnsupportedFeature)
    expect(() => translate({ ...base, messages: [{ role: 'user', content: [{ ...png, mediaType: 'image/tiff' }] }] })).toThrow(UnsupportedFeature)
    expect(() => translate({ ...base, messages: [{ role: 'user', content: [{ ...png, base64: 'not base64!' }] }] })).toThrow(GatewayError)
  })
  it('translates tool definitions, calls and results', () => {
    const body = translate({ ...withTools, toolChoice: { name: 'get_weather' } })
    expect(body.tools).toEqual([{ name: 'get_weather', description: 'Weather', input_schema: { type: 'object', properties: { city: { type: 'string' } } } }])
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'get_weather' })
    expect(body.messages[1]?.content[1]).toEqual({ type: 'tool_use', id: 'c1', name: 'get_weather', input: { city: 'Pune' } })
    expect(body.messages[2]).toEqual({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: '31C' }] })
  })
  it('maps required to any and carries the error flag', () => {
    expect(translate({ ...withTools, toolChoice: 'required' }).tool_choice).toEqual({ type: 'any' })
    const failing = { ...withTools, messages: [...withTools.messages.slice(0, 2), { role: 'tool' as const, content: [{ type: 'tool_result' as const, callId: 'c1', content: 'boom', isError: true }] }] }
    expect(translate(failing).messages[2]?.content[0]).toMatchObject({ is_error: true })
  })
  it('refuses tools when unsupported, a result without a call, and a call without a result', () => {
    expect(() => translate(withTools, bare)).toThrow(UnsupportedFeature)
    expect(() => translate({ ...base, tools: [], messages: [user('x'), { role: 'tool', content: [{ type: 'tool_result', callId: 'z', content: 'r' }] }] })).toThrow(GatewayError)
    expect(() => translate({ ...withTools, messages: withTools.messages.slice(0, 2) })).toThrow(GatewayError)
    expect(() => translate({ ...base, toolChoice: 'auto' })).toThrow(GatewayError)
  })
  it('sends reasoning effort and structured output through output_config', () => {
    const body = translate({ ...base, reasoningEffort: 'high', structuredOutput: { name: 'out', schema: { type: 'object' } } })
    expect(body.output_config).toEqual({ effort: 'high', format: { type: 'json_schema', schema: { type: 'object' } } })
  })
  it('refuses reasoning effort and structured output when unsupported', () => {
    expect(() => translate({ ...base, reasoningEffort: 'low' }, bare)).toThrow(UnsupportedFeature)
    expect(() => translate({ ...base, structuredOutput: { name: 'out', schema: {} } }, bare)).toThrow(UnsupportedFeature)
  })
  it('refuses maxTokens above the model limit and an empty conversation', () => {
    expect(() => translate({ ...base, maxTokens: 9000 })).toThrow(UnsupportedFeature)
    expect(() => translate({ ...base, messages: [] })).toThrow(GatewayError)
  })
  it('refuses tool arguments that are not a JSON object', () => {
    const broken = { ...withTools, messages: withTools.messages.map((m) => (m.role === 'assistant' ? { ...m, content: [{ type: 'tool_call' as const, id: 'c1', name: 'get_weather', arguments: '{"city"' }] } : m)) }
    expect(() => translate(broken)).toThrow(GatewayError)
  })
})

describe('anthropic-messages response', () => {
  const message = { type: 'message', model: 'claude-x', stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 4, cache_creation_input_tokens: 2 } }
  it('parses text, finish and usage with cached tokens', () => {
    expect(response.parse({ ...message, content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] })).toEqual({ text: 'ab', toolCalls: [], finish: 'stop', usage: { tokensIn: 16, tokensOut: 5, cachedTokensIn: 4 }, model: 'claude-x' })
  })
  it('parses tool calls', () => {
    const parsed = response.parse({ ...message, stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 't1', name: 'f', input: { a: 1 } }] })
    expect(parsed.toolCalls).toEqual([{ id: 't1', name: 'f', arguments: '{"a":1}' }])
    expect(parsed.finish).toBe('tool_use')
  })
  it('maps every stop reason', () => {
    const finishes = ['end_turn', 'stop_sequence', 'max_tokens', 'refusal', 'pause_turn'].map((stop_reason) => response.parse({ ...message, stop_reason, content: [] }).finish)
    expect(finishes).toEqual(['stop', 'stop', 'length', 'refusal', 'other'])
  })
  it('turns an error body and a malformed body into gateway errors', () => {
    expect(() => response.parse({ type: 'error', error: { type: 'rate_limit_error' } })).toThrow(expect.objectContaining({ code: 'RATE_LIMITED' }))
    expect(() => response.parse({ type: 'error', error: { type: 'overloaded_error' } })).toThrow(expect.objectContaining({ code: 'PROVIDER_UNAVAILABLE' }))
    expect(() => response.parse({ nonsense: true })).toThrow(GatewayError)
  })
})

describe('anthropic-messages stream', () => {
  const start = { type: 'message_start', message: { model: 'claude-x', usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 3 } } }
  const text = (t: string, index = 0) => ({ type: 'content_block_delta', index, delta: { type: 'text_delta', text: t } })
  const done = (stop_reason: string) => [{ type: 'message_delta', delta: { stop_reason }, usage: { output_tokens: 7 } }, { type: 'message_stop' }]

  it('streams text then usage then end', () => {
    const events = run(stream, [start, { type: 'content_block_start', index: 0, content_block: { type: 'text' } }, text('he'), text('llo'), { type: 'ping' }, { type: 'content_block_stop', index: 0 }, ...done('end_turn')])
    expect(events).toEqual([
      { kind: 'text', text: 'he' },
      { kind: 'text', text: 'llo' },
      { kind: 'usage', usage: { tokensIn: 13, tokensOut: 7, cachedTokensIn: 3 } },
      { kind: 'end', finish: 'stop', model: 'claude-x' },
    ])
  })
  it('accumulates tool-call arguments across deltas', () => {
    const events = run(stream, [
      start,
      { type: 'content_block_start', index: 0, content_block: { type: 'text' } },
      text('ok'),
      { type: 'content_block_stop', index: 0 },
      { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 't1', name: 'f' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"a"' } },
      { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: ':1}' } },
      { type: 'content_block_stop', index: 1 },
      ...done('tool_use'),
    ])
    expect(events.filter((e) => e.kind.startsWith('tool_call'))).toEqual([
      { kind: 'tool_call_start', index: 0, id: 't1', name: 'f' },
      { kind: 'tool_call_delta', index: 0, arguments: '{"a"' },
      { kind: 'tool_call_delta', index: 0, arguments: ':1}' },
      { kind: 'tool_call_end', index: 0 },
    ])
    expect(events.at(-1)).toEqual({ kind: 'end', finish: 'tool_use', model: 'claude-x' })
  })
  it('gives a tool call with no arguments an empty object', () => {
    const events = run(stream, [start, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'f' } }, { type: 'content_block_stop', index: 0 }, ...done('tool_use')])
    expect(events.filter((e) => e.kind === 'tool_call_delta')).toEqual([{ kind: 'tool_call_delta', index: 0, arguments: '{}' }])
  })
  it('errors on a stream cut before message_stop', () => {
    const events = run(stream, [start, text('partial')])
    expect(events.at(-1)).toEqual({ kind: 'error', code: 'PROVIDER_UNAVAILABLE', retryAfter: null })
    expect(events.some((e) => e.kind === 'end')).toBe(false)
  })
  it('errors on a message_stop with no stop reason', () => {
    expect(run(stream, [start, { type: 'message_stop' }]).at(-1)).toMatchObject({ kind: 'error' })
  })
  it('errors on a tool call cut mid-arguments', () => {
    const events = run(stream, [start, { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 't', name: 'f' } }, { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"a"' } }, { type: 'content_block_stop', index: 0 }, ...done('tool_use')])
    expect(events.some((e) => e.kind === 'end')).toBe(false)
    expect(events.at(-1)).toMatchObject({ kind: 'error' })
  })
  it('maps a mid-stream error event and ignores everything after it', () => {
    const events = run(stream, [start, text('a'), { type: 'error', error: { type: 'overloaded_error' } }, text('late'), ...done('end_turn')])
    expect(events).toEqual([{ kind: 'text', text: 'a' }, { kind: 'error', code: 'PROVIDER_UNAVAILABLE', retryAfter: null }])
    expect(run(stream, [{ type: 'error', error: { type: 'rate_limit_error' } }])).toEqual([{ kind: 'error', code: 'RATE_LIMITED', retryAfter: null }])
  })
  it('maps refusal and max_tokens finishes', () => {
    expect(run(stream, [start, ...done('refusal')]).at(-1)).toMatchObject({ finish: 'refusal' })
    expect(run(stream, [start, ...done('max_tokens')]).at(-1)).toMatchObject({ finish: 'length' })
  })
  it('skips unknown event types and fails on a malformed known one', () => {
    expect(run(stream, [{ type: 'future_event' }, start, ...done('end_turn')]).at(-1)).toMatchObject({ kind: 'end' })
    expect(run(stream, [{ type: 'content_block_delta', index: 'x' }]).at(-1)).toMatchObject({ kind: 'error' })
  })
  it('keeps no state between streams', () => {
    run(stream, [start, text('a')])
    expect(run(stream, [start, ...done('end_turn')]).at(-1)).toMatchObject({ kind: 'end' })
  })
})
