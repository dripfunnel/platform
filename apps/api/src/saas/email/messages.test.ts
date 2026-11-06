import { describe, expect, it } from 'vitest'
import { supportExtensionMs, supportSessionMs } from '#saas/support/index'
import { en } from './messages'

describe('money in an email', () => {
  it('formats the exact amount in the store’s language, past what a float holds and in a 3-decimal currency', () => {
    expect(en.money('en-IN', '205000', 'INR')).toBe('₹2,050.00')
    expect(en.money('en-IN', '9007199254740993', 'INR')).toBe('₹9,00,71,99,25,47,409.93')
    expect(en.money('en-US', '9007199254740993', 'KWD').replace('\u00a0', ' ')).toBe('KWD 9,007,199,254,740.993')
  })
})

describe('the support-opened email', () => {
  it('says how long the session lasts and that it can be extended once, from the session’s own length (ACCESS.md §8)', () => {
    const body = en.supportStarted.body('Priya', 'Northstar', 'Kesari Threads', 'Jenna', supportSessionMs / 60_000, supportExtensionMs / 60_000)
    expect(body).toContain('It ends after 90 minutes, or 30 more if they extend it once')
  })
})
