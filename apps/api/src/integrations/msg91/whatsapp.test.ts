import { describe, expect, it } from 'vitest'
import { SmsRefused, SmsUnavailable } from '#core/sms'
import type { OutgoingWhatsApp } from '#core/whatsapp'
import { msg91WhatsAppSender } from './whatsapp'

const message: OutgoingWhatsApp = { to: '+919845022113', template: 'cart_reminder', language: 'en', vars: ['Kesari Threads', '2 items', 'https://kesari.shops.example/cart/r/abc'] }

const answering = (status: number, body: unknown, seen: Request[] = []) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init))
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

describe('the MSG91 WhatsApp sender', () => {
  it('sends the approved template from the partner’s number, its variables as body parameters in order', async () => {
    const seen: Request[] = []
    const sent = await msg91WhatsAppSender({ authKey: 'k-1', integratedNumber: '919800000000', fetchImpl: answering(200, { status: 'success', request_id: 'wa-7' }, seen) }).send(message)
    expect(sent).toEqual({ providerId: 'wa-7' })
    expect(seen[0]?.headers.get('authkey')).toBe('k-1')
    expect(await seen[0]?.json()).toEqual({
      integrated_number: '919800000000',
      content_type: 'template',
      payload: {
        messaging_product: 'whatsapp',
        type: 'template',
        template: {
          name: 'cart_reminder',
          language: { code: 'en', policy: 'deterministic' },
          to_and_components: [{ to: ['919845022113'], components: { body_1: { type: 'text', value: 'Kesari Threads' }, body_2: { type: 'text', value: '2 items' }, body_3: { type: 'text', value: 'https://kesari.shops.example/cart/r/abc' } } }],
        },
      },
    })
  })

  it('reads a refusal by its code alone, and retries an outage or a refused key', async () => {
    await expect(msg91WhatsAppSender({ authKey: 'k', integratedNumber: '1', fetchImpl: answering(400, { code: 131026, errors: 'not on WhatsApp +9198…' }) }).send(message)).rejects.toEqual(new SmsRefused('msg91_wa_131026'))
    for (const status of [401, 403, 429, 503]) await expect(msg91WhatsAppSender({ authKey: 'k', integratedNumber: '1', fetchImpl: answering(status, {}) }).send(message)).rejects.toBeInstanceOf(SmsUnavailable)
  })
})
