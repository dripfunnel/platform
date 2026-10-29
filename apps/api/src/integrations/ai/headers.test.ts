import { describe, expect, it } from 'vitest'
import { anthropicOAuthBeta, providerHeaders, type HeaderInput } from './headers'
import { anthropicOAuthHeaders } from './anthropicChat'

const base: HeaderInput = { provider: 'anthropic', auth: 'api_key', secret: 'sk-secret', stream: false, hasBody: true }
const of = (input: Partial<HeaderInput>) => providerHeaders({ ...base, ...input })

describe('providerHeaders', () => {
  it('sends an Anthropic key as x-api-key with the version, and no bearer or beta', () => {
    expect(of({})).toEqual({ accept: 'application/json', 'content-type': 'application/json', 'anthropic-version': '2023-06-01', 'x-api-key': 'sk-secret' })
  })

  it('sends a Claude sign-in as a bearer with the OAuth beta, and no x-api-key', () => {
    expect(of({ auth: 'oauth' })).toEqual({ accept: 'application/json', 'content-type': 'application/json', 'anthropic-version': '2023-06-01', authorization: 'Bearer sk-secret', 'anthropic-beta': anthropicOAuthBeta })
  })

  it('keeps the SDK-path OAuth header the same value as the fetch path', () => {
    expect(anthropicOAuthHeaders['anthropic-beta']).toBe(of({ auth: 'oauth' })['anthropic-beta'])
  })

  it('asks for an event stream only when streaming, and sends content-type only with a body', () => {
    expect(of({ stream: true })['accept']).toBe('text/event-stream')
    expect(of({ stream: false })['accept']).toBe('application/json')
    expect(of({ hasBody: false })).not.toHaveProperty('content-type')
  })

  it('sends an OpenAI key as a bearer alone: no Anthropic or ChatGPT header', () => {
    expect(of({ provider: 'openai' })).toEqual({ accept: 'application/json', 'content-type': 'application/json', authorization: 'Bearer sk-secret' })
    expect(of({ provider: 'openai', stream: true, accountId: 'acct' })).toEqual({ accept: 'text/event-stream', 'content-type': 'application/json', authorization: 'Bearer sk-secret' })
  })

  it('sends the ChatGPT sign-in headers only on the Codex endpoint, the account only when known', () => {
    expect(of({ provider: 'openai', auth: 'oauth', codex: true, stream: true, accountId: 'acct-1' })).toEqual({ accept: 'text/event-stream', 'content-type': 'application/json', authorization: 'Bearer sk-secret', originator: 'codex_cli_rs', 'chatgpt-account-id': 'acct-1' })
    expect(of({ provider: 'openai', auth: 'oauth', codex: true, stream: true, accountId: null })).not.toHaveProperty('chatgpt-account-id')
    expect(of({ provider: 'openai', auth: 'oauth' })).not.toHaveProperty('originator')
  })

  it('never carries one auth method’s header into the other, and never repeats a name', () => {
    for (const input of [{}, { auth: 'oauth' as const }, { provider: 'openai' as const }, { provider: 'openai' as const, auth: 'oauth' as const, codex: true, accountId: 'a' }]) {
      const names = Object.keys(providerHeaders({ ...base, ...input }))
      expect(new Set(names).size).toBe(names.length)
    }
    expect(of({ auth: 'oauth' })).not.toHaveProperty('x-api-key')
    expect(of({})).not.toHaveProperty('authorization')
  })
})
