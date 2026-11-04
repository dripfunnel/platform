import { ApiError } from '@dripfunnel/mobile-shared/graphql'
import { addToWishlist, removeFromWishlist, wishlistIdsOperation, wishlistOperation } from './wishlist'

const client = (answer: () => unknown) => {
  const calls: { query: string; variables: unknown }[] = []
  return { calls, request: async <T,>(query: string, variables?: unknown): Promise<T> => (calls.push({ query, variables }), answer() as T) }
}

describe('the wishlist reads', () => {
  it('are never kept on the phone for offline: the list is the shopper’s own', () => {
    expect(wishlistOperation().slot).toBeNull()
    expect(wishlistIdsOperation().slot).toBeNull()
  })

  it('read each product as a card, with its price, photo and stock as the API gives them', () => {
    const items = wishlistOperation().parse({
      wishlist: [{ id: 'p1', slug: 'tee', name: 'Tee', inStock: false, price: { amount: '149900', currency: 'INR' }, compareAt: null, maxPrice: { amount: '169900', currency: 'INR' }, photo: { alt: null, image: { url: 'https://cdn.example/p1.jpg' } }, badges: [] }],
    })
    expect(items).toEqual([
      { id: 'p1', slug: 'tee', name: 'Tee', inStock: false, price: { amount: '149900', currency: 'INR' }, compareAt: null, fromPrice: true, photo: { url: 'https://cdn.example/p1.jpg', alt: null, versionId: null }, badge: null },
    ])
  })

  it('read no list as an empty one, and the ids alone for a heart', () => {
    expect(wishlistOperation().parse({ wishlist: null })).toEqual([])
    expect(wishlistIdsOperation().parse({ wishlist: [{ id: 'p1' }, { id: 'p2' }] })).toEqual(['p1', 'p2'])
  })

  it('are a bad answer when the shape drifts', () => {
    expect(() => wishlistIdsOperation().parse({ wishlist: [{ nope: 1 }] })).toThrow()
  })
})

describe('the wishlist writes', () => {
  it('send the product id to the API', async () => {
    const api = client(() => ({ addToWishlist: true }))
    await addToWishlist(api, 'p1')
    await removeFromWishlist(api, 'p1')
    expect(api.calls.map((c) => [c.query.includes('addToWishlist'), c.query.includes('removeFromWishlist'), c.variables])).toEqual([
      [true, false, { productId: 'p1' }],
      [false, true, { productId: 'p1' }],
    ])
  })

  it('let the API’s refusal through, for the screen to word by its code', async () => {
    const api = client(() => {
      throw new ApiError('LIMIT', 'full')
    })
    await expect(addToWishlist(api, 'p1')).rejects.toMatchObject({ code: 'LIMIT' })
  })
})
