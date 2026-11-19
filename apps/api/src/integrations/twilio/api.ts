import { z } from 'zod'
import { SmsRefused, smsTimeoutMs, SmsUnavailable, type SmsAccountCheck, type SmsSender } from '#core/sms'

// DripFunnel's or a partner's own Twilio account (THIRD-PARTY-ACCESS §2.8, §8.3) through the Messages API,
// sending from its Messaging Service, which holds the account's numbers and sender name.

export interface TwilioCredentials {
  accountSid: string
  authToken: string
  messagingServiceSid: string
}

const sentSchema = z.object({ sid: z.string().min(1) }).loose()
const errorSchema = z.object({ code: z.number().optional() }).loose()

export const twilioSender = ({ accountSid, authToken, messagingServiceSid, fetchImpl = fetch }: TwilioCredentials & { fetchImpl?: typeof fetch }): SmsSender => ({
  send: async (sms, signal) => {
    const timeout = AbortSignal.timeout(smsTimeoutMs)
    const body = new URLSearchParams({ To: sms.to, MessagingServiceSid: messagingServiceSid, Body: sms.text })
    let response: Response
    try {
      response = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(accountSid)}/Messages.json`, {
        method: 'POST',
        headers: { authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: body.toString(),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      })
    } catch {
      throw new SmsUnavailable('no answer')
    }
    const json: unknown = await response.json().catch(() => null)
    // A refused credential is the partner's to fix, not the number's fault: retried, never dropped.
    if (response.status >= 500 || response.status === 429 || response.status === 401 || response.status === 403) throw new SmsUnavailable(`answered ${response.status}`)
    if (!response.ok) {
      // Twilio's numeric error code (e.g. 21211, an invalid number) is safe to log; its message can echo the number.
      const error = errorSchema.safeParse(json)
      throw new SmsRefused(error.success && error.data.code !== undefined ? `twilio_${error.data.code}` : `twilio_${response.status}`)
    }
    // A 2xx is Twilio accepting the text: retrying an unreadable answer would send it twice.
    const sent = sentSchema.safeParse(json)
    return { providerId: sent.success ? sent.data.sid : 'unknown' }
  },
})

/** Whether the SID and token open the account and its Messaging Service, by reading the service: nothing is sent (#1017). */
export const checkTwilioAccount = async ({ accountSid, authToken, messagingServiceSid, fetchImpl = fetch }: TwilioCredentials & { fetchImpl?: typeof fetch }): Promise<SmsAccountCheck> => {
  let response: Response
  try {
    response = await fetchImpl(`https://messaging.twilio.com/v1/Services/${encodeURIComponent(messagingServiceSid)}`, {
      headers: { authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`, accept: 'application/json' },
      signal: AbortSignal.timeout(smsTimeoutMs),
    })
  } catch {
    return 'unavailable'
  }
  // 404: the service isn't this account's, so its texts would fail too.
  if (response.status === 401 || response.status === 403 || response.status === 404) return 'rejected'
  return response.ok ? 'ok' : 'unavailable'
}
