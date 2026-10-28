import { describe, expect, it, vi } from 'vitest'
import { createPkce } from './pkce'
import { openaiOAuth } from './openai'
import { anthropicOAuth } from './anthropic'
import { OAuthError, type OAuthTokens } from './types'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const jwt = (payload: object) => `h.${btoa(JSON.stringify(payload)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')}.s`
const formOf = (call: unknown[]) => Object.fromEntries(new URLSearchParams(String((call[1] as RequestInit).body)))
const jsonOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>
const tokens: OAuthTokens = { accessToken: 'old', refreshToken: 'rt', expiresAt: 0, accountLabel: 'a@b.example', accountId: 'ws-1' }

describe('PKCE', () => {
  it('makes a fresh verifier and its S256 challenge', async () => {
    const a = await createPkce()
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(a.verifier)))
    expect(a.challenge).toBe(btoa(String.fromCharCode(...digest)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', ''))
    expect((await createPkce()).verifier).not.toBe(a.verifier)
  })
})

describe('ChatGPT sign-in', () => {
  it('asks at OpenAI with PKCE, state and the loopback redirect the person pastes back from', () => {
    const adapter = openaiOAuth()
    expect(adapter.availability()).toEqual({ available: true })
    const url = new URL(adapter.authorizeUrl({ state: 'st', challenge: 'ch' }))
    expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ response_type: 'code', redirect_uri: 'http://localhost:1455/auth/callback', state: 'st', code_challenge: 'ch', code_challenge_method: 'S256', prompt: 'login' })
    expect(adapter.redirectUri).toBe('http://localhost:1455/auth/callback')
  })

  it('exchanges a code form-encoded, with no secret, reading the email and workspace from the id token', async () => {
    const idToken = jwt({ email: 'a@b.example', 'https://api.openai.com/auth': { chatgpt_account_id: 'ws-1' } })
    const send = vi.fn().mockResolvedValue(json({ access_token: 'at', token_type: 'Bearer', refresh_token: 'rt', expires_in: 3600, id_token: idToken }))
    const result = await openaiOAuth({ fetch: send }).exchangeCode({ code: 'c', state: 's', verifier: 'v' })
    expect(result).toMatchObject({ accessToken: 'at', refreshToken: 'rt', accountLabel: 'a@b.example', accountId: 'ws-1' })
    const call = send.mock.calls[0] as unknown[]
    expect(call[0]).toBe('https://auth.openai.com/oauth/token')
    expect(formOf(call)).toMatchObject({ grant_type: 'authorization_code', code: 'c', code_verifier: 'v', redirect_uri: 'http://localhost:1455/auth/callback' })
    expect(formOf(call)).not.toHaveProperty('client_secret')
    expect((call[1] as RequestInit).redirect).toBe('manual')
  })

  it('never forwards the provider\'s error body', async () => {
    const send = vi.fn().mockResolvedValue(new Response('sensitive-token', { status: 400 }))
    const failure = await openaiOAuth({ fetch: send }).exchangeCode({ code: 'c', state: 's', verifier: 'v' }).catch((e: unknown) => e)
    expect(failure).toBeInstanceOf(OAuthError)
    expect(JSON.stringify(failure)).not.toContain('sensitive-token')
    expect((failure as OAuthError).code).toBe('EXCHANGE_FAILED')
  })

  it('renews keeping the old refresh token, label and workspace when none come back', async () => {
    const send = vi.fn().mockResolvedValue(json({ access_token: 'new', token_type: 'Bearer', expires_in: 3600 }))
    const renewed = await openaiOAuth({ fetch: send }).refresh(tokens)
    expect(renewed).toMatchObject({ accessToken: 'new', refreshToken: 'rt', accountLabel: 'a@b.example', accountId: 'ws-1' })
    expect(formOf(send.mock.calls[0] as unknown[])).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt' })
  })

  it('tells a refused grant from a provider that is down', async () => {
    const refuse = (response: Response | Error) => openaiOAuth({ fetch: response instanceof Error ? vi.fn().mockRejectedValue(response) : vi.fn().mockResolvedValue(response) }).refresh(tokens)
    await expect(refuse(json({ error: 'refresh_token_reused' }, 400))).rejects.toMatchObject({ code: 'REFRESH_REJECTED' })
    await expect(refuse(json({ error: 'invalid_client' }, 401))).rejects.toMatchObject({ code: 'CLIENT_REFUSED' })
    await expect(refuse(new Response('<html>', { status: 401 }))).rejects.toMatchObject({ code: 'CLIENT_REFUSED' })
    await expect(refuse(new Response('', { status: 503 }))).rejects.toMatchObject({ code: 'PROVIDER_DOWN' })
    await expect(refuse(new Error('net'))).rejects.toMatchObject({ code: 'PROVIDER_DOWN' })
    await expect(openaiOAuth().refresh({ ...tokens, refreshToken: null })).rejects.toMatchObject({ code: 'REFRESH_REJECTED' })
  })

  it('lets an account be removed with no call to OpenAI', async () => {
    const send = vi.fn()
    await expect(openaiOAuth({ fetch: send }).revoke(tokens)).resolves.toBeUndefined()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('Claude sign-in', () => {
  it('asks at claude.ai with PKCE, state and the code page the person pastes back from', () => {
    const adapter = anthropicOAuth()
    expect(adapter.availability()).toEqual({ available: true })
    const url = new URL(adapter.authorizeUrl({ state: 'st', challenge: 'ch' }))
    expect(url.origin + url.pathname).toBe('https://claude.ai/oauth/authorize')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ code: 'true', response_type: 'code', redirect_uri: 'https://platform.claude.com/oauth/code/callback', scope: 'user:profile user:inference', state: 'st', code_challenge: 'ch', code_challenge_method: 'S256' })
  })

  it('exchanges a code as JSON with state, verifier and no secret', async () => {
    const send = vi.fn().mockResolvedValue(json({ access_token: 'at', token_type: 'Bearer', refresh_token: 'rt', expires_in: 3600 }))
    const result = await anthropicOAuth({ fetch: send }).exchangeCode({ code: 'c', state: 's', verifier: 'v' })
    expect(result).toMatchObject({ accessToken: 'at', refreshToken: 'rt', accountId: null })
    const call = send.mock.calls[0] as unknown[]
    expect(call[0]).toBe('https://api.anthropic.com/v1/oauth/token')
    expect(((call[1] as RequestInit).headers as Record<string, string>)['content-type']).toBe('application/json')
    expect(jsonOf(call)).toMatchObject({ grant_type: 'authorization_code', code: 'c', state: 's', code_verifier: 'v', redirect_uri: 'https://platform.claude.com/oauth/code/callback' })
    expect(jsonOf(call)).not.toHaveProperty('client_secret')
  })

  it('never forwards the provider\'s error body', async () => {
    const failure = await anthropicOAuth({ fetch: vi.fn().mockResolvedValue(new Response('sensitive-token', { status: 400 })) }).exchangeCode({ code: 'c', state: 's', verifier: 'v' }).catch((e: unknown) => e)
    expect((failure as OAuthError).code).toBe('EXCHANGE_FAILED')
    expect(JSON.stringify(failure)).not.toContain('sensitive-token')
  })

  it('renews keeping the refresh token, and tells a refused grant from a provider that is down', async () => {
    const renewed = await anthropicOAuth({ fetch: vi.fn().mockResolvedValue(json({ access_token: 'new', token_type: 'Bearer', expires_in: 3600 })) }).refresh(tokens)
    expect(renewed).toMatchObject({ accessToken: 'new', refreshToken: 'rt' })
    await expect(anthropicOAuth({ fetch: vi.fn().mockResolvedValue(json({ error: 'invalid_grant' }, 400)) }).refresh(tokens)).rejects.toMatchObject({ code: 'REFRESH_REJECTED' })
    await expect(anthropicOAuth({ fetch: vi.fn().mockResolvedValue(json({ error: 'invalid_client' }, 401)) }).refresh(tokens)).rejects.toMatchObject({ code: 'CLIENT_REFUSED' })
    await expect(anthropicOAuth({ fetch: vi.fn().mockResolvedValue(new Response('', { status: 500 })) }).refresh(tokens)).rejects.toMatchObject({ code: 'PROVIDER_DOWN' })
  })
})
