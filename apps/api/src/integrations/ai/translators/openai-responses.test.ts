import { describe, expect, it } from 'vitest'
import { GatewayError } from '../gateway'
import { UnsupportedFeature, type CanonicalRequest } from '../canonical'
import { base, bare, caps, png, run, withTools } from './fixtures'
import { openaiResponsesRequest as request, openaiResponsesResponse as response, openaiResponsesStream as stream } from './openai-responses'

const translate = (r: CanonicalRequest, c = caps) => request.translate(r, c)

describe('openai-responses request', () => {
  it('sends the system as instructions, developer as an input item, and max_output_tokens', () => {
    const body = translate({ ...base, system: 's', developer: 'd' })
    expect(body).toMatchObject({ instructions: 's', max_output_tokens: 100 })
    expect(body.input).toEqual([{ role: 'developer', content: 'd' }, { role: 'user', content: [{ type: 'input_text', text: 'hi' }] }])
    expect(() => translate({ ...base, developer: 'd' }, { ...caps, developerRole: false })).toThrow(UnsupportedFeature)
  })
  it('refuses stop sequences, which the format lacks, and clamps temperature to 2', () => {
    expect(() => translate({ ...base, stop: ['x'] })).toThrow(UnsupportedFeature)
    expect(translate({ ...base, temperature: 5 }).temperature).toBe(2)
  })
  it('sends images as input_image', () => {
    const body = translate({ ...base, messages: [{ role: 'user', content: [png] }] })
    expect(body.input[0]).toEqual({ role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,aGVsbG8=' }] })
    expect(() => translate({ ...base, messages: [{ role: 'user', content: [png] }] }, bare)).toThrow(UnsupportedFeature)
  })
  it('translates tools to function, function_call and function_call_output', () => {
    const body = translate({ ...withTools, toolChoice: { name: 'get_weather' } })
    expect(body.tools).toEqual([{ type: 'function', name: 'get_weather', description: 'Weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } }])
    expect(body.tool_choice).toEqual({ type: 'function', name: 'get_weather' })
    expect(body.input.slice(1)).toEqual([
      { role: 'assistant', content: [{ type: 'output_text', text: 'checking' }] },
      { type: 'function_call', call_id: 'c1', name: 'get_weather', arguments: '{"city":"Pune"}' },
      { type: 'function_call_output', call_id: 'c1', output: '31C' },
    ])
    expect(() => translate(withTools, bare)).toThrow(UnsupportedFeature)
    expect(() => translate({ ...withTools, messages: withTools.messages.slice(0, 2) })).toThrow(GatewayError)
  })
  it('sends reasoning effort and structured output as text.format', () => {
    const body = translate({ ...base, reasoningEffort: 'low', structuredOutput: { name: 'out', schema: { type: 'object' } } })
    expect(body).toMatchObject({ reasoning: { effort: 'low' }, text: { format: { type: 'json_schema', name: 'out', schema: { type: 'object' } } } })
    expect(() => translate({ ...base, reasoningEffort: 'low' }, bare)).toThrow(UnsupportedFeature)
    expect(() => translate({ ...base, structuredOutput: { name: 'out', schema: {} } }, bare)).toThrow(UnsupportedFeature)
  })
  it('refuses a tool result error flag', () => {
    const failing = { ...withTools, messages: [...withTools.messages.slice(0, 2), { role: 'tool' as const, content: [{ type: 'tool_result' as const, callId: 'c1', content: 'x', isError: true }] }] }
    expect(() => translate(failing)).toThrow(UnsupportedFeature)
  })
})

describe('openai-responses response', () => {
  const usage = { input_tokens: 8, output_tokens: 2, input_tokens_details: { cached_tokens: 5 } }
  const message = (text: string) => ({ type: 'message', content: [{ type: 'output_text', text }] })
  it('parses text and cached usage', () => {
    expect(response.parse({ model: 'gpt-x', status: 'completed', output: [message('he'), message('llo')], usage })).toEqual({ text: 'hello', toolCalls: [], finish: 'stop', usage: { tokensIn: 8, tokensOut: 2, cachedTokensIn: 5 }, model: 'gpt-x' })
  })
  it('parses function calls and incomplete and refusal outcomes', () => {
    expect(response.parse({ model: 'm', status: 'completed', output: [{ type: 'function_call', call_id: 'c', name: 'f', arguments: '{"a":1}' }] })).toMatchObject({ toolCalls: [{ id: 'c', name: 'f', arguments: '{"a":1}' }], finish: 'tool_use' })
    expect(response.parse({ model: 'm', status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [message('x')] }).finish).toBe('length')
    expect(response.parse({ model: 'm', status: 'incomplete', incomplete_details: { reason: 'content_filter' }, output: [] }).finish).toBe('refusal')
    expect(response.parse({ model: 'm', status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', text: 'no' }] }] }).finish).toBe('refusal')
  })
  it('turns failures, in-progress responses and malformed bodies into gateway errors', () => {
    expect(() => response.parse({ model: 'm', status: 'failed', error: { code: 'rate_limit_exceeded' } })).toThrow(expect.objectContaining({ code: 'RATE_LIMITED' }))
    expect(() => response.parse({ model: 'm', status: 'in_progress' })).toThrow(GatewayError)
    expect(() => response.parse({})).toThrow(GatewayError)
  })
})

describe('openai-responses stream', () => {
  const delta = (d: string) => ({ type: 'response.output_text.delta', delta: d })
  const usage = { input_tokens: 8, output_tokens: 2, input_tokens_details: { cached_tokens: 1 } }
  const completed = { type: 'response.completed', response: { model: 'gpt-x', status: 'completed', usage } }

  it('streams text then usage and end', () => {
    expect(run(stream, [{ type: 'response.created' }, delta('he'), delta('llo'), completed])).toEqual([
      { kind: 'text', text: 'he' },
      { kind: 'text', text: 'llo' },
      { kind: 'usage', usage: { tokensIn: 8, tokensOut: 2, cachedTokensIn: 1 } },
      { kind: 'end', finish: 'stop', model: 'gpt-x' },
    ])
  })
  it('accumulates function-call arguments and takes the finished item as the whole', () => {
    const added = { type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', call_id: 'c', name: 'f', arguments: '' } }
    const events = run(stream, [
      added,
      { type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"a"' },
      { type: 'response.function_call_arguments.delta', output_index: 1, delta: ':1}' },
      { type: 'response.output_item.done', output_index: 1, item: { type: 'function_call', call_id: 'c', name: 'f', arguments: '{"a":1}' } },
      completed,
    ])
    expect(events.filter((e) => e.kind.startsWith('tool_call'))).toEqual([
      { kind: 'tool_call_start', index: 0, id: 'c', name: 'f' },
      { kind: 'tool_call_delta', index: 0, arguments: '{"a"' },
      { kind: 'tool_call_delta', index: 0, arguments: ':1}' },
      { kind: 'tool_call_end', index: 0 },
    ])
    expect(events.at(-1)).toEqual({ kind: 'end', finish: 'tool_use', model: 'gpt-x' })
  })
  it('handles a function call that arrives only as a done item', () => {
    const events = run(stream, [{ type: 'response.output_item.done', output_index: 0, item: { type: 'function_call', call_id: 'c', name: 'f', arguments: '{"a":1}' } }, completed])
    expect(events.filter((e) => e.kind.startsWith('tool_call')).map((e) => e.kind)).toEqual(['tool_call_start', 'tool_call_delta', 'tool_call_end'])
  })
  it('maps response.incomplete to length or other', () => {
    const incomplete = (reason: string) => ({ type: 'response.incomplete', response: { model: 'm', status: 'incomplete', incomplete_details: { reason }, usage } })
    expect(run(stream, [delta('x'), incomplete('max_output_tokens')]).at(-1)).toMatchObject({ kind: 'end', finish: 'length' })
    expect(run(stream, [incomplete('other')]).at(-1)).toMatchObject({ finish: 'other' })
  })
  it('maps response.failed, the usage-limit code and a bare error event to gateway errors', () => {
    const failed = (code: string) => ({ type: 'response.failed', response: { error: { code } } })
    expect(run(stream, [delta('a'), failed('subscription_sharing_usage_limit')]).at(-1)).toEqual({ kind: 'error', code: 'RATE_LIMITED', retryAfter: null })
    expect(run(stream, [failed('server_error')]).at(-1)).toMatchObject({ code: 'PROVIDER_UNAVAILABLE' })
    expect(run(stream, [{ type: 'error', code: 'invalid_api_key' }]).at(-1)).toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })
  it('errors on a truncated stream and never ends in success', () => {
    const events = run(stream, [delta('partial')])
    expect(events.at(-1)).toEqual({ kind: 'error', code: 'PROVIDER_UNAVAILABLE', retryAfter: null })
    expect(events.some((e) => e.kind === 'end')).toBe(false)
  })
  it('errors when a function call is cut before its arguments are whole', () => {
    const events = run(stream, [{ type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'c', name: 'f' } }, { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"a"' }, completed])
    expect(events.some((e) => e.kind === 'end')).toBe(false)
    expect(events.at(-1)).toMatchObject({ kind: 'error' })
  })
  it('ignores events after the terminal one and tracks a streamed refusal', () => {
    expect(run(stream, [completed, delta('late')]).filter((e) => e.kind === 'text')).toEqual([])
    expect(run(stream, [{ type: 'response.refusal.delta', delta: 'no' }, completed]).at(-1)).toMatchObject({ finish: 'refusal' })
  })
})
