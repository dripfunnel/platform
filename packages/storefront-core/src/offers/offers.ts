'use client'

import { useEffect, useState } from 'react'
import { z } from 'zod'
import { collectionPath } from '../collections/collections'
import { useShopData } from '../platform/render/data'
import { productPath } from '../products/summary'

// The store's offers a theme may announce (ARCHITECTURE §2.1, #1242): the automatic ones on now, as the Shop API answers
// them; a code is never among them. A banner drawn from this appears and goes with a real offer.

const text = z.string().nullable().optional()
const offersSchema = z.object({
  offers: z
    .array(z.object({ id: text, name: text, description: text, endsAt: text, appliesTo: text, products: z.array(z.string()).nullable().optional(), collections: z.array(z.string()).nullable().optional() }))
    .nullable(),
})

export const offersQuery = 'query Offers { offers { id name description endsAt appliesTo products collections } }'

export type OfferTarget = { slug: string; href: string }

export type Offer = {
  id: string
  name: string
  description: string | null
  /** When it ends (an ISO instant), or null while it runs until the merchant ends it; core drops it at that moment. */
  endsAt: string | null
  /** `products`: the products and collections below (none listed: chosen by a filter); `order` and `shipping`: the whole cart. */
  appliesTo: 'products' | 'order' | 'shipping'
  products: OfferTarget[]
  collections: OfferTarget[]
}

const scopes = { PRODUCTS: 'products', ORDER: 'order', SHIPPING: 'shipping' } as const
/** setTimeout's longest wait; an offer ending later is looked at again then. */
const maxWaitMs = 2_147_483_647

const decode = (rows: z.infer<typeof offersSchema>['offers']): Offer[] =>
  (rows ?? []).flatMap((o) => {
    const appliesTo = o.appliesTo && o.appliesTo in scopes ? scopes[o.appliesTo as keyof typeof scopes] : null
    const ends = o.endsAt ? Date.parse(o.endsAt) : null
    if (!o.id || !o.name || !appliesTo || Number.isNaN(ends)) return []
    return [
      {
        id: o.id,
        name: o.name,
        description: o.description ?? null,
        endsAt: ends === null ? null : new Date(ends).toISOString(),
        appliesTo,
        products: (o.products ?? []).map((slug) => ({ slug, href: productPath(slug) })),
        collections: (o.collections ?? []).map((slug) => ({ slug, href: collectionPath(slug) })),
      },
    ]
  })

/** The offers on now, those ending soonest first; each leaves the list when it ends, without a reload. */
export const useOffers = () => {
  const list = useShopData('offers', async (client) => decode((await client.query(offersQuery, offersSchema)).offers))
  const offers = list.data ?? []
  // The clock is read only after hydration, so the first render matches the page as it was built.
  const [now, setNow] = useState<number | null>(null)
  useEffect(() => setNow(Date.now()), [])
  useEffect(() => {
    if (now === null) return undefined
    const next = Math.min(...offers.flatMap((o) => (o.endsAt ? [Date.parse(o.endsAt)] : [])).filter((t) => t > now))
    if (!Number.isFinite(next)) return undefined
    const timer = setTimeout(() => setNow(Date.now()), Math.min(next - now, maxWaitMs))
    return () => clearTimeout(timer)
  }, [offers, now])
  return { status: list.status, retry: list.retry, offers: now === null ? offers : offers.filter((o) => o.endsAt === null || Date.parse(o.endsAt) > now) }
}
