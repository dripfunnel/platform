import AsyncStorage from '@react-native-async-storage/async-storage'
import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { fakeShop, hasText, press, render, type Request } from '../../testing/harness'
import { page, summary } from '../../testing/fixtures'
import { CollectionScreen } from './CollectionScreen'

jest.setTimeout(120_000)

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), back: jest.fn(), canGoBack: () => true, replace: jest.fn() }) }))
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }))

const facets = [{ id: 'f-colour', name: 'Colour', values: [{ id: 'v-sand', name: 'Sand', count: 4 }, { id: 'v-black', name: 'Black', count: 2 }] }]

const catalogue = ({ variables }: Request) => {
  const after = variables?.after
  const list = after === 'c2' ? page([summary('c')]) : page([summary('a'), summary('b')], 'c2', { facets })
  return { collection: { name: 'Summer', description: 'Light things' }, products: list }
}

const lastProductsRequest = (requests: Request[]) => requests.filter((r) => r.query.includes('products(')).at(-1)

beforeEach(() => AsyncStorage.clear())

describe('a collection', () => {
  it("shows its name, its words and its products, and pages with Show more", async () => {
    const shop = fakeShop(catalogue)
    const screen = await render(<CollectionScreen slug="summer" />, shop)
    expect(hasText(screen, 'Summer')).toBe(true)
    expect(hasText(screen, 'Light things')).toBe(true)
    expect(hasText(screen, 'Tee a')).toBe(true)
    expect(hasText(screen, 'Tee c')).toBe(false)

    await press(screen, t('states.showMore'))
    expect(lastProductsRequest(shop.requests)?.variables).toMatchObject({ collection: 'summer', after: 'c2' })
    expect(hasText(screen, 'Tee c')).toBe(true)
    expect(hasText(screen, t('states.showMore'))).toBe(false)
  })

  it('sorts as the API sorts, starting again from the first page', async () => {
    const shop = fakeShop(catalogue)
    const screen = await render(<CollectionScreen slug="summer" />, shop)
    await press(screen, t('collection.sort', { sort: t('collection.sorts.featured') }))
    await press(screen, t('collection.sorts.priceLow'))
    expect(lastProductsRequest(shop.requests)?.variables).toMatchObject({ sort: 'PRICE_LOW', after: null })
    expect(hasText(screen, t('collection.sort', { sort: t('collection.sorts.priceLow') }))).toBe(true)
  })

  it("filters by the store's own filters, shows what is on, and clears it", async () => {
    const shop = fakeShop(catalogue)
    const screen = await render(<CollectionScreen slug="summer" />, shop)
    await press(screen, t('collection.filters'))
    await press(screen, 'Sand, 4')
    await press(screen, t('collection.showProducts'))
    expect(lastProductsRequest(shop.requests)?.variables).toMatchObject({ filters: ['v-sand'] })
    expect(hasText(screen, t('collection.filtersCount', { count: 1 }))).toBe(true)
    expect(hasText(screen, t('collection.removeFilter', { label: 'Colour: Sand' }))).toBe(true)

    await press(screen, t('collection.clearAll'))
    expect(lastProductsRequest(shop.requests)?.variables).toMatchObject({ filters: null })
  })

  it('says when nothing matches the filters, and offers to clear them', async () => {
    const shop = fakeShop(({ variables }) => (variables?.filters ? { collection: { name: 'Summer', description: null }, products: page([]) } : catalogue({ query: '', variables })))
    const screen = await render(<CollectionScreen slug="summer" />, shop)
    await press(screen, t('collection.filters'))
    await press(screen, 'Black, 2')
    await press(screen, t('collection.showProducts'))
    expect(hasText(screen, t('collection.none.title'))).toBe(true)
    await press(screen, t('collection.clearFilters'))
    expect(hasText(screen, 'Tee a')).toBe(true)
  })

  it('says a collection that is not there is not found', async () => {
    const screen = await render(<CollectionScreen slug="gone" />, fakeShop(() => ({ collection: null, products: page([]) })))
    expect(hasText(screen, t('collection.notFound.title'))).toBe(true)
  })

  it('has an empty state for a collection with no products', async () => {
    const screen = await render(<CollectionScreen slug="summer" />, fakeShop(() => ({ collection: { name: 'Summer', description: null }, products: page([]) })))
    expect(hasText(screen, t('collection.empty.title'))).toBe(true)
  })

  it('shows everything the store sells when it has no collection', async () => {
    const shop = fakeShop(({ variables }) => ({ products: variables?.after ? page([]) : page([summary('a')]) }))
    const screen = await render(<CollectionScreen slug={null} />, shop)
    expect(hasText(screen, t('collection.all'))).toBe(true)
    expect(lastProductsRequest(shop.requests)?.variables).toMatchObject({ collection: null })
    expect(hasText(screen, 'Tee a')).toBe(true)
  })

  it('keeps what it loaded when "Show more" fails, says so, and tries again', async () => {
    let fail = true
    const screen = await render(
      <CollectionScreen slug="summer" />,
      fakeShop((request) => {
        if (request.variables?.after === 'c2' && fail) throw new ApiError('NO_RESPONSE', 'x')
        return catalogue(request)
      }),
    )
    await press(screen, t('states.showMore'))
    expect(hasText(screen, t('states.moreOffline'))).toBe(true)
    expect(hasText(screen, 'Tee a')).toBe(true)
    fail = false
    await press(screen, t('states.retry'))
    expect(hasText(screen, 'Tee c')).toBe(true)
  })

  it('shows the last page it loaded under an offline banner when there is no connection', async () => {
    await render(<CollectionScreen slug="summer" />, fakeShop(catalogue))
    const offline = await render(<CollectionScreen slug="summer" />, fakeShop(() => { throw new ApiError('NO_RESPONSE', 'x') }))
    expect(hasText(offline, t('states.offline.banner'))).toBe(true)
    expect(hasText(offline, 'Tee a')).toBe(true)
  })
})
