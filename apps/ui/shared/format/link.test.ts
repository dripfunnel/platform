import { describe, expect, it } from 'vitest'
import { ticketError } from './link'

describe('ticketError', () => {
  it('accepts nothing or an https link, and refuses anything else', () => {
    expect(ticketError('')).toBe(false)
    expect(ticketError('https://support.dripfunnel.com/t/1')).toBe(false)
    expect(ticketError('http://support.dripfunnel.com/t/1')).toBe(true)
    expect(ticketError('javascript:alert(1)')).toBe(true)
    expect(ticketError('ticket 48213')).toBe(true)
  })
})
