import { describe, expect, it } from 'vitest'
import { isUuid } from './ids'

describe('isUuid', () => {
  it('takes a uuid in either case and nothing shaped like one', () => {
    expect(isUuid('00000000-0000-4000-8000-0000000000aa')).toBe(true)
    expect(isUuid('00000000-0000-4000-8000-0000000000AA')).toBe(true)
    expect(isUuid('-'.repeat(36))).toBe(false)
    expect(isUuid('00000000-0000-4000-8000-0000000000aa ')).toBe(false)
    expect(isUuid('')).toBe(false)
  })
})
