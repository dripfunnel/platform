import { describe, expect, it } from 'vitest'
import { codeMatches } from './codeCheck'

describe('codeMatches', () => {
  it('follows the comparison unless CODE_CHECK is 0', () => {
    for (const mode of [undefined, '1'] as const) expect([codeMatches(true, mode), codeMatches(false, mode)]).toEqual([true, false])
    expect([codeMatches(true, '0'), codeMatches(false, '0')]).toEqual([true, true])
  })
})
