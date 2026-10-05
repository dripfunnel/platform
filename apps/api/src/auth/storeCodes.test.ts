import { describe, expect, it } from 'vitest'
import { hashBackupCode, newBackupCodes } from './storeCodes'

describe('backup codes', () => {
  it('hashes the same code differently for two people, and alike however it is typed', async () => {
    const [code = ''] = newBackupCodes()
    const a = await hashBackupCode('11111111-1111-4111-8111-111111111111', code)
    expect(await hashBackupCode('22222222-2222-4222-8222-222222222222', code)).not.toBe(a)
    expect(await hashBackupCode('11111111-1111-4111-8111-111111111111', ` ${code.toUpperCase()} `)).toBe(a)
  })

  it('gives ten distinct codes in the xxxx-xxxx shape', () => {
    const codes = newBackupCodes()
    expect(new Set(codes).size).toBe(10)
    expect(codes.every((c) => /^[a-z2-9]{4}-[a-z2-9]{4}$/.test(c))).toBe(true)
  })
})
