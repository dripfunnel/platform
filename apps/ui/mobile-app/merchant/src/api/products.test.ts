import { assetSource } from './products'

const deps = { domain: 'shop.test', headers: () => ({ authorization: 'Bearer secret', 'x-store': 'store-1' }) }

describe('assetSource', () => {
  it('reads a stored path from the portal host with the session’s headers', () => {
    expect(assetSource(deps, '/api/assets/a-1')).toEqual({ uri: 'https://shop.test/api/assets/a-1', headers: { authorization: 'Bearer secret', 'x-store': 'store-1' } })
  })

  it('sends the headers to an absolute address only on the portal’s own host', () => {
    expect(assetSource(deps, 'https://shop.test/api/assets/a-1').headers).toBeDefined()
    expect(assetSource(deps, 'https://cdn.example.net/x.jpg')).toEqual({ uri: 'https://cdn.example.net/x.jpg' })
    expect(assetSource(deps, 'https://shop.test.evil.example/x.jpg')).toEqual({ uri: 'https://shop.test.evil.example/x.jpg' })
  })
})

describe('assetSource over plain http', () => {
  it('never sends the headers over http, even to the portal’s own host', () => {
    expect(assetSource(deps, 'http://shop.test/api/assets/a-1')).toEqual({ uri: 'http://shop.test/api/assets/a-1' })
  })

  it('reads a path that merely starts with "http" as a path on the portal', () => {
    expect(assetSource(deps, 'httpx/a.jpg').uri).toBe('https://shop.testhttpx/a.jpg')
  })
})
