import { describe, expect, it } from 'vitest'
import { deviceOf } from './userAgent'

describe('deviceOf', () => {
  it('names the browser and the system, and nothing it can’t tell', () => {
    expect(deviceOf('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36')).toBe('Chrome on Windows')
    expect(deviceOf('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBe('Safari on iOS')
    expect(deviceOf('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0')).toBe('Edge on macOS')
    expect(deviceOf('curl/8.4.0')).toBeNull()
    expect(deviceOf(null)).toBeNull()
  })
})
