import { photoSource } from './RiderCard'

const headers = { 'x-shop-cart': 'order-token' }
const host = 'acme.my-store.one'

describe('the rider’s photo', () => {
  it('is loaded from the store’s own host with the order’s credentials, for the address the API gives', () => {
    expect(photoSource('/shop-api/assets/rider-1', host, headers)).toEqual({ uri: 'https://acme.my-store.one/shop-api/assets/rider-1', headers })
    expect(photoSource('https://acme.my-store.one/shop-api/assets/rider-1', host, headers)).toEqual({ uri: 'https://acme.my-store.one/shop-api/assets/rider-1', headers })
  })

  it('never carries the order’s credentials to another host, or another scheme or port of this one', () => {
    for (const elsewhere of ['https://evil.example/photo.png', 'http://acme.my-store.one/photo.png', 'https://acme.my-store.one:8443/photo.png', '//evil.example/photo.png']) {
      const source = photoSource(elsewhere, host, headers)
      expect(source).not.toBeNull()
      expect(source).not.toHaveProperty('headers')
    }
  })

  it('is none when the API gives none, or an address that is not a URL', () => {
    expect(photoSource(null, host, headers)).toBeNull()
    expect(photoSource('http://', host, headers)).toBeNull()
  })
})
