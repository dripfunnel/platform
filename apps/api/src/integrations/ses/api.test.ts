import { describe, expect, it } from 'vitest'
import { sesClient, SesRefused, SesUnavailable, type OutgoingEmail } from './api'

const credentials = { region: 'eu-west-1', accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'secret', now: () => new Date('2026-10-05T10:00:00Z') }
const email: OutgoingEmail = { from: '"Northstar" <notify@mail.example>', to: ['maya@northstar.example'], subject: 'Hi', text: 'Hello', html: '<p>Hello</p>', tags: { template: 'staff-invitation', outbox: 'a:b/c' } }

const answering = (status: number, json: unknown, seen: Request[] = [], headers: Record<string, string> = {}) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init))
    return Response.json(json, { status, headers })
  }) as typeof fetch

describe('SES client', () => {
  it('posts one signed SendEmail with text, HTML and tags', async () => {
    const seen: Request[] = []
    const api = sesClient({ ...credentials, fetchImpl: answering(200, { MessageId: 'm-1' }, seen) })
    expect(await api.send(email)).toEqual({ messageId: 'm-1' })
    const request = seen[0]
    expect(request?.url).toBe('https://email.eu-west-1.amazonaws.com/v2/email/outbound-emails')
    expect(request?.headers.get('x-amz-date')).toBe('20261005T100000Z')
    expect(request?.headers.get('authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261005\/eu-west-1\/ses\/aws4_request, SignedHeaders=content-type;host;x-amz-date, Signature=[0-9a-f]{64}$/,
    )
    const body = (await request?.json()) as { Destination: unknown; Content: { Simple: { Body: unknown } }; EmailTags: unknown }
    expect(body.Destination).toEqual({ ToAddresses: ['maya@northstar.example'] })
    expect(body.Content.Simple.Body).toEqual({ Text: { Data: 'Hello', Charset: 'UTF-8' }, Html: { Data: '<p>Hello</p>', Charset: 'UTF-8' } })
    expect(body.EmailTags).toEqual([{ Name: 'template', Value: 'staff-invitation' }, { Name: 'outbox', Value: 'a_b_c' }])
  })

  it("names SES's refusal by its error type", async () => {
    const refused = sesClient({ ...credentials, fetchImpl: answering(400, { message: 'Email address is not verified.' }, [], { 'x-amzn-errortype': 'MessageRejected:http://internal.amazon.com/' }) })
    await expect(refused.send(email)).rejects.toEqual(new SesRefused('MessageRejected'))
    const namespaced = sesClient({ ...credentials, fetchImpl: answering(400, { __type: 'com.amazon#AccountSuspendedException' }) })
    await expect(namespaced.send(email)).rejects.toEqual(new SesRefused('AccountSuspendedException'))
  })

  it('treats a throttle, a 5xx, no answer or an odd shape as unavailable', async () => {
    await expect(sesClient({ ...credentials, fetchImpl: answering(429, {}) }).send(email)).rejects.toBeInstanceOf(SesUnavailable)
    await expect(sesClient({ ...credentials, fetchImpl: answering(503, {}) }).send(email)).rejects.toBeInstanceOf(SesUnavailable)
    await expect(sesClient({ ...credentials, fetchImpl: answering(200, { nope: 1 }) }).send(email)).rejects.toBeInstanceOf(SesUnavailable)
    const failing = (async () => {
      throw new TypeError('network')
    }) as typeof fetch
    await expect(sesClient({ ...credentials, fetchImpl: failing }).send(email)).rejects.toBeInstanceOf(SesUnavailable)
  })
})
