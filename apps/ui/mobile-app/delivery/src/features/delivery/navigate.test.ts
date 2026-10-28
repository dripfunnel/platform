import { mapUrl } from './navigate'

const pin = { latitude: 12.9716, longitude: 77.5946 }

describe('mapUrl', () => {
  it('opens Apple Maps on iOS, with the pin and the place’s name', () => {
    expect(mapUrl('ios', pin, 'Pune godown')).toBe('http://maps.apple.com/?daddr=12.9716,77.5946&q=Pune%20godown')
  })

  it('gives Android a geo link, so Google Maps or any map app takes it', () => {
    expect(mapUrl('android', pin, 'Pune godown')).toBe('geo:12.9716,77.5946?q=12.9716,77.5946(Pune%20godown)')
  })

  it('encodes a name that would break the link, and drops the brackets a geo link can’t carry', () => {
    expect(mapUrl('android', pin, 'A&B (rear)')).toContain('(A%26B%20rear)')
  })
})
