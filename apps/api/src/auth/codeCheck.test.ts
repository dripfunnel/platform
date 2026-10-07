import { afterEach, describe, expect, it } from 'vitest'
import { codeMatches, setCodeCheck } from './codeCheck'

describe('codeMatches', () => {
  afterEach(() => setCodeCheck(undefined))

  it('follows the comparison unless CODE_CHECK is 0', () => {
    expect([codeMatches(true), codeMatches(false)]).toEqual([true, false])
    setCodeCheck('1')
    expect(codeMatches(false)).toBe(false)
    setCodeCheck('0')
    expect([codeMatches(true), codeMatches(false)]).toEqual([true, true])
  })
})
