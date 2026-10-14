import type { ApiClient } from '../graphql'
import { loadStoreState, loadTheme } from './shell'

const answering = (answer: unknown): ApiClient => ({ request: <T,>() => Promise.resolve(answer as T) })

describe('reading what the API may leave null', () => {
  it('reads a store state whose read-only flag is null, as a store that can be written to', async () => {
    const state = await loadStoreState(answering({ storeState: { readOnly: null, status: 'active', trialEndsAt: null, pastDueSince: null, provisioning: null, support: null } }))
    expect(state).toMatchObject({ readOnly: false, status: 'active' })
  })

  it('reads a store with no state at all as null, and a view-only one as view-only', async () => {
    expect(await loadStoreState(answering({ storeState: null }))).toBeNull()
    expect(await loadStoreState(answering({ storeState: { readOnly: true, status: 'past_due', trialEndsAt: null, pastDueSince: null, provisioning: null, support: null } }))).toMatchObject({ readOnly: true })
  })

  it('draws light for a person with no profile, and dark only for a saved dark', async () => {
    expect(await loadTheme(answering({ profile: null }))).toBe('light')
    expect(await loadTheme(answering({ profile: { theme: null } }))).toBe('light')
    expect(await loadTheme(answering({ profile: { theme: 'dark' } }))).toBe('dark')
  })
})
