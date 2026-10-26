import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { inr, page, productAnswer, summary, tee } from '../testing/fixtures'
import { addToCart, collectionsOperation, homeOperation, productOperation, productsOperation, productsPerPage, searchOperation } from './catalogue'

describe('the product read', () => {
  it("keeps the API's prices and tax setting as sent, and turns versions' choices into a lookup", () => {
    const product = productOperation('tee-p1').parse(productAnswer(tee(), true))
    expect(product).toMatchObject({ name: 'Linen Tee', pricesIncludeTax: true, price: inr('149900'), fromPrice: true })
    expect(product?.versions[2]).toMatchObject({ id: 'ver-black-l', price: inr('169900'), compareAt: inr('199900'), choices: { 'o-colour': 'v-black', 'o-size': 'v-l' } })
  })

  it('says the prices exclude tax when the store says so, and when it says nothing', () => {
    expect(productOperation('x').parse(productAnswer(tee(), false))?.pricesIncludeTax).toBe(false)
    expect(productOperation('x').parse({ store: null, product: tee() })?.pricesIncludeTax).toBe(false)
  })

  it('is no product when the API has none, and a bad answer when its shape drifts', () => {
    expect(productOperation('gone').parse(productAnswer(null))).toBeNull()
    expect(() => productOperation('x').parse(productAnswer(tee({ name: null })))).toThrow(ApiError)
  })

  it('drops a photo with no file, and a single-priced product is not "from"', () => {
    const product = productOperation('x').parse(productAnswer(tee({ maxPrice: inr('149900'), photos: [{ alt: null, versionId: null, image: { url: null } }] })))
    expect(product?.photos).toEqual([])
    expect(product?.fromPrice).toBe(false)
  })

  it("is kept for offline under the product's own slot, never under a request with other words", () => {
    const operation = productOperation('tee-p1')
    expect(operation.slot).toBe('product:tee-p1')
    expect(operation.variables).toEqual({ slug: 'tee-p1' })
  })
})

describe('the product lists', () => {
  it("send no filter list when none is chosen, and key the first page's offline slot by collection", () => {
    const first = productsOperation({ collection: 'summer', filters: [], sort: null, after: null })
    expect(first.variables).toEqual({ collection: 'summer', filters: null, sort: null, after: null, first: productsPerPage })
    expect(first.slot).toBe('products:summer')
    expect(first.query).toContain('facets')
    expect(first.query).toContain('collection(slug: $collection)')
  })

  it('send the chosen filters and sort, and keep no later page for offline', () => {
    const next = productsOperation({ collection: null, filters: ['f1', 'f2'], sort: 'PRICE_LOW', after: 'c9' })
    expect(next.variables).toMatchObject({ filters: ['f1', 'f2'], sort: 'PRICE_LOW', after: 'c9' })
    expect(next.slot).toBeNull()
    expect(next.query).not.toContain('facets')
  })

  it('read the cards, the "from" price, the facets, the collection and the next cursor', () => {
    const operation = productsOperation({ collection: 'summer', filters: [], sort: null, after: null })
    const result = operation.parse({
      collection: { name: 'Summer', description: 'Light things' },
      products: page([summary('a', { maxPrice: inr('199900'), badges: [{ label: 'New', tone: 'info' }] }), summary('b', { inStock: false })], 'c2', { facets: [{ id: 'f', name: 'Colour', values: [{ id: 'v', name: 'Sand', count: 3 }] }] }),
    })
    expect(result.items.map((p) => [p.id, p.fromPrice, p.inStock, p.badge])).toEqual([['a', true, true, 'New'], ['b', false, false, null]])
    expect(result.next).toBe('c2')
    expect(result.collection).toEqual({ name: 'Summer', description: 'Light things' })
    expect(result.facets).toEqual([{ id: 'f', name: 'Colour', values: [{ id: 'v', name: 'Sand', count: 3 }] }])
  })

  it('end when the API says there is no next page', () => {
    expect(productsOperation({ collection: null, filters: [], sort: null, after: null }).parse({ products: page([summary('a')]) }).next).toBeNull()
  })
})

describe('home, collections and search', () => {
  it('reads the collections and the newest products', () => {
    const home = homeOperation().parse({
      collections: page([{ id: 'c1', slug: 'summer', name: 'Summer', description: null, image: { url: 'https://cdn.example/c1.jpg' } }]),
      products: page([summary('a')]),
    })
    expect(home.collections).toEqual([{ id: 'c1', slug: 'summer', name: 'Summer', description: null, imageUrl: 'https://cdn.example/c1.jpg' }])
    expect(home.products).toHaveLength(1)
  })

  it('keeps only the first page of collections for offline', () => {
    expect(collectionsOperation(null).slot).toBe('collections')
    expect(collectionsOperation('c1').slot).toBeNull()
  })

  it('never keeps a search for offline, and asks for as many as the screen shows', () => {
    const operation = searchOperation('tee', null, 5)
    expect(operation.slot).toBeNull()
    expect(operation.variables).toEqual({ query: 'tee', after: null, first: 5 })
  })
})

describe('add to cart', () => {
  it("sends the version and quantity and answers a guest's cart token", async () => {
    const request = jest.fn().mockResolvedValue({ addToCart: { cartToken: 'tok' } })
    await expect(addToCart({ request }, 'ver-1', 2)).resolves.toBe('tok')
    expect(request).toHaveBeenCalledWith(expect.stringContaining('addToCart(versionId: $versionId, quantity: $quantity)'), { versionId: 'ver-1', quantity: 2 })
  })

  it('answers no token for a signed-in shopper', async () => {
    await expect(addToCart({ request: jest.fn().mockResolvedValue({ addToCart: { cartToken: null } }) }, 'ver-1', 1)).resolves.toBeNull()
  })
})
