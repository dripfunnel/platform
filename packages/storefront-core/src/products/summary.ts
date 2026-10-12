import { z } from 'zod'
import { photoSchema, type Photo } from '../platform/media/media'
import { badgeSchema, stockSchema, type Badge, type Stock } from '../pricing/brand'
import { moneySchema, type Money } from '../pricing/money'

// A product as a listing shows it (ShopProductSummary), decoded from apps/api/schema/shop.graphql.

export const moneyFields = 'amount currency'
export const summaryFields = `id name slug productType inStock price { ${moneyFields} } compareAt { ${moneyFields} } maxPrice { ${moneyFields} } photo { alt image { url } } badges { label tone }`

const text = z.string().nullable().optional()
const money = moneySchema.nullable().optional().catch(null)

/** Only the badges whose words came through; a badge is the engine's, never the theme's (DESIGN §5). */
export const badgesSchema = z
  .array(z.unknown())
  .nullable()
  .optional()
  .transform((list) => (list ?? []).flatMap((b) => (badgeSchema.safeParse({ tone: null, ...(b as object) }).data ?? [])))

export type ProductCard = {
  id: string
  name: string
  href: string
  price: Money | null
  compareAt: Money | null
  /** The cheapest version's price, when versions cost different amounts ("From"). */
  from: boolean
  stock: Stock
  photo: Photo | null
  badges: Badge[]
}

export const productPath = (slug: string) => `/products/${encodeURIComponent(slug)}/`

const summarySchema = z.object({
  id: text,
  name: text,
  slug: text,
  inStock: z.boolean().nullable().optional(),
  price: money,
  compareAt: money,
  maxPrice: money,
  photo: photoSchema.nullable().optional().catch(null),
  badges: badgesSchema,
})

const differs = (a: Money | null | undefined, b: Money | null | undefined) => !!a && !!b && a.currency === b.currency && a.amount !== b.amount

/** A listing's products; one the catalogue left without a name or address is left out rather than failing the page. */
export const cardsSchema = z
  .array(summarySchema)
  .nullable()
  .optional()
  .transform((nodes) =>
    (nodes ?? []).flatMap((p): ProductCard[] =>
      p.id && p.name && p.slug
        ? [
            {
              id: p.id,
              name: p.name,
              href: productPath(p.slug),
              price: p.price ?? null,
              compareAt: p.compareAt ?? null,
              from: differs(p.price, p.maxPrice),
              stock: stockSchema.parse({ inStock: p.inStock ?? false, available: null }),
              photo: p.photo ?? null,
              badges: p.badges,
            },
          ]
        : [],
    ),
  )
