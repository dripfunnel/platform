import { describe, expect, it } from 'vitest'
import { en } from './messages'

describe('money in an email', () => {
  it('formats the exact amount in the store’s language, past what a float holds and in a 3-decimal currency', () => {
    expect(en.money('en-IN', '205000', 'INR')).toBe('₹2,050.00')
    expect(en.money('en-IN', '9007199254740993', 'INR')).toBe('₹9,00,71,99,25,47,409.93')
    expect(en.money('en-US', '9007199254740993', 'KWD').replace('\u00a0', ' ')).toBe('KWD 9,007,199,254,740.993')
  })
})
