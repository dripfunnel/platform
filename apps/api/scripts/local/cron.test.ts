import { describe, expect, it } from 'vitest'
import { cronDue, wranglerCrons } from './cron'

describe('the local cron launcher', () => {
  it('reads the four cadences from wrangler.jsonc', () => {
    expect(wranglerCrons()).toEqual(['* * * * *', '*/5 * * * *', '0 * * * *', '0 3 * * *'])
  })

  it('fires each expression only in the minutes Cloudflare would, in UTC', () => {
    const due = (iso: string) => wranglerCrons().filter((cron) => cronDue(cron, new Date(iso)))
    expect(due('2026-10-11T10:07:00Z')).toEqual(['* * * * *'])
    expect(due('2026-10-11T10:05:00Z')).toEqual(['* * * * *', '*/5 * * * *'])
    expect(due('2026-10-11T10:00:00Z')).toEqual(['* * * * *', '*/5 * * * *', '0 * * * *'])
    expect(due('2026-10-11T03:00:00Z')).toEqual(['* * * * *', '*/5 * * * *', '0 * * * *', '0 3 * * *'])
  })

  it('refuses a form it cannot read rather than never firing it', () => {
    expect(() => cronDue('0 9 * * 1-5', new Date())).toThrow(/can't read "1-5"/)
  })
})
