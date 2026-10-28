import { describe, expect, it } from 'vitest'
import { isHttps, ticketError } from './link'

describe('ticketError', () => {
  it('accepts nothing or an https link, and refuses anything else', () => {
    expect(ticketError('')).toBe(false)
    expect(ticketError('https://support.dripfunnel.ai/t/1')).toBe(false)
    expect(ticketError('http://support.dripfunnel.ai/t/1')).toBe(true)
    expect(ticketError('javascript:alert(1)')).toBe(true)
    expect(ticketError('ticket 48213')).toBe(true)
  })
})

describe('isHttps', () => {
  it('accepts https only', () => {
    expect(isHttps('https://a.example/x')).toBe(true)
    for (const url of ['http://a.example', 'javascript:alert(1)', '//a.example', 'not a url', '']) expect(isHttps(url)).toBe(false)
  })
})
