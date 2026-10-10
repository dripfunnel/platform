import { z } from 'zod'

// Never exported, so nothing outside core can name it: a value of a branded type comes only from
// core's decoders (storefront ARCHITECTURE §2.1 `pricing`, §3.3 "A wrong price or total").
declare const brand: unique symbol

/** A Shop API value only core can make; a theme receives one and can't build or cast to one. */
export type Branded<T, Name extends string> = Readonly<T> & { readonly [brand]: Name }

/** Whether a version can be bought, and how many are left when the store shows it (ShopProduct.inStock, ShopVersion.available). */
export type Stock = Branded<{ inStock: boolean; available: number | null }, 'Stock'>
export const stockSchema = z.object({ inStock: z.boolean(), available: z.number().int().nonnegative().nullable() }).transform((s) => s as Stock)

/** A badge whose rule holds, as the engine words it (ShopBadge). */
export type Badge = Branded<{ label: string; tone: string | null }, 'Badge'>
export const badgeSchema = z.object({ label: z.string().min(1), tone: z.string().nullable() }).transform((b) => b as Badge)

/** Shoppers' rating of a product, out of 5, with how many rated it. */
export type Rating = Branded<{ average: number; count: number }, 'Rating'>
export const ratingSchema = z.object({ average: z.number().min(0).max(5), count: z.number().int().nonnegative() }).transform((r) => r as Rating)
