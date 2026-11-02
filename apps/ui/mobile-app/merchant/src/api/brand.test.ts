import { createApiClient } from '@dripfunnel/mobile-shared/graphql'
import { apiPath } from '../graphql'
import { fetchBrand } from './brand'

const brand = {
  productName: 'Acme',
  primaryColor: '#9A287C',
  accentColor: '#6AED50',
  font: null,
  corner: null,
  helpUrl: null,
  supportUrl: null,
  supportEmail: null,
  googleSignIn: true,
  files: { logoLight: null, logoDark: null, mark: null },
}

const clientAnswering = (data: unknown) => {
  const fetchImpl = jest.fn(() => Promise.resolve({ json: () => Promise.resolve({ data }) })) as unknown as jest.MockedFunction<typeof fetch>
  return { fetchImpl, client: createApiClient({ domain: 'store.example.com', path: apiPath, fetchImpl }) }
}

describe('reading the partner look before sign-in', () => {
  // A POST with no Origin and no bearer is refused with 403 "Bad origin" (ACCESS.md §4); a GET is not checked.
  it('asks with a GET that sends no body, no Origin and no credentials', async () => {
    const { fetchImpl, client } = clientAnswering({ brand })

    await expect(fetchBrand(client)).resolves.toEqual(brand)

    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url.startsWith('https://store.example.com/api/?query=')).toBe(true)
    expect(init.method).toBe('GET')
    expect(init.body).toBeUndefined()
    expect(Object.keys(init.headers ?? {})).toEqual([])
  })

  it('reads a look saved before Google sign-in as Google off', async () => {
    const earlier = Object.fromEntries(Object.entries(brand).filter(([name]) => name !== 'googleSignIn'))
    await expect(fetchBrand(clientAnswering({ brand: earlier }).client)).resolves.toEqual({ ...earlier, googleSignIn: false })
  })

  it('reads a partner with no look yet as null', async () => {
    await expect(fetchBrand(clientAnswering({ brand: null }).client)).resolves.toBeNull()
  })
})
