import { describe, expect, it } from 'vitest'
import { composeSms, providerFor, smsPayloadSchema, type SmsPayload } from './index'

const code = (message: SmsPayload['message'] = 'code.second_factor'): SmsPayload => ({ message, to: '+919845022113', brand: 'Kesari Threads', vars: { code: '482913' }, expiresAt: '2026-10-05T09:10:00.000Z' })

describe('the SMS catalogue', () => {
  it('fills the text and, for India, the DLT variables in the registered order', () => {
    expect(composeSms(code(), 'tmpl-2fa')).toEqual({
      to: '+919845022113',
      text: 'Kesari Threads: 482913 is your sign-in code. It works for 10 minutes. Never share it.',
      dlt: { templateId: 'tmpl-2fa', vars: ['Kesari Threads', '482913'] },
    })
    const shipped: SmsPayload = { message: 'order.shipped', to: '+16145550199', brand: 'Juniper & Co.', vars: { order: 'JC-1042', courier: 'USPS', link: 'https://juniperandco.com/t/abc' }, expiresAt: null }
    expect(composeSms(shipped, null)).toEqual({ to: '+16145550199', text: 'Juniper & Co.: order JC-1042 is on its way with USPS. Track it: https://juniperandco.com/t/abc', dlt: null })
  })

  it('accepts only its own messages, an E.164 number and each message’s variables', () => {
    expect(smsPayloadSchema.safeParse(code()).success).toBe(true)
    expect(smsPayloadSchema.safeParse({ ...code(), to: '09845022113' }).success).toBe(false)
    expect(smsPayloadSchema.safeParse({ ...code(), vars: { code: '12ab56' } }).success).toBe(false)
    expect(smsPayloadSchema.safeParse({ ...code(), vars: { code: '482913', extra: 'hi' } }).success).toBe(false)
    expect(smsPayloadSchema.safeParse({ ...code(), message: 'marketing.blast' }).success).toBe(false)
    expect(smsPayloadSchema.safeParse({ ...code(), text: 'free text' }).success).toBe(false)
    expect(smsPayloadSchema.safeParse({ ...code(), expiresAt: null }).success).toBe(false)
    expect(smsPayloadSchema.safeParse({ ...code('code.verify_phone'), expiresAt: null }).success).toBe(false)
  })

  it('sends Indian numbers through MSG91 and the rest through Twilio', () => {
    expect(providerFor('+919845022113')).toBe('msg91')
    expect(providerFor('+16145550199')).toBe('twilio')
    expect(providerFor('+447700900123')).toBe('twilio')
  })
})
