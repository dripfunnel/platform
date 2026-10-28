import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { fetchStoreCountry } from './store'

describe("the store's country", () => {
  const answering = (answer: unknown): ApiClient => ({ request: async <T,>() => answer as T })

  it('is the country the store holds, for a wallet’s merchant country', async () => {
    expect(await fetchStoreCountry(answering({ store: { address: { country: 'US' } } }))).toBe('US')
  })

  it('is none when the store has no address, or a country that is not a two-letter code', async () => {
    expect(await fetchStoreCountry(answering({ store: { address: null } }))).toBeNull()
    expect(await fetchStoreCountry(answering({ store: { address: { country: 'United States' } } }))).toBeNull()
    expect(await fetchStoreCountry(answering({ store: null }))).toBeNull()
  })
})
