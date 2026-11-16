import { describe, expect, it } from 'vitest'
import { SmsRefused, SmsUnavailable } from '#core/sms'
import type { OutgoingWhatsApp } from '#core/whatsapp'
import { checkMetaWhatsAppAccount, graphApiVersion, metaWhatsAppSender } from './whatsapp'

const token = `EAAG${'x'.repeat(40)}`
const credentials = { accessToken: token, phoneNumberId: '106540352242922' }
const cart: OutgoingWhatsApp = { to: '+919845022113', template: 'cart_reminder', language: 'en', vars: ['Kesari Threads', '2 items', 'https://kesari.shops.example/cart/r/abc'] }

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const answering = (status: number, body: unknown, seen: Request[] = []) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push(new Request(input, init))
    return json(status, body)
  }) as typeof fetch
const metaError = (code: number) => ({ error: { message: `(#${code}) about +919845022113`, type: 'OAuthException', code, fbtrace_id: 'A1' } })

describe('the Meta WhatsApp sender', () => {
  it('sends a cart template from the partner’s number, its variables as body parameters in order', async () => {
    const seen: Request[] = []
    const sent = await metaWhatsAppSender({ ...credentials, fetchImpl: answering(200, { messaging_product: 'whatsapp', contacts: [{ input: '919845022113', wa_id: '919845022113' }], messages: [{ id: 'wamid.HBg1' }] }, seen) }).send(cart)
    expect(sent).toEqual({ providerId: 'wamid.HBg1' })
    expect(seen[0]?.url).toBe(`https://graph.facebook.com/${graphApiVersion}/106540352242922/messages`)
    expect(seen[0]?.headers.get('authorization')).toBe(`Bearer ${token}`)
    expect(await seen[0]?.json()).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919845022113',
      type: 'template',
      template: {
        name: 'cart_reminder',
        language: { code: 'en' },
        components: [{ type: 'body', parameters: [{ type: 'text', text: 'Kesari Threads' }, { type: 'text', text: '2 items' }, { type: 'text', text: 'https://kesari.shops.example/cart/r/abc' }] }],
      },
    })
  })

  it('sends an authentication template with the code in its body and on its Copy code button', async () => {
    const seen: Request[] = []
    await metaWhatsAppSender({ ...credentials, fetchImpl: answering(200, { messages: [{ id: 'wamid.2' }] }, seen) }).send({ to: '+14155550123', template: 'portal_code', language: 'en_US', vars: ['482913'], copyCode: '482913' })
    expect(await seen[0]?.json()).toMatchObject({
      to: '14155550123',
      template: {
        name: 'portal_code',
        language: { code: 'en_US' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: '482913' }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: '482913' }] },
        ],
      },
    })
  })

  it('gives up a message Meta refuses by its code alone, and retries an outage, a refused token or a throttle', async () => {
    const sender = (status: number, body: unknown) => metaWhatsAppSender({ ...credentials, fetchImpl: answering(status, body) })
    const refused = await sender(400, metaError(131026)).send(cart).catch((e: unknown) => e)
    expect(refused).toEqual(new SmsRefused('meta_wa_131026'))
    expect(String((refused as Error).message)).not.toContain('9845')
    await expect(sender(400, metaError(132001)).send(cart)).rejects.toEqual(new SmsRefused('meta_wa_132001'))
    for (const [status, body] of [[401, metaError(190)], [400, metaError(190)], [400, metaError(131042)], [400, metaError(130429)], [429, {}], [503, {}]] as const) {
      await expect(sender(status, body).send(cart)).rejects.toBeInstanceOf(SmsUnavailable)
    }
    const down = metaWhatsAppSender({ ...credentials, fetchImpl: (async () => Promise.reject(new TypeError('network'))) as typeof fetch })
    await expect(down.send(cart)).rejects.toBeInstanceOf(SmsUnavailable)
  })
})

describe('checking a Meta WhatsApp account', () => {
  const account = { ...credentials, businessAccountId: '102290129340398', language: 'en', templates: { 'cart.reminder': 'cart_reminder', 'code.portal': 'portal_code' } }
  const template = (name: string, status = 'APPROVED', language = 'en') => ({ name, language, status, id: '1' })
  /** Meta's answers: the phone number, and each template by name. */
  const meta = (o: { phone?: Response; templates?: Record<string, unknown[]>; templateStatus?: number } = {}, seen: string[] = []) =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init)
      const url = new URL(request.url)
      seen.push(`${request.method} ${url.pathname}${url.search}`)
      if (url.pathname.endsWith('/message_templates')) {
        const name = url.searchParams.get('name') ?? ''
        return o.templateStatus ? json(o.templateStatus, metaError(100)) : json(200, { data: o.templates?.[name] ?? [template(name)], paging: {} })
      }
      return o.phone ?? json(200, { id: credentials.phoneNumberId, display_phone_number: '+91 98000 00000', verified_name: 'Northstar' })
    }) as typeof fetch

  it('reads the phone number and each named template, and sends nothing', async () => {
    const seen: string[] = []
    expect(await checkMetaWhatsAppAccount({ ...account, fetchImpl: meta({}, seen) })).toEqual({ status: 'ok' })
    expect(seen.every((s) => s.startsWith('GET '))).toBe(true)
    expect(seen.sort()).toEqual([
      `GET /${graphApiVersion}/102290129340398/message_templates?name=cart_reminder&fields=name%2Clanguage%2Cstatus&limit=100`,
      `GET /${graphApiVersion}/102290129340398/message_templates?name=portal_code&fields=name%2Clanguage%2Cstatus&limit=100`,
      `GET /${graphApiVersion}/106540352242922?fields=display_phone_number,verified_name`,
    ])
  })

  it('rejects a wrong token, an unknown phone-number id, an unknown business account, and a named template not approved', async () => {
    expect(await checkMetaWhatsAppAccount({ ...account, fetchImpl: meta({ phone: json(401, metaError(190)) }) })).toEqual({ status: 'rejected', problem: 'token' })
    expect(await checkMetaWhatsAppAccount({ ...account, fetchImpl: meta({ phone: json(400, metaError(190)) }) })).toEqual({ status: 'rejected', problem: 'token' })
    expect(await checkMetaWhatsAppAccount({ ...account, fetchImpl: meta({ phone: json(400, metaError(100)) }) })).toEqual({ status: 'rejected', problem: 'phone_number' })
    expect(await checkMetaWhatsAppAccount({ ...account, fetchImpl: meta({ templateStatus: 400 }) })).toEqual({ status: 'rejected', problem: 'business_account' })
    for (const found of [[template('portal_code', 'PENDING')], [], [template('portal_code_v2')], [template('portal_code', 'APPROVED', 'hi')]]) {
      expect(await checkMetaWhatsAppAccount({ ...account, fetchImpl: meta({ templates: { portal_code: found } }) })).toEqual({ status: 'rejected', problem: 'template', template: 'code.portal' })
    }
  })

  it('answers unavailable when Meta can’t be asked', async () => {
    expect(await checkMetaWhatsAppAccount({ ...account, fetchImpl: meta({ phone: json(503, {}) }) })).toEqual({ status: 'unavailable' })
    expect(await checkMetaWhatsAppAccount({ ...account, fetchImpl: meta({ phone: json(400, metaError(80007)) }) })).toEqual({ status: 'unavailable' })
    expect(await checkMetaWhatsAppAccount({ ...account, fetchImpl: meta({ templateStatus: 500 }) })).toEqual({ status: 'unavailable' })
    expect(await checkMetaWhatsAppAccount({ ...account, fetchImpl: (async () => Promise.reject(new TypeError('network'))) as typeof fetch })).toEqual({ status: 'unavailable' })
  })
})
