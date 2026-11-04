'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { z } from 'zod'
import { ShopApiError, type ShopClient } from '../platform/api/client'
import { keepShopperToken, shopperToken } from '../platform/api/tokens'
import { navigate, useLocation } from '../platform/browser/router'
import { useStorefront } from '../platform/store/context'
import { cardsSchema, summaryFields, type ProductCard } from '../products/summary'
import { useCart } from '../cart/cart'

// A signed-in shopper's wishlist (storefront ARCHITECTURE §2.1 `wishlist`; Shop API `wishlist`, `addToWishlist`,
// `removeFromWishlist`, #1213): the heart beside Add to cart and the Wishlist page. Only a live shop signs in (PREVIEW §5).

const idsQuery = `query WishlistIds { wishlist { id } }`
const idsSchema = z.object({ wishlist: z.array(z.object({ id: z.string() })).nullable() })
const cardsQuery = `query Wishlist { wishlist { ${summaryFields} } }`
const cardsAnswer = z.object({ wishlist: cardsSchema })
const addMutation = `mutation AddToWishlist($productId: ID!) { addToWishlist(productId: $productId) }`
const removeMutation = `mutation RemoveFromWishlist($productId: ID!) { removeFromWishlist(productId: $productId) }`

const codeOf = (error: unknown) => (error instanceof ShopApiError ? error.code : 'UNKNOWN')

/** A wishlist product with the version "Add to cart" adds; null when the shopper has to choose first (see `soleVersion`). */
export type WishlistItem = ProductCard & { versionId: string | null }

export type WishlistStatus = 'loading' | 'signedOut' | 'ready' | 'error'

export type WishlistPage = {
  status: WishlistStatus
  /** The last load's code when `status` is `error`. */
  code: string | null
  retry: () => void
  /** The products, newest first; empty unless the hook was asked for `cards`. */
  items: WishlistItem[]
  /** How many products the wishlist holds; 0 while loading or signed out. */
  count: number
  /** Whether the shopper's wishlist holds this product; false while loading or signed out. */
  has: (productId: string) => boolean
  /** A change is on its way. */
  busy: boolean
  /** The last change's refusal: LIMIT (the list is full), NOT_FOUND, NOT_IN_PREVIEW or UNKNOWN; cleared by the next change. */
  error: string | null
  /** The heart: adds or removes when signed in; signed out, remembers the product and sends the shopper to sign in, which adds it on return. */
  toggle: (productId: string, versionId?: string | null) => Promise<void>
  /** Remembers, on this device, the option the shopper chose for a wishlisted product, so the Wishlist page can add it to the cart. */
  chose: (productId: string, versionId: string | null) => void
  remove: (productId: string) => Promise<boolean>
  /** Adds the item's `versionId` to the cart; false when it has none or the engine refuses. */
  addToCart: (item: WishlistItem) => Promise<boolean>
}

const pendingKey = 'df.wishlist.pending'
const pendingVersionKey = 'df.wishlist.pending.version'

/** The product to add once sign-in is done; kept for this visit's tab only, so a later visit never adds it. */
const pending = {
  keep: (productId: string, versionId: string | null) => {
    try {
      globalThis.sessionStorage?.setItem(pendingKey, productId)
      if (versionId) globalThis.sessionStorage?.setItem(pendingVersionKey, versionId)
      else globalThis.sessionStorage?.removeItem(pendingVersionKey)
    } catch {
      // Storage is off: the shopper signs in and taps the heart again.
    }
  },
  take: (): { productId: string; versionId: string | null } | null => {
    try {
      const productId = globalThis.sessionStorage?.getItem(pendingKey) ?? null
      const versionId = globalThis.sessionStorage?.getItem(pendingVersionKey) ?? null
      globalThis.sessionStorage?.removeItem(pendingKey)
      globalThis.sessionStorage?.removeItem(pendingVersionKey)
      return productId ? { productId, versionId } : null
    } catch {
      return null
    }
  },
}

const chosenKey = 'df.wishlist.chosen'

/** The version chosen for each product, kept on this device only and forgotten at sign-out: the wishlist itself stores products, not options. */
const chosen = {
  all: (): Record<string, string> => {
    try {
      const found: unknown = JSON.parse(globalThis.localStorage?.getItem(chosenKey) ?? '{}')
      return z.record(z.string(), z.string()).parse(found)
    } catch {
      return {}
    }
  },
  clear: () => {
    try {
      globalThis.localStorage?.removeItem(chosenKey)
    } catch {
      // Storage is off: nothing was kept.
    }
  },
  set: (productId: string, versionId: string | null) => {
    const rest = Object.fromEntries(Object.entries(chosen.all()).filter(([id]) => id !== productId))
    try {
      globalThis.localStorage?.setItem(chosenKey, JSON.stringify(versionId ? { ...rest, [productId]: versionId } : rest))
    } catch {
      // Storage is off: the page asks the shopper to choose options.
    }
  },
}

const slugOf = (href: string) => decodeURIComponent(href.split('/')[2] ?? '')

const versionsAnswer = z.record(z.string(), z.object({ giftCard: z.unknown().nullable().optional(), versions: z.array(z.object({ id: z.string(), inStock: z.boolean().nullable().optional() })).nullable().optional() }).nullable())

/**
 * "Add to cart" on the Wishlist page needs a version, which a listing card doesn't carry: one request asks every item's
 * versions, and only a product with a single version in stock and no gift card to fill in can be added from here.
 */
const withVersions = async (client: ShopClient, cards: ProductCard[]): Promise<WishlistItem[]> => {
  if (cards.length === 0) return []
  const slugs = cards.map((c) => slugOf(c.href))
  const declared = slugs.map((_, i) => `$s${i}: String!`).join(', ')
  const fields = slugs.map((_, i) => `v${i}: product(slug: $s${i}) { giftCard { expiryMonths } versions { id inStock } }`).join(' ')
  try {
    const found = await client.query(`query WishlistVersions(${declared}) { ${fields} }`, versionsAnswer, Object.fromEntries(slugs.map((s, i) => [`s${i}`, s])))
    return cards.map((card, i) => {
      const product = found[`v${i}`]
      const remembered = chosen.all()[card.id]
      const picked = remembered ? product?.versions?.find((v) => v.id === remembered) : undefined
      const only = picked ?? (product?.versions?.length === 1 ? product.versions[0] : undefined)
      return { ...card, versionId: only?.inStock === true && !product?.giftCard ? only.id : null }
    })
  } catch {
    return cards.map((card) => ({ ...card, versionId: null }))
  }
}

type Loaded = { status: WishlistStatus; code: string | null; ids: ReadonlySet<string>; items: WishlistItem[] }
/** Every mounted hook (the heart, the header count, the page) reloads when another one changed the list. */
const mounted = new Set<() => void>()
const empty: Loaded = { status: 'loading', code: null, ids: new Set(), items: [] }

/** `cards: true` also loads each product as a listing shows it, for the Wishlist page; the heart needs only the ids. */
export const useWishlist = ({ cards = false }: { cards?: boolean } = {}): WishlistPage => {
  const { client, mode } = useStorefront()
  const { path } = useLocation()
  const cart = useCart()
  const signedIn = mode === 'live' && shopperToken('session') !== undefined
  const [loaded, setLoaded] = useState<Loaded>(signedIn ? empty : { ...empty, status: 'signedOut' })
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const latest = useRef(0)
  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  useEffect(() => {
    mounted.add(reload)
    return () => void mounted.delete(reload)
  }, [reload])

  useEffect(() => {
    const asked = (latest.current += 1)
    if (!signedIn) {
      chosen.clear()
      return setLoaded({ ...empty, status: 'signedOut' })
    }
    const load = async (): Promise<Loaded> => {
      if (!cards) {
        const answer = await client.query(idsQuery, idsSchema)
        return { status: 'ready', code: null, ids: new Set((answer.wishlist ?? []).map((p) => p.id)), items: [] }
      }
      const answer = await client.query(cardsQuery, cardsAnswer)
      const items = await withVersions(client, answer.wishlist)
      return { status: 'ready', code: null, ids: new Set(items.map((i) => i.id)), items }
    }
    void load().then(
      (next) => asked === latest.current && setLoaded(next),
      (e: unknown) => {
        if (asked !== latest.current) return
        // The session ended while the page was open: forget it, so the shopper reads as signed out.
        if (codeOf(e) === 'SIGNED_OUT') {
          keepShopperToken('session', null)
          chosen.clear()
        }
        setLoaded({ ...empty, status: codeOf(e) === 'SIGNED_OUT' ? 'signedOut' : 'error', code: codeOf(e) })
      },
    )
  }, [client, signedIn, cards, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  const change = useCallback(
    async (operation: string, productId: string, adding: boolean): Promise<boolean> => {
      setBusy(true)
      setError(null)
      try {
        await client.request(operation, { productId })
        // The heart answers at once; the page's list needs the added product's card, so it asks again.
        if (adding && cards) reload()
        else setLoaded((l) => ({ ...l, ids: new Set([...l.ids].filter((id) => adding || id !== productId).concat(adding ? [productId] : [])), items: adding ? l.items : l.items.filter((i) => i.id !== productId) }))
        for (const other of mounted) if (other !== reload) other()
        return true
      } catch (e) {
        const code = codeOf(e)
        if (code === 'SIGNED_OUT') {
          keepShopperToken('session', null)
          chosen.clear()
        }
        setError(code)
        return false
      } finally {
        setBusy(false)
      }
    },
    [client, cards, reload],
  )

  // Back from sign-in with a product to add: once, whatever the page.
  const adopted = useRef(false)
  useEffect(() => {
    if (!signedIn || adopted.current || loaded.status !== 'ready') return
    adopted.current = true
    const back = pending.take()
    if (back && !loaded.ids.has(back.productId)) void change(addMutation, back.productId, true).then((added) => added && back.versionId && chosen.set(back.productId, back.versionId))
  }, [signedIn, loaded, change])

  const toggle = async (productId: string, versionId: string | null = null) => {
    if (mode !== 'live') return setError('NOT_IN_PREVIEW')
    if (!signedIn) {
      pending.keep(productId, versionId)
      return navigate(`/sign-in/?next=${encodeURIComponent(path)}`)
    }
    const has = loaded.ids.has(productId)
    if (await change(has ? removeMutation : addMutation, productId, !has)) chosen.set(productId, has ? null : versionId)
  }

  return {
    status: loaded.status,
    code: loaded.code,
    retry,
    items: loaded.items,
    count: loaded.ids.size,
    has: (productId) => loaded.ids.has(productId),
    busy,
    error,
    toggle,
    chose: chosen.set,
    remove: async (productId) => {
      const removed = await change(removeMutation, productId, false)
      if (removed) chosen.set(productId, null)
      return removed
    },
    addToCart: async (item) => (item.versionId ? cart.add(item.versionId, 1) : false),
  }
}
