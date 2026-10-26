import AsyncStorage from '@react-native-async-storage/async-storage'
import { act, type ReactTestRenderer } from 'react-test-renderer'
import { TextInput } from 'react-native'
import { t } from '../../messages'
import { fakeShop, flush, hasText, press, render, type Request } from '../../testing/harness'
import { page, summary } from '../../testing/fixtures'
import { readRecentSearches } from './recentSearches'
import { SearchScreen } from './SearchScreen'
import { searchDebounceMs } from './useDebounced'

jest.setTimeout(120_000)

const mockPush = jest.fn()
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

const answer = ({ query, variables }: Request) => {
  if (query.includes('collections(')) return { collections: page([{ id: 'c1', slug: 'summer', name: 'Summer', description: null, image: null }]) }
  const words = String(variables?.query)
  return { search: words === 'zzz' ? page([]) : variables?.after === 'c2' ? page([summary('c')]) : page([summary('a'), summary('b')], variables?.first === 20 ? 'c2' : null) }
}

const searches = (requests: Request[]) => requests.filter((request) => request.query.includes('search('))

const typeInto = async (screen: ReactTestRenderer, text: string) => {
  await act(async () => screen.root.findByType(TextInput).props.onChangeText(text))
}

const advance = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms)
  })
  await flush()
}

beforeEach(async () => {
  jest.useFakeTimers()
  mockPush.mockClear()
  await AsyncStorage.clear()
})
afterEach(() => jest.useRealTimers())

describe('search', () => {
  it('asks the API only when the typing pauses, once for the words typed', async () => {
    const shop = fakeShop(answer)
    const screen = await render(<SearchScreen />, shop)
    await typeInto(screen, 't')
    await advance(searchDebounceMs - 100)
    await typeInto(screen, 'te')
    await advance(searchDebounceMs - 100)
    await typeInto(screen, 'tee')
    await advance(searchDebounceMs - 1)
    expect(searches(shop.requests)).toHaveLength(0)

    await advance(1)
    expect(searches(shop.requests)).toHaveLength(1)
    expect(searches(shop.requests)[0]?.variables).toMatchObject({ query: 'tee', first: 5 })
    expect(hasText(screen, 'Tee a')).toBe(true)
  })

  it('shows suggestions with a row that searches for everything, and results with Show more', async () => {
    const shop = fakeShop(answer)
    const screen = await render(<SearchScreen />, shop)
    await typeInto(screen, 'tee')
    await advance(searchDebounceMs)
    await press(screen, t('search.seeResults', { query: 'tee' }))
    expect(searches(shop.requests).at(-1)?.variables).toMatchObject({ query: 'tee', first: 20, after: null })

    await press(screen, t('states.showMore'))
    expect(searches(shop.requests).at(-1)?.variables).toMatchObject({ query: 'tee', after: 'c2' })
    expect(hasText(screen, 'Tee c')).toBe(true)
  })

  it('opens a product from a suggestion', async () => {
    const screen = await render(<SearchScreen />, fakeShop(answer))
    await typeInto(screen, 'tee')
    await advance(searchDebounceMs)
    await press(screen, 'Tee a, ₹1,499.00')
    expect(mockPush).toHaveBeenCalledWith('/product/tee-a')
  })

  it('keeps recent searches on the phone, newest first, offers them again, and clears them', async () => {
    const shop = fakeShop(answer)
    const screen = await render(<SearchScreen />, shop)
    await typeInto(screen, 'tee')
    await advance(searchDebounceMs)
    await press(screen, t('search.seeResults', { query: 'tee' }))
    await typeInto(screen, '')
    expect(hasText(screen, t('search.recent'))).toBe(true)
    expect(await readRecentSearches(shop.host)).toEqual(['tee'])
    expect(shop.requests.every((request) => !JSON.stringify(request.variables).includes('recent'))).toBe(true)

    await press(screen, 'tee')
    expect(searches(shop.requests).at(-1)?.variables).toMatchObject({ query: 'tee', first: 20 })

    await typeInto(screen, '')
    await press(screen, t('search.clearRecent'))
    expect(await readRecentSearches(shop.host)).toEqual([])
    expect(hasText(screen, t('search.recent'))).toBe(false)
  })

  it('says nothing matched, and offers the collections', async () => {
    const screen = await render(<SearchScreen />, fakeShop(answer))
    await typeInto(screen, 'zzz')
    await advance(searchDebounceMs)
    await press(screen, t('search.seeResults', { query: 'zzz' }))
    expect(hasText(screen, t('search.none.title', { query: 'zzz' }))).toBe(true)
    expect(hasText(screen, 'Summer')).toBe(true)
  })

  it('shows the collections before anything is typed', async () => {
    const screen = await render(<SearchScreen />, fakeShop(answer))
    expect(hasText(screen, t('search.browseCollections'))).toBe(true)
    expect(hasText(screen, 'Summer')).toBe(true)
  })
})
