import { describe, expect, it } from 'vitest'
import { checkMsg91Account } from './check'

const input = { authKey: 'k'.repeat(24), templateId: 'tmpl-2fa' }

const answering = (status: number, seen: Request[] = []) =>
  (async (request: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(request, init))
    return new Response(JSON.stringify({ type: 'error' }), { status })
  }) as typeof fetch

describe('the MSG91 account check', () => {
  it('posts the Flow call with no recipient, so no text can be sent', async () => {
    const seen: Request[] = []
    expect(await checkMsg91Account({ ...input, fetchImpl: answering(200, seen) })).toBe('ok')
    expect(seen[0]?.url).toBe('https://control.msg91.com/api/v5/flow')
    expect(seen[0]?.headers.get('authkey')).toBe(input.authKey)
    expect(await seen[0]?.json()).toEqual({ template_id: 'tmpl-2fa', short_url: '0', recipients: [] })
  })

  it('calls a key MSG91 answers with a complaint about the missing recipient working', async () => {
    expect(await checkMsg91Account({ ...input, fetchImpl: answering(400) })).toBe('ok')
    expect(await checkMsg91Account({ ...input, fetchImpl: answering(422) })).toBe('ok')
  })

  it('calls a refused key rejected', async () => {
    for (const status of [401, 403]) expect(await checkMsg91Account({ ...input, fetchImpl: answering(status) })).toBe('rejected')
  })

  it('calls an outage, a throttle or no answer unavailable, never rejected', async () => {
    for (const status of [429, 500, 502]) expect(await checkMsg91Account({ ...input, fetchImpl: answering(status) })).toBe('unavailable')
    expect(await checkMsg91Account({ ...input, fetchImpl: (async () => Promise.reject(new Error('down'))) as typeof fetch })).toBe('unavailable')
  })
})
