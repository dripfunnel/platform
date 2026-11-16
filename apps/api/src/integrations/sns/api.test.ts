import { describe, expect, it } from 'vitest'
import { SmsRefused, SmsUnavailable, type OutgoingSms } from '#core/sms'
import { checkSnsAccount, snsSender } from './api'

const keys = { accessKeyId: 'AKIAABCDEFGHIJKLMNOP', secretAccessKey: 'a'.repeat(40), region: 'ap-south-1', now: () => new Date('2026-11-16T09:00:00Z') }
const india = { ...keys, senderId: 'DRPFNL', entityId: '1101234567890123456' }
const us: OutgoingSms = { to: '+16145550199', text: 'Juniper & Co.: 482913 is your sign-in code.', dlt: null }
const in91: OutgoingSms = { to: '+919845022113', text: 'Kesari Threads: 482913 is your sign-in code.', dlt: { templateId: '1107161', vars: ['Kesari Threads', '482913'] } }

const answering = (status: number, body: string, seen: Request[] = []) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init))
    return new Response(body, { status, headers: { 'content-type': 'text/xml' } })
  }) as typeof fetch

const published = '<PublishResponse><PublishResult><MessageId>msg-42</MessageId></PublishResult></PublishResponse>'
const error = (code: string) => `<ErrorResponse><Error><Type>Sender</Type><Code>${code}</Code><Message>Invalid parameter: PhoneNumber +1614…</Message></Error></ErrorResponse>`

describe('the SNS sender', () => {
  it('publishes a transactional text to the number, signed for SNS in the account’s region', async () => {
    const seen: Request[] = []
    expect(await snsSender({ ...keys, fetchImpl: answering(200, published, seen) }).send(us)).toEqual({ providerId: 'msg-42' })
    const request = seen[0]
    expect(request?.url).toBe('https://sns.ap-south-1.amazonaws.com/')
    expect(request?.headers.get('authorization')).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIAABCDEFGHIJKLMNOP\/20261116\/ap-south-1\/sns\/aws4_request, /)
    expect(Object.fromEntries(new URLSearchParams(await request?.text()))).toEqual({
      Action: 'Publish',
      PhoneNumber: '+16145550199',
      Message: us.text,
      'MessageAttributes.entry.1.Name': 'AWS.SNS.SMS.SMSType',
      'MessageAttributes.entry.1.Value.DataType': 'String',
      'MessageAttributes.entry.1.Value.StringValue': 'Transactional',
      Version: '2010-03-31',
    })
  })

  it('sends an Indian text with the DLT header, entity and template', async () => {
    const seen: Request[] = []
    await snsSender({ ...india, fetchImpl: answering(200, published, seen) }).send(in91)
    const form = Object.fromEntries(new URLSearchParams(await seen[0]?.text()))
    expect([2, 3, 4].map((i) => [form[`MessageAttributes.entry.${i}.Name`], form[`MessageAttributes.entry.${i}.Value.StringValue`]])).toEqual([
      ['AWS.SNS.SMS.SenderID', 'DRPFNL'],
      ['AWS.MM.SMS.EntityId', '1101234567890123456'],
      ['AWS.MM.SMS.TemplateId', '1107161'],
    ])
  })

  it('refuses an Indian text before any call when the account has no DLT header', async () => {
    const seen: Request[] = []
    await expect(snsSender({ ...keys, fetchImpl: answering(200, published, seen) }).send(in91)).rejects.toEqual(new SmsRefused('no_dlt_template'))
    expect(seen).toHaveLength(0)
  })

  it('keeps only SNS’s error code from a refusal, and retries a refused key, throttling, an outage and no answer', async () => {
    await expect(snsSender({ ...keys, fetchImpl: answering(400, error('InvalidParameter')) }).send(us)).rejects.toEqual(new SmsRefused('sns_InvalidParameter'))
    await expect(snsSender({ ...keys, fetchImpl: answering(403, error('InvalidClientTokenId')) }).send(us)).rejects.toBeInstanceOf(SmsUnavailable)
    await expect(snsSender({ ...keys, fetchImpl: answering(400, error('Throttling')) }).send(us)).rejects.toBeInstanceOf(SmsUnavailable)
    await expect(snsSender({ ...keys, fetchImpl: answering(503, '') }).send(us)).rejects.toBeInstanceOf(SmsUnavailable)
    const failing = (async () => {
      throw new TypeError('network')
    }) as typeof fetch
    await expect(snsSender({ ...keys, fetchImpl: failing }).send(us)).rejects.toBeInstanceOf(SmsUnavailable)
  })
})

describe('the SNS account check', () => {
  it('reads the account’s SMS settings and sends nothing', async () => {
    const seen: Request[] = []
    expect(await checkSnsAccount({ ...keys, fetchImpl: answering(200, '<GetSMSAttributesResponse/>', seen) })).toBe('ok')
    expect(new URLSearchParams(await seen[0]?.text()).get('Action')).toBe('GetSMSAttributes')
  })

  it('calls a refused key rejected and an outage unavailable', async () => {
    expect(await checkSnsAccount({ ...keys, fetchImpl: answering(403, error('InvalidClientTokenId')) })).toBe('rejected')
    expect(await checkSnsAccount({ ...keys, fetchImpl: answering(503, '') })).toBe('unavailable')
  })
})
