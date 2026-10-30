import { smsTimeoutMs, type SmsAccountCheck } from '#core/sms'

// Asks MSG91 whether an auth key works, sending nothing (THIRD-PARTY-ACCESS §2.8): the Flow call our sender makes, with no
// recipient, so no text can leave. A refused key answers 401 or 403; a good one answers with a complaint about the missing
// recipient instead. A key with MSG91's IP security on is refused from our servers too, which is the partner's to switch off.
export const checkMsg91Account = async ({ authKey, templateId, fetchImpl = fetch }: { authKey: string; templateId: string; fetchImpl?: typeof fetch }): Promise<SmsAccountCheck> => {
  try {
    const response = await fetchImpl('https://control.msg91.com/api/v5/flow', {
      method: 'POST',
      headers: { authkey: authKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ template_id: templateId, short_url: '0', recipients: [] }),
      signal: AbortSignal.timeout(smsTimeoutMs),
    })
    if (response.status === 401 || response.status === 403) return 'rejected'
    return response.status >= 500 || response.status === 429 ? 'unavailable' : 'ok'
  } catch {
    return 'unavailable'
  }
}
