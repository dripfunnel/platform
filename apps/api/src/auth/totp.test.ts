import { describe, expect, it } from 'vitest'
import { checkCode, codeAt, newTotpSecret, stepAt } from './totp'

// RFC 6238 appendix B, SHA-1 column: the secret is ASCII "12345678901234567890" in base32.
const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', async () => {
    expect(await codeAt(rfcSecret, Math.floor(59 / 30))).toBe('287082')
    expect(await codeAt(rfcSecret, Math.floor(1111111109 / 30))).toBe('081804')
    expect(await codeAt(rfcSecret, Math.floor(2000000000 / 30))).toBe('279037')
  })

  it('accepts the current code and one step of drift, calls an older or reused one expired, anything else wrong', async () => {
    const secret = newTotpSecret()
    const now = new Date('2026-10-03T09:00:10Z')
    const step = stepAt(now)
    expect(await checkCode(secret, await codeAt(secret, step), now, null)).toEqual({ ok: true, step })
    expect(await checkCode(secret, await codeAt(secret, step - 1), now, null)).toEqual({ ok: true, step: step - 1 })
    expect(await checkCode(secret, await codeAt(secret, step - 4), now, null)).toEqual({ ok: false, code: 'CODE_EXPIRED' })
    expect(await checkCode(secret, await codeAt(secret, step), now, step)).toEqual({ ok: false, code: 'CODE_EXPIRED' })
    expect(await checkCode(secret, 'abcdef', now, null)).toEqual({ ok: false, code: 'WRONG_CODE' })
  })
})
