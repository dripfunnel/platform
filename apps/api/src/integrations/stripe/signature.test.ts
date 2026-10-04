import { describe, expect, it } from 'vitest'
import { signPayload, verifySignature } from './signature'

const secret = 'whsec_test123'
const body = '{"id":"evt_1","type":"invoice.paid"}'
const at = new Date('2026-10-04T10:00:00Z')
const t = Math.floor(at.getTime() / 1000)

describe('Stripe webhook signature', () => {
  it('accepts the signature Stripe makes, and any one of several v1 values', async () => {
    const v1 = await signPayload(secret, t, body)
    expect(await verifySignature(body, `t=${t},v1=${v1}`, secret, at)).toBe(true)
    expect(await verifySignature(body, `t=${t},v1=${'0'.repeat(64)},v1=${v1}`, secret, at)).toBe(true)
  })

  it('refuses a changed body, another secret, an old timestamp and a missing header', async () => {
    const v1 = await signPayload(secret, t, body)
    expect(await verifySignature(body.replace('paid', 'voided'), `t=${t},v1=${v1}`, secret, at)).toBe(false)
    expect(await verifySignature(body, `t=${t},v1=${v1}`, 'whsec_other', at)).toBe(false)
    expect(await verifySignature(body, `t=${t},v1=${v1}`, secret, new Date(at.getTime() + 301_000))).toBe(false)
    expect(await verifySignature(body, null, secret, at)).toBe(false)
    expect(await verifySignature(body, `v1=${v1}`, secret, at)).toBe(false)
  })
})
