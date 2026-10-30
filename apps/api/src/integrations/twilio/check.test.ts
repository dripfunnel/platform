import { describe, expect, it } from 'vitest'
import { checkTwilioAccount } from './check'

const credentials = { accountSid: 'AC123', authToken: 'tok', messagingServiceSid: 'MG456' }

const answering = (status: number, seen: Request[] = []) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init))
    return new Response('{}', { status })
  }) as typeof fetch

describe('the Twilio account check', () => {
  it('reads the messaging service with basic auth and sends nothing', async () => {
    const seen: Request[] = []
    expect(await checkTwilioAccount({ ...credentials, fetchImpl: answering(200, seen) })).toBe('ok')
    expect(seen).toHaveLength(1)
    expect(seen[0]?.method).toBe('GET')
    expect(seen[0]?.url).toBe('https://messaging.twilio.com/v1/Services/MG456')
    expect(seen[0]?.headers.get('authorization')).toBe(`Basic ${btoa('AC123:tok')}`)
  })

  it('calls a refused credential or an unknown service rejected', async () => {
    for (const status of [401, 403, 404]) expect(await checkTwilioAccount({ ...credentials, fetchImpl: answering(status) })).toBe('rejected')
  })

  it('calls an outage, a throttle or no answer unavailable, never rejected', async () => {
    for (const status of [429, 500, 503]) expect(await checkTwilioAccount({ ...credentials, fetchImpl: answering(status) })).toBe('unavailable')
    expect(await checkTwilioAccount({ ...credentials, fetchImpl: (async () => Promise.reject(new Error('down'))) as typeof fetch })).toBe('unavailable')
  })
})
