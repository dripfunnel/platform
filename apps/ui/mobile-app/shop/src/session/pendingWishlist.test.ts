import { dropPendingWishlist, keepPendingWishlist, pendingWishlistMinutes, takePendingWishlist } from './pendingWishlist'

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'))

const host = 'acme.my-store.one'
const minute = 60_000

describe('the product kept for after sign-in', () => {
  it('is given once, then gone', async () => {
    await keepPendingWishlist(host, 'p1', 1_000)
    expect(await takePendingWishlist(host, 1_000 + minute)).toBe('p1')
    expect(await takePendingWishlist(host, 1_000 + minute)).toBeNull()
  })

  it('is none when nothing was kept', async () => {
    expect(await takePendingWishlist(host)).toBeNull()
  })

  it('is not added by a sign-in that comes long after the heart was tapped', async () => {
    await keepPendingWishlist(host, 'p1', 0)
    expect(await takePendingWishlist(host, (pendingWishlistMinutes + 1) * minute)).toBeNull()
  })

  it('is the last product tapped, and can be dropped', async () => {
    await keepPendingWishlist(host, 'p1', 0)
    await keepPendingWishlist(host, 'p2', 1)
    expect(await takePendingWishlist(host, 2)).toBe('p2')
    await keepPendingWishlist(host, 'p3', 3)
    await dropPendingWishlist(host)
    expect(await takePendingWishlist(host, 4)).toBeNull()
  })

  it('is kept apart for each store', async () => {
    await keepPendingWishlist(host, 'p1', 0)
    expect(await takePendingWishlist('other.my-store.one', 1)).toBeNull()
  })
})
