import { z } from 'zod'
import { query } from './client'
import { moneySchema } from './orders'

// The Wishlists tab, its Reminders and a shopper's page (FIRST-RELEASE §9; apps/api/schema/store.graphql, src/apis/store/wishlists.ts):
// Owner, Manager and Staff read (ACCESS §5.1 `carts.read`); the reminder actions and settings need `carts.write`.

const shopperSchema = z.object({
  customerId: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  items: z.number().int(),
  lastSavedAt: z.string(),
  // The newest saved product's name in the list; null in a shopper's own page.
  firstProduct: z.string().nullable(),
  remindersSent: z.number().int(),
  lastSentAt: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  stoppedBy: z.string().nullable(),
  stoppedNote: z.string().nullable(),
})
export type WishlistShopper = z.infer<typeof shopperSchema>

const itemSchema = z.object({ productId: z.string(), name: z.string().nullable(), photoUrl: z.string().nullable(), inStock: z.boolean(), price: moneySchema.nullable() })
export type WishlistShopperItem = z.infer<typeof itemSchema>
const reminderSchema = z.object({ id: z.string(), position: z.number().int().nullable(), state: z.string(), skipReason: z.string().nullable(), sentBy: z.string().nullable(), queuedAt: z.string(), sentAt: z.string().nullable() })
export type WishlistReminder = z.infer<typeof reminderSchema>
const detailSchema = z.object({ shopper: shopperSchema, items: z.array(itemSchema), reminders: z.array(reminderSchema) })
export type WishlistShopperDetail = z.infer<typeof detailSchema>

const pageInfoSchema = z.object({ hasNextPage: z.boolean(), hasPreviousPage: z.boolean(), startCursor: z.string().nullable(), endCursor: z.string().nullable() })

export interface WishlistPage {
  rows: WishlistShopper[]
  next: string | null
  previous: string | null
}

export const wishlistPageSize = 25

/** The Wishlists tab's views: not reminded yet, reminded, and stopped by the team (apps/api: db/scoped/wishlist.ts). */
export const wishlistTabs = ['waiting', 'reminded', 'stopped'] as const
export type WishlistTab = (typeof wishlistTabs)[number]

/** Shoppers with a wishlist in a tab, the newest saved first; searched by name, email or a product they saved. */
export const loadWishlistShoppers = async (tab: WishlistTab, search: string, cursor: { after?: string | null; before?: string | null } = {}): Promise<WishlistPage> => {
  const { wishlistShoppers } = await query(
    `query W($tab: String, $search: String, $first: Int, $after: String, $before: String) {
      wishlistShoppers(tab: $tab, search: $search, first: $first, after: $after, before: $before) { nodes { customerId name email items lastSavedAt firstProduct remindersSent lastSentAt stoppedAt stoppedBy stoppedNote } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } }
    }`,
    z.object({ wishlistShoppers: z.object({ nodes: z.array(shopperSchema), pageInfo: pageInfoSchema }) }),
    { tab, search: search.trim() || null, first: wishlistPageSize, after: cursor.after ?? null, before: cursor.before ?? null },
  )
  return { rows: wishlistShoppers.nodes, next: wishlistShoppers.pageInfo.hasNextPage ? wishlistShoppers.pageInfo.endCursor : null, previous: wishlistShoppers.pageInfo.hasPreviousPage ? wishlistShoppers.pageInfo.startCursor : null }
}

const countsSchema = z.object({ waiting: z.number().int(), reminded: z.number().int(), stopped: z.number().int() })
export type WishlistCounts = z.infer<typeof countsSchema>

export const loadWishlistCounts = async (): Promise<WishlistCounts> => (await query('{ wishlistShopperCounts { waiting reminded stopped } }', z.object({ wishlistShopperCounts: countsSchema }))).wishlistShopperCounts

const summarySchema = z.object({ days: z.number().int(), shoppers: z.number().int(), products: z.number().int(), reachable: z.number().int(), remindersSent: z.number().int(), reminded: z.number().int() })
export type WishlistSummary = z.infer<typeof summarySchema>

/** The tiles above the tabs: who has a wishlist now, and what reminders did in the last days. */
export const loadWishlistSummary = async (): Promise<WishlistSummary | null> =>
  (await query('{ wishlistSummary { days shoppers products reachable remindersSent reminded } }', z.object({ wishlistSummary: summarySchema.nullable() }))).wishlistSummary

/** One shopper's wishlist as they could see it now (sold-out products marked); null for one with none. */
export const loadWishlistShopper = async (customerId: string): Promise<WishlistShopperDetail | null> =>
  (
    await query(
      `query W($id: ID!) { wishlistShopper(customerId: $id) { shopper { customerId name email items lastSavedAt firstProduct remindersSent lastSentAt stoppedAt stoppedBy stoppedNote } items { productId name photoUrl inStock price { amount currency } } reminders { id position state skipReason sentBy queuedAt sentAt } } }`,
      z.object({ wishlistShopper: detailSchema.nullable() }),
      { id: customerId },
    )
  ).wishlistShopper

const stepSchema = z.object({ position: z.number().int(), enabled: z.boolean(), delayMinutes: z.number().int(), subject: z.string(), body: z.string() })
export type WishlistReminderStep = z.infer<typeof stepSchema>
const settingsSchema = z.object({ enabled: z.boolean(), skipOutOfStock: z.boolean(), quietHours: z.boolean(), weeklyCap: z.boolean(), steps: z.array(stepSchema), revision: z.number().int().nullable(), level: z.string() })
export type WishlistReminderSettings = z.infer<typeof settingsSchema>
export type WishlistReminderSettingsInput = Omit<WishlistReminderSettings, 'revision' | 'level'>

export const loadWishlistReminderSettings = async (): Promise<WishlistReminderSettings | null> =>
  (
    await query(
      '{ wishlistReminderSettings { enabled skipOutOfStock quietHours weeklyCap steps { position enabled delayMinutes subject body } revision level } }',
      z.object({ wishlistReminderSettings: settingsSchema.nullable() }),
    )
  ).wishlistReminderSettings

/** Saves the whole tab at the revision it was read at; answers the new revision. */
export const saveWishlistReminderSettings = async (input: WishlistReminderSettingsInput, revision: number | null): Promise<number> =>
  (await query('mutation S($input: WishlistReminderSettingsInput!, $revision: Int) { saveWishlistReminderSettings(input: $input, revision: $revision) }', z.object({ saveWishlistReminderSettings: z.number().int() }), { input, revision })).saveWishlistReminderSettings

export const remindWishlistNow = async (customerId: string): Promise<void> => {
  await query('mutation R($id: ID!) { remindWishlistNow(customerId: $id) }', z.object({ remindWishlistNow: z.string() }), { id: customerId })
}

export const stopWishlistReminders = async (customerId: string, note: string | null): Promise<void> => {
  await query('mutation S($id: ID!, $note: String) { stopWishlistReminders(customerId: $id, note: $note) }', z.object({ stopWishlistReminders: z.boolean() }), { id: customerId, note })
}

export const resumeWishlistReminders = async (customerId: string): Promise<void> => {
  await query('mutation R($id: ID!) { resumeWishlistReminders(customerId: $id) }', z.object({ resumeWishlistReminders: z.boolean() }), { id: customerId })
}
