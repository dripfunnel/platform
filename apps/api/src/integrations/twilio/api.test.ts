import { describe, expect, it } from 'vitest'
import { SmsRefused, SmsUnavailable, type OutgoingSms } from '#core/sms'
import { twilioSender } from './api'

const sms: OutgoingSms = { to: '+16145550199', text: 'Juniper & Co.: 482913 is your sign-in code.', dlt: null }
const credentials = { accountSid: 'AC123', authToken: 'tok', messagingServiceSid: 'MG456' }

const answering = (status: number, body: unknown, seen: Request[] = []) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init))
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

describe('the Twilio sender', () => {
  it('posts the text from the partner’s Messaging Service with basic auth', async () => {
    const seen: Request[] = []
    expect(await twilioSender({ ...credentials, fetchImpl: answering(201, { sid: 'SM789' }, seen) }).send(sms)).toEqual({ providerId: 'SM789' })
    const request = seen[0]
    expect(request?.url).toBe('https://api.twilio.com/2010-04-01/Accounts/AC123/Messages.json')
    expect(request?.headers.get('authorization')).toBe(`Basic ${btoa('AC123:tok')}`)
    const form = new URLSearchParams(await request?.text())
    expect(Object.fromEntries(form)).toEqual({ To: '+16145550199', MessagingServiceSid: 'MG456', Body: sms.text })
  })

  it('keeps only Twilio’s numeric code from a refusal, never its message', async () => {
    await expect(twilioSender({ ...credentials, fetchImpl: answering(400, { code: 21211, message: "The 'To' number +1614… is not valid" }) }).send(sms)).rejects.toEqual(new SmsRefused('twilio_21211'))
    await expect(twilioSender({ ...credentials, fetchImpl: answering(401, {}) }).send(sms)).rejects.toEqual(new SmsRefused('twilio_401'))
  })

  it('treats an outage, throttling, no answer and an unreadable answer as worth retrying', async () => {
    await expect(twilioSender({ ...credentials, fetchImpl: answering(500, {}) }).send(sms)).rejects.toBeInstanceOf(SmsUnavailable)
    await expect(twilioSender({ ...credentials, fetchImpl: answering(429, {}) }).send(sms)).rejects.toBeInstanceOf(SmsUnavailable)
    await expect(twilioSender({ ...credentials, fetchImpl: answering(201, { nope: true }) }).send(sms)).rejects.toBeInstanceOf(SmsUnavailable)
    const failing = (async () => {
      throw new TypeError('network')
    }) as typeof fetch
    await expect(twilioSender({ ...credentials, fetchImpl: failing }).send(sms)).rejects.toBeInstanceOf(SmsUnavailable)
  })
})
