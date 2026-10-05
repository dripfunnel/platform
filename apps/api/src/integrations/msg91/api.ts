import { z } from 'zod'
import { SmsRefused, smsTimeoutMs, SmsUnavailable, type OutgoingSms, type SmsSender } from '#core/sms'

// A partner's own MSG91 account (THIRD-PARTY-ACCESS §2.8, §8.3): DLT-registered templates sent
// through the Flow API, so India's operators deliver them. Free text is never sent.

export interface Msg91Credentials {
  authKey: string
}

const okSchema = z.object({ type: z.literal('success'), message: z.string() }).loose()
const errorSchema = z.object({ type: z.string().optional(), message: z.string().optional(), code: z.union([z.string(), z.number()]).optional() }).loose()

// MSG91 takes the number without `+`, and each template variable as var1, var2…
const recipient = (sms: OutgoingSms, vars: readonly string[]) => ({
  mobiles: sms.to.replace(/^\+/, ''),
  ...Object.fromEntries(vars.map((value, i) => [`var${i + 1}`, value])),
})

export const msg91Sender = ({ authKey, fetchImpl = fetch }: Msg91Credentials & { fetchImpl?: typeof fetch }): SmsSender => ({
  send: async (sms, signal) => {
    if (!sms.dlt) throw new SmsRefused('no_dlt_template')
    const timeout = AbortSignal.timeout(smsTimeoutMs)
    let response: Response
    try {
      response = await fetchImpl('https://control.msg91.com/api/v5/flow', {
        method: 'POST',
        headers: { authkey: authKey, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ template_id: sms.dlt.templateId, short_url: '0', recipients: [recipient(sms, sms.dlt.vars)] }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch {
      throw new SmsUnavailable('no answer')
    }
    const json: unknown = await response.json().catch(() => null)
    if (response.status >= 500 || response.status === 429) throw new SmsUnavailable(`answered ${response.status}`)
    const ok = okSchema.safeParse(json)
    if (response.ok && ok.success) return { providerId: ok.data.message }
    // MSG91 answers some refusals with 200 and `type: error`; its code, never its message, is logged.
    const error = errorSchema.safeParse(json)
    throw new SmsRefused(error.success && error.data.code !== undefined ? `msg91_${String(error.data.code)}` : `msg91_${response.status}`)
  },
})
