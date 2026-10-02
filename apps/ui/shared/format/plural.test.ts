import { describe, expect, it } from 'vitest'
import { pluralForm } from './plural'

describe('pluralForm', () => {
  it('picks one and other in English, and falls back to other', () => {
    const forms = { one: '{count} day left', other: '{count} days left' }
    expect(pluralForm('en', forms, 1)).toBe('{count} day left')
    expect(pluralForm('en', forms, 0)).toBe('{count} days left')
    expect(pluralForm('en', { other: 'days' }, 1)).toBe('days')
  })
})
