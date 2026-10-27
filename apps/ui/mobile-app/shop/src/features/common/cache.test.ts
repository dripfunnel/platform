import AsyncStorage from '@react-native-async-storage/async-storage'
import { maxEntriesPerGroup, readCached, saveCached } from './cache'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const host = 'acme.my-store.one'

beforeEach(() => AsyncStorage.clear())

describe('the offline cache', () => {
  it('serves what was saved to the same request only', async () => {
    await saveCached(host, 'home', '{}', { a: 1 })
    await expect(readCached(host, 'home', '{}')).resolves.toEqual({ a: 1 })
    await expect(readCached(host, 'home', '{"x":1}')).resolves.toBeUndefined()
    await expect(readCached('other.my-store.one', 'home', '{}')).resolves.toBeUndefined()
  })

  it('keeps only the most recent product pages, so opening many products cannot fill the storage', async () => {
    for (let i = 0; i < maxEntriesPerGroup + 5; i += 1) await saveCached(host, `product:p${i}`, '{}', { i })
    await expect(readCached(host, 'product:p0', '{}')).resolves.toBeUndefined()
    await expect(readCached(host, 'product:p4', '{}')).resolves.toBeUndefined()
    await expect(readCached(host, 'product:p5', '{}')).resolves.toEqual({ i: 5 })
    await expect(readCached(host, `product:p${maxEntriesPerGroup + 4}`, '{}')).resolves.toEqual({ i: maxEntriesPerGroup + 4 })
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.includes('product:'))
    expect(keys).toHaveLength(maxEntriesPerGroup)
  })

  it('counts a product opened again as the newest, not as a second entry', async () => {
    for (let i = 0; i < maxEntriesPerGroup; i += 1) await saveCached(host, `product:p${i}`, '{}', { i })
    await saveCached(host, 'product:p0', '{}', { i: 'again' })
    await saveCached(host, 'product:new', '{}', { i: 'new' })
    await expect(readCached(host, 'product:p0', '{}')).resolves.toEqual({ i: 'again' })
    await expect(readCached(host, 'product:p1', '{}')).resolves.toBeUndefined()
  })

  it('never evicts Home or the collections for the sake of product pages, and keeps each kind apart', async () => {
    await saveCached(host, 'home', '{}', { home: true })
    await saveCached(host, 'collections', '{}', { collections: true })
    await saveCached(host, 'products:summer', '{}', { summer: true })
    for (let i = 0; i < maxEntriesPerGroup + 5; i += 1) await saveCached(host, `product:p${i}`, '{}', { i })
    await expect(readCached(host, 'home', '{}')).resolves.toEqual({ home: true })
    await expect(readCached(host, 'collections', '{}')).resolves.toEqual({ collections: true })
    await expect(readCached(host, 'products:summer', '{}')).resolves.toEqual({ summer: true })
  })

  it('does not fail the screen when the storage refuses to save', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('full'))
    await expect(saveCached(host, 'product:p1', '{}', { i: 1 })).resolves.toBeUndefined()
  })
})
