import { describe, expect, it } from 'vitest'
import { SmsRefused, SmsUnavailable, type OutgoingSms } from '#core/sms'
import { msg91Sender } from './api'

const sms: OutgoingSms = { to: '+919845022113', text: 'Kesari Threads: 482913 is your sign-in code.', dlt: { templateId: 'tmpl-1', vars: ['Kesari Threads', '482913'] } }

const answering = (status: number, body: unknown, seen: Request[] = []) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init))
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

describe('the MSG91 sender', () => {
  it('sends the DLT template with its variables in order, the number without +, and the auth key as a header', async () => {
    const seen: Request[] = []
    const sent = await msg91Sender({ authKey: 'k-1', fetchImpl: answering(200, { type: 'success', message: 'req-42' }, seen) }).send(sms)
    expect(sent).toEqual({ providerId: 'req-42' })
    const request = seen[0]
    expect(request?.url).toBe('https://control.msg91.com/api/v5/flow')
    expect(request?.headers.get('authkey')).toBe('k-1')
    expect(await request?.json()).toEqual({ template_id: 'tmpl-1', short_url: '0', recipients: [{ mobiles: '919845022113', var1: 'Kesari Threads', var2: '482913' }] })
  })

  it('never sends free text: a message without a DLT template is refused before any call', async () => {
    const seen: Request[] = []
    await expect(msg91Sender({ authKey: 'k', fetchImpl: answering(200, {}, seen) }).send({ ...sms, dlt: null })).rejects.toEqual(new SmsRefused('no_dlt_template'))
    expect(seen).toHaveLength(0)
  })

  it('reads a refusal answered with 200 and type error as a refusal, keeping only its code', async () => {
    await expect(msg91Sender({ authKey: 'k', fetchImpl: answering(200, { type: 'error', message: 'Invalid mobile 9198…', code: '418' }) }).send(sms)).rejects.toEqual(new SmsRefused('msg91_418'))
  })

  it('retries a refused auth key rather than dropping the text: the key is the partner’s to fix', async () => {
    await expect(msg91Sender({ authKey: 'k', fetchImpl: answering(401, { type: 'error' }) }).send(sms)).rejects.toBeInstanceOf(SmsUnavailable)
    await expect(msg91Sender({ authKey: 'k', fetchImpl: answering(403, {}) }).send(sms)).rejects.toBeInstanceOf(SmsUnavailable)
  })

  it('treats an outage, throttling and no answer as worth retrying', async () => {
    await expect(msg91Sender({ authKey: 'k', fetchImpl: answering(503, {}) }).send(sms)).rejects.toBeInstanceOf(SmsUnavailable)
    await expect(msg91Sender({ authKey: 'k', fetchImpl: answering(429, {}) }).send(sms)).rejects.toBeInstanceOf(SmsUnavailable)
    const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch
    const controller = new AbortController()
    const pending = msg91Sender({ authKey: 'k', fetchImpl: hanging }).send(sms, controller.signal)
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(SmsUnavailable)
  })
})
