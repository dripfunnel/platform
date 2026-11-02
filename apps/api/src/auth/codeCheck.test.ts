import { describe, expect, it } from 'vitest'
import { codeMatches } from './codeCheck'

describe('codeMatches', () => {
  it('follows the comparison unless CODE_CHECK is 0', () => {
    for (const mode of [undefined, '1'] as const) for (const kind of ['email', 'text'] as const) expect([codeMatches(true, mode, kind), codeMatches(false, mode, kind)]).toEqual([true, false])
  })

  it('skips the comparison for a text code when CODE_CHECK is 0, never for an email code (#1002)', () => {
    expect([codeMatches(true, '0', 'text'), codeMatches(false, '0', 'text')]).toEqual([true, true])
    expect([codeMatches(true, '0', 'email'), codeMatches(false, '0', 'email')]).toEqual([true, false])
  })
})
