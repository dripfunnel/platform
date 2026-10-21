import { describe, expect, it } from 'vitest'
import { hexColour, socialLink } from './rules'

describe('socialLink', () => {
  it('turns each network’s handle into its profile address', () => {
    expect(socialLink('instagram', '@juniper.linen')).toBe('https://www.instagram.com/juniper.linen')
    expect(socialLink('x', 'juniper_shop')).toBe('https://x.com/juniper_shop')
    expect(socialLink('youtube', '@juniper')).toBe('https://www.youtube.com/@juniper')
    expect(socialLink('tiktok', 'juniper.linen')).toBe('https://www.tiktok.com/@juniper.linen')
    expect(socialLink('facebook', 'juniperlinen')).toBe('https://www.facebook.com/juniperlinen')
    expect(socialLink('whatsapp', '+91 (98765) 43210')).toBe('https://wa.me/919876543210')
  })

  it('keeps an https address on the network’s own host or a subdomain of it, without its fragment', () => {
    expect(socialLink('instagram', 'https://instagram.com/juniper#top')).toBe('https://instagram.com/juniper')
    expect(socialLink('facebook', 'm.facebook.com/juniper')).toBe('https://m.facebook.com/juniper')
    expect(socialLink('youtube', 'https://youtu.be/abc')).toBe('https://youtu.be/abc')
  })

  it('refuses another host, plain http, credentials, a port, a bare host and other schemes', () => {
    for (const [network, value] of [
      ['instagram', 'https://evil.example/juniper'],
      ['instagram', 'https://instagram.com.evil.example/juniper'],
      ['facebook', 'http://facebook.com/juniper'],
      ['x', 'https://user:pw@x.com/juniper'],
      ['x', 'https://x.com:8443/juniper'],
      ['tiktok', 'https://www.tiktok.com/'],
      ['youtube', 'javascript:alert(1)'],
      ['whatsapp', 'call me'],
      ['instagram', `@${'a'.repeat(31)}`],
    ] as const) {
      expect({ [value]: socialLink(network, value) }).toEqual({ [value]: null })
    }
  })
})

describe('hexColour', () => {
  it('takes #rgb or #rrggbb with or without the hash, lowercased', () => {
    expect([hexColour('#1F4E3D'), hexColour('fa0'), hexColour(' #ABC ')]).toEqual(['#1f4e3d', '#ffaa00', '#aabbcc'])
    expect([hexColour('red'), hexColour('#12345'), hexColour('rgb(0,0,0)')]).toEqual([null, null, null])
  })
})
