import { z } from 'zod'
import { SmsRefused, smsTimeoutMs, SmsUnavailable } from '#core/sms'
import type { WhatsAppSender } from '#core/whatsapp'

// A partner's WhatsApp Business number through its own MSG91 account (THIRD-PARTY-ACCESS §2.8, §4; #337): an approved
// template sent through MSG91's outbound API, its variables as the template's body parameters in order.

export interface Msg91WhatsAppCredentials {
  authKey: string
  /** The WhatsApp Business number MSG91 sends from, digits only. */
  integratedNumber: string
}

const okSchema = z.object({ status: z.literal('success'), request_id: z.string().optional() }).loose()
const errorSchema = z.object({ errors: z.unknown().optional(), code: z.union([z.string(), z.number()]).optional() }).loose()

export const msg91WhatsAppSender = ({ authKey, integratedNumber, fetchImpl = fetch }: Msg91WhatsAppCredentials & { fetchImpl?: typeof fetch }): WhatsAppSender => ({
  send: async (message, signal) => {
    const timeout = AbortSignal.timeout(smsTimeoutMs)
    const components = Object.fromEntries(message.vars.map((value, i) => [`body_${i + 1}`, { type: 'text', value }]))
    let response: Response
    try {
      response = await fetchImpl('https://api.msg91.com/api/v5/whatsapp/whatsapp-outbound-message/bulk/', {
        method: 'POST',
        headers: { authkey: authKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          integrated_number: integratedNumber,
          content_type: 'template',
          payload: {
            messaging_product: 'whatsapp',
            type: 'template',
            template: { name: message.template, language: { code: message.language, policy: 'deterministic' }, to_and_components: [{ to: [message.to.replace(/^\+/, '')], components }] },
          },
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch {
      throw new SmsUnavailable('no answer')
    }
    const json: unknown = await response.json().catch(() => null)
    // A refused credential is the partner's to fix, not the number's fault: retried, never dropped.
    if (response.status >= 500 || response.status === 429 || response.status === 401 || response.status === 403) throw new SmsUnavailable(`answered ${response.status}`)
    const ok = okSchema.safeParse(json)
    if (response.ok && ok.success) return { providerId: ok.data.request_id ?? 'msg91' }
    // Its code, never its message, is kept: a message can carry the number.
    const error = errorSchema.safeParse(json)
    throw new SmsRefused(error.success && error.data.code !== undefined ? `msg91_wa_${String(error.data.code)}` : `msg91_wa_${response.status}`)
  },
})
