import AsyncStorage from '@react-native-async-storage/async-storage'
import { addRecentSearch, clearRecentSearches, maxRecentSearches, readRecentSearches } from './recentSearches'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const host = 'acme.my-store.one'

beforeEach(() => AsyncStorage.clear())

describe('recent searches', () => {
  it('are none before the first search, and none when what was saved is not a list of words', async () => {
    await expect(readRecentSearches(host)).resolves.toEqual([])
    await AsyncStorage.setItem(`df.recentSearches.${host}`, '{"not":"a list"}')
    await expect(readRecentSearches(host)).resolves.toEqual([])
    await AsyncStorage.setItem(`df.recentSearches.${host}`, 'not json')
    await expect(readRecentSearches(host)).resolves.toEqual([])
  })

  it('put the newest first, and move a repeat up instead of listing it twice', async () => {
    await addRecentSearch(host, 'tee')
    await addRecentSearch(host, 'shirt')
    await expect(addRecentSearch(host, '  TEE ')).resolves.toEqual(['TEE', 'shirt'])
  })

  it('keep no blank search, and only the most recent few', async () => {
    await addRecentSearch(host, '   ')
    await expect(readRecentSearches(host)).resolves.toEqual([])
    for (let i = 0; i < maxRecentSearches + 3; i += 1) await addRecentSearch(host, `search ${i}`)
    const kept = await readRecentSearches(host)
    expect(kept).toHaveLength(maxRecentSearches)
    expect(kept[0]).toBe(`search ${maxRecentSearches + 2}`)
  })

  it("belong to one store's host, and clear", async () => {
    await addRecentSearch(host, 'tee')
    await expect(readRecentSearches('other.my-store.one')).resolves.toEqual([])
    await clearRecentSearches(host)
    await expect(readRecentSearches(host)).resolves.toEqual([])
  })

  it('stay on the phone: they are written only to its own storage', async () => {
    const fetchSpy = jest.fn()
    const original = global.fetch
    global.fetch = fetchSpy as unknown as typeof fetch
    try {
      await addRecentSearch(host, 'tee')
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      global.fetch = original
    }
  })
})
