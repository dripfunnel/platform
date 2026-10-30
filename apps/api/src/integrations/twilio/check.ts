import { smsTimeoutMs, type SmsAccountCheck } from '#core/sms'
import type { TwilioCredentials } from './api'

// Asks Twilio whether an account works, sending nothing (THIRD-PARTY-ACCESS §2.8): the messaging service's own record, which a
// wrong SID, a wrong token, or a service of another account answers with 401 or 404.
export const checkTwilioAccount = async ({ accountSid, authToken, messagingServiceSid, fetchImpl = fetch }: TwilioCredentials & { fetchImpl?: typeof fetch }): Promise<SmsAccountCheck> => {
  try {
    const response = await fetchImpl(`https://messaging.twilio.com/v1/Services/${encodeURIComponent(messagingServiceSid)}`, {
      headers: { authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`, accept: 'application/json' },
      signal: AbortSignal.timeout(smsTimeoutMs),
    })
    if (response.ok) return 'ok'
    return response.status === 401 || response.status === 403 || response.status === 404 ? 'rejected' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}
