import { describe, expect, it } from 'vitest'
import { refusalOn } from './pageRefusal'

const refusal = { text: 'Arjun Menon is the only Super admin. Make someone else a Super admin first.', search: '' }

describe('refusalOn', () => {
  it('keeps the refusal on the page it answered, through the reload after the change', () => {
    expect(refusalOn(refusal, '')).toBe(refusal.text)
  })

  it('drops it once the list is paged elsewhere, so it never sits above rows it does not describe', () => {
    expect(refusalOn(refusal, '?after=st-neha')).toBeNull()
    expect(refusalOn({ ...refusal, search: '?after=st-neha' }, '?before=st-priya')).toBeNull()
  })

  it('shows nothing without a refusal', () => {
    expect(refusalOn(null, '')).toBeNull()
  })
})
