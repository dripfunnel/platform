// @vitest-environment happy-dom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Provided, shopAnswering, type Asked } from '../../test/shop'
import { createShopClient } from '../platform/api/client'
import { keepShopperToken, storedShopState } from '../platform/api/tokens'
import type { RenderMode } from '../platform/store/context'
import { useWishlist, type WishlistPage } from './wishlist'

let page: WishlistPage | null = null
const Probe = ({ cards }: { cards: boolean }) => {
  page = useWishlist({ cards })
  return null
}
const shown = (): WishlistPage => {
  if (!page) throw new Error('not rendered')
  return page
}
const show = async ({ cards = false, mode = 'live' }: { cards?: boolean; mode?: RenderMode } = {}) => {
  render(
    <Provided mode={mode} client={createShopClient({ state: storedShopState })}>
      <Probe cards={cards} />
    </Provided>,
  )
  await act(async () => undefined)
}
const assign = vi.fn()
const at = (address: string) => {
  const url = new URL(address, location.origin)
  vi.stubGlobal('location', { ...location, assign, origin: url.origin, pathname: url.pathname, search: url.search })
}

beforeEach(() => at('/products/kurta/'))
afterEach(() => {
  cleanup()
  page = null
  localStorage.clear()
  sessionStorage.clear()
  assign.mockReset()
  vi.unstubAllGlobals()
})

const signedIn = () => keepShopperToken('session', 'sess-1')
const card = (id: string, slug: string, name: string) => ({ id, name, slug, inStock: true, price: { amount: '1000', currency: 'USD' }, compareAt: null, maxPrice: null, photo: null, badges: [] })

/** A Shop API holding a wishlist of product ids, which the mutations change. */
const holding = (ids: string[], refuse: string | null = null) => {
  const held = [...ids]
  const asked = shopAnswering((a: Asked) => {
    if (a.query.includes('addToWishlist')) {
      if (refuse) return { errors: [{ message: 'no', extensions: { code: refuse } }] }
      held.push(String(a.variables['productId']))
      return { data: { addToWishlist: true } }
    }
    if (a.query.includes('removeFromWishlist')) {
      held.splice(held.indexOf(String(a.variables['productId'])), 1)
      return { data: { removeFromWishlist: true } }
    }
    if (a.query.includes('WishlistIds')) return { data: { wishlist: held.map((id) => ({ id })) } }
    return { data: { cart: null } }
  })
  return asked
}
const sent = (asked: Asked[], name: string) => asked.filter((a) => a.query.includes(name))

describe('useWishlist (the heart)', () => {
  it('tells every other hook on the page when the list changes, so the header count follows the heart', async () => {
    signedIn()
    holding(['p-2'])
    let counted = -1
    const Count = () => {
      counted = useWishlist().count
      return null
    }
    render(
      <Provided mode="live" client={createShopClient({ state: storedShopState })}>
        <Probe cards={false} />
        <Count />
      </Provided>,
    )
    await act(async () => undefined)
    expect(counted).toBe(1)
    await act(async () => shown().toggle('p-1'))
    expect(counted).toBe(2)
  })

  it('reads signed out, and a tap remembers the product and goes to sign in, coming back to this page', async () => {
    const asked = holding([])
    await show()
    expect(shown().status).toBe('signedOut')
    await act(async () => shown().toggle('p-1'))
    expect(sessionStorage.getItem('df.wishlist.pending')).toBe('p-1')
    expect(assign).toHaveBeenCalledWith('/sign-in/?next=%2Fproducts%2Fkurta%2F')
    expect(sent(asked, 'Wishlist')).toHaveLength(0)
  })

  it('adds and removes for a signed-in shopper, the heart answering at once', async () => {
    signedIn()
    const asked = holding(['p-2'])
    await show()
    expect([shown().status, shown().has('p-1'), shown().has('p-2'), shown().count]).toEqual(['ready', false, true, 1])
    await act(async () => shown().toggle('p-1'))
    expect(shown().has('p-1')).toBe(true)
    expect(sent(asked, 'addToWishlist')[0]?.variables).toEqual({ productId: 'p-1' })
    await act(async () => shown().toggle('p-1'))
    expect(shown().has('p-1')).toBe(false)
    expect(sent(asked, 'removeFromWishlist')).toHaveLength(1)
  })

  it('says LIMIT when the list is full and keeps the heart off', async () => {
    signedIn()
    holding([], 'LIMIT')
    await show()
    await act(async () => shown().toggle('p-1'))
    expect([shown().error, shown().has('p-1')]).toEqual(['LIMIT', false])
  })

  it('keeps the chosen option only once the add went through', async () => {
    signedIn()
    holding([], 'LIMIT')
    await show()
    await act(async () => shown().toggle('p-1', 'ver-1'))
    expect(localStorage.getItem('df.wishlist.chosen')).toBeNull()
  })

  it('keeps an option already saved when the page opens with none chosen', async () => {
    signedIn()
    localStorage.setItem('df.wishlist.chosen', JSON.stringify({ 'p-2': 'ver-2' }))
    holding(['p-2'])
    await show()
    expect(JSON.parse(localStorage.getItem('df.wishlist.chosen') ?? '{}')).toEqual({ 'p-2': 'ver-2' })
  })

  it('forgets the saved options once the shopper is signed out', async () => {
    localStorage.setItem('df.wishlist.chosen', JSON.stringify({ 'p-2': 'ver-2' }))
    holding([])
    await show()
    expect(localStorage.getItem('df.wishlist.chosen')).toBeNull()
  })

  it('saves the option chosen before sign-in once the add after sign-in went through', async () => {
    at('/products/kurta/')
    holding([])
    await show()
    await act(async () => shown().toggle('p-3', 'ver-3'))
    expect(localStorage.getItem('df.wishlist.chosen')).toBeNull()
    cleanup()
    signedIn()
    await show()
    expect(JSON.parse(localStorage.getItem('df.wishlist.chosen') ?? '{}')).toEqual({ 'p-3': 'ver-3' })
  })

  it('adds the product remembered at sign-in once, and only if it is not there already', async () => {
    signedIn()
    sessionStorage.setItem('df.wishlist.pending', 'p-3')
    const asked = holding([])
    await show()
    await act(async () => undefined)
    expect(sent(asked, 'addToWishlist').map((a) => a.variables)).toEqual([{ productId: 'p-3' }])
    expect(sessionStorage.getItem('df.wishlist.pending')).toBeNull()
    expect(shown().has('p-3')).toBe(true)
    cleanup()
    sessionStorage.setItem('df.wishlist.pending', 'p-3')
    const again = holding(['p-3'])
    await show()
    expect(sent(again, 'addToWishlist')).toHaveLength(0)
  })

  it('does nothing on a preview, which nobody signs in to', async () => {
    const asked = holding([])
    await show({ mode: 'preview' })
    await act(async () => shown().toggle('p-1'))
    expect([shown().error, assign.mock.calls.length, sent(asked, 'Wishlist').length]).toEqual(['NOT_IN_PREVIEW', 0, 0])
  })
})

describe('useWishlist (the page)', () => {
  const answering = (wishlist: unknown[], versions: Record<string, unknown>) =>
    shopAnswering((a: Asked) => {
      if (a.query.includes('WishlistVersions')) return { data: versions }
      if (a.query.includes('query Wishlist ')) return { data: { wishlist } }
      if (a.query.includes('removeFromWishlist')) return { data: { removeFromWishlist: true } }
      if (a.query.includes('addToCart')) return { data: { addToCart: { cartToken: 'c', cart: null } } }
      return { data: { cart: null } }
    })

  it('adds the option the shopper chose on this device, unless it has sold out', async () => {
    signedIn()
    localStorage.setItem('df.wishlist.chosen', JSON.stringify({ b: 'ver-b2', c: 'ver-c2', d: 'gone' }))
    answering([card('b', 'scarf', 'Scarf'), card('c', 'shirt', 'Shirt'), card('d', 'shawl', 'Shawl')], {
      v0: { giftCard: null, versions: [{ id: 'ver-b1', inStock: true }, { id: 'ver-b2', inStock: true }] },
      v1: { giftCard: null, versions: [{ id: 'ver-c1', inStock: true }, { id: 'ver-c2', inStock: false }] },
      v2: { giftCard: null, versions: [{ id: 'ver-d1', inStock: true }, { id: 'ver-d2', inStock: true }] },
    })
    await show({ cards: true })
    expect(shown().items.map((i) => [i.name, i.versionId])).toEqual([['Scarf', 'ver-b2'], ['Shirt', null], ['Shawl', null]])
    await act(async () => void shown().remove('b'))
    expect(JSON.parse(localStorage.getItem('df.wishlist.chosen') ?? '{}')).not.toHaveProperty('b')
  })

  it('lists the products with the version Add to cart adds: only a single version in stock with no gift card to fill in', async () => {
    signedIn()
    const asked = answering([card('a', 'kurta', 'Kurta'), card('b', 'scarf', 'Scarf'), card('c', 'card', 'Gift card'), card('d', 'shawl', 'Shawl')], {
      v0: { giftCard: null, versions: [{ id: 'ver-a', inStock: true }] },
      v1: { giftCard: null, versions: [{ id: 'ver-b1', inStock: true }, { id: 'ver-b2', inStock: true }] },
      v2: { giftCard: { expiryMonths: 12 }, versions: [{ id: 'ver-c', inStock: true }] },
      v3: { giftCard: null, versions: [{ id: 'ver-d', inStock: false }] },
    })
    await show({ cards: true })
    expect(shown().status).toBe('ready')
    expect(shown().items.map((i) => [i.name, i.versionId])).toEqual([['Kurta', 'ver-a'], ['Scarf', null], ['Gift card', null], ['Shawl', null]])
    expect(sent(asked, 'WishlistVersions')[0]?.variables).toEqual({ s0: 'kurta', s1: 'scarf', s2: 'card', s3: 'shawl' })
  })

  it('removes a product from the list, and adds an item to the cart', async () => {
    signedIn()
    const asked = answering([card('a', 'kurta', 'Kurta')], { v0: { giftCard: null, versions: [{ id: 'ver-a', inStock: true }] } })
    await show({ cards: true })
    const [item] = shown().items
    await act(async () => void (item && (await shown().addToCart(item))))
    expect(sent(asked, 'addToCart')[0]?.variables).toMatchObject({ versionId: 'ver-a', quantity: 1 })
    await act(async () => void (await shown().remove('a')))
    expect(shown().items).toEqual([])
    expect(sent(asked, 'removeFromWishlist')[0]?.variables).toEqual({ productId: 'a' })
  })

  it('still lists the products when the versions can not be read, each then sent to its page to choose', async () => {
    signedIn()
    shopAnswering((a: Asked) => (a.query.includes('WishlistVersions') ? { errors: [{ message: 'no', extensions: { code: 'UNKNOWN' } }] } : a.query.includes('query Wishlist ') ? { data: { wishlist: [card('a', 'kurta', 'Kurta')] } } : { data: { cart: null } }))
    await show({ cards: true })
    expect(shown().items.map((i) => [i.name, i.versionId])).toEqual([['Kurta', null]])
  })

  it('reports a load that failed, and asks again on retry', async () => {
    signedIn()
    let fail = true
    shopAnswering((a: Asked) => (a.query.includes('query Wishlist ') ? (fail ? { errors: [{ message: 'no', extensions: { code: 'STORE_UNAVAILABLE' } }] } : { data: { wishlist: [] } }) : { data: { cart: null } }))
    await show({ cards: true })
    expect([shown().status, shown().code]).toEqual(['error', 'STORE_UNAVAILABLE'])
    fail = false
    await act(async () => shown().retry())
    expect(shown().status).toBe('ready')
  })

  it('reads as signed out when the session has ended, and forgets it', async () => {
    signedIn()
    shopAnswering((a: Asked) => (a.query.includes('query Wishlist ') ? { errors: [{ message: 'no', extensions: { code: 'SIGNED_OUT' } }] } : { data: { cart: null } }))
    await show({ cards: true })
    expect(shown().status).toBe('signedOut')
    expect(localStorage.getItem('df-session')).toBeNull()
  })
})
