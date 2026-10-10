import { z } from 'zod'
import { query } from './client'
import { moneySchema } from './orders'

// Abandoned carts (FIRST-RELEASE §9; apps/api/schema/store.graphql, src/apis/store/cartReminders.ts): the merchant side's
// alone. Owner and Manager remind and stop, Staff read (ACCESS §5.1 `carts.read`, `carts.write`).

export const cartTabs = ['open', 'recovered', 'lost'] as const
export type CartTab = (typeof cartTabs)[number]

const cartSchema = z.object({
  id: z.string(),
  name: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  customerId: z.string().nullable(),
  value: moneySchema.nullable(),
  // contact, ship or pay: where they left checkout.
  step: z.string().nullable(),
  abandonedAt: z.string(),
  status: z.enum(['recovered', 'stopped', 'no_contact', 'opted_out', 'skipped', 'not_recovered', 'reminded', 'waiting']),
  skipReason: z.string().nullable(),
  firstItem: z.string().nullable(),
  lineCount: z.number().int(),
  remindersSent: z.number().int(),
  lastSentAt: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  stoppedBy: z.string().nullable(),
  stoppedNote: z.string().nullable(),
  recoveredOrderId: z.string().nullable(),
  recoveredOrderNumber: z.string().nullable(),
  recoveredWithCode: z.boolean(),
})
export type AbandonedCart = z.infer<typeof cartSchema>
export type CartStatus = AbandonedCart['status']

const cartFields =
  'id name email phone customerId value { amount currency } step abandonedAt status skipReason firstItem lineCount remindersSent lastSentAt stoppedAt stoppedBy stoppedNote recoveredOrderId recoveredOrderNumber recoveredWithCode'
const pageInfoSchema = z.object({ hasNextPage: z.boolean(), hasPreviousPage: z.boolean(), startCursor: z.string().nullable(), endCursor: z.string().nullable() })

export interface CartPage {
  rows: AbandonedCart[]
  next: string | null
  previous: string | null
}

export const cartPageSize = 25

/** In progress, recovered or not recovered, newest left first; searched by name, email or product. */
export const loadCarts = async (tab: CartTab, search: string, cursor: { after?: string | null; before?: string | null } = {}): Promise<CartPage> => {
  const { abandonedCarts } = await query(
    `query C($tab: String!, $search: String, $first: Int, $after: String, $before: String) {
      abandonedCarts(tab: $tab, search: $search, first: $first, after: $after, before: $before) { nodes { ${cartFields} } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } }
    }`,
    z.object({ abandonedCarts: z.object({ nodes: z.array(cartSchema), pageInfo: pageInfoSchema }) }),
    { tab, search: search.trim() || null, first: cartPageSize, after: cursor.after ?? null, before: cursor.before ?? null },
  )
  return { rows: abandonedCarts.nodes, next: abandonedCarts.pageInfo.hasNextPage ? abandonedCarts.pageInfo.endCursor : null, previous: abandonedCarts.pageInfo.hasPreviousPage ? abandonedCarts.pageInfo.startCursor : null }
}

const countsSchema = z.object({ open: z.number().int(), recovered: z.number().int(), lost: z.number().int() })
export type CartCounts = z.infer<typeof countsSchema>

export const loadCartCounts = async (): Promise<CartCounts> => (await query('{ abandonedCartCounts { open recovered lost } }', z.object({ abandonedCartCounts: countsSchema }))).abandonedCartCounts

const summarySchema = z.object({
  days: z.number().int(),
  abandoned: z.number().int(),
  leftBehind: z.array(moneySchema),
  remindersSent: z.number().int(),
  reachable: z.number().int(),
  recovered: z.number().int(),
  recoveredSales: z.array(moneySchema),
  recoveredWithCode: z.number().int(),
})
export type CartSummary = z.infer<typeof summarySchema>

/** The tiles, for the last 14 days. */
export const loadCartSummary = async (): Promise<CartSummary> =>
  (await query('{ cartSummary(days: 14) { days abandoned leftBehind { amount currency } remindersSent reachable recovered recoveredSales { amount currency } recoveredWithCode } }', z.object({ cartSummary: summarySchema }))).cartSummary

const lineSchema = z.object({ versionId: z.string(), name: z.string().nullable(), versionName: z.string().nullable(), quantity: z.number().int(), lineTotal: moneySchema.nullable(), available: z.number().int().nullable(), outOfStock: z.boolean() })
export type CartLine = z.infer<typeof lineSchema>
const reminderSchema = z.object({
  id: z.string(),
  position: z.number().int().nullable(),
  channel: z.string().nullable(),
  // queued, sent or skipped
  state: z.string(),
  skipReason: z.string().nullable(),
  sentBy: z.string().nullable(),
  code: z.string().nullable(),
  queuedAt: z.string(),
  sentAt: z.string().nullable(),
  clickedAt: z.string().nullable(),
})
export type CartReminder = z.infer<typeof reminderSchema>
const detailSchema = z.object({ cart: cartSchema, lines: z.array(lineSchema), reminders: z.array(reminderSchema) })
export type CartDetail = z.infer<typeof detailSchema>

/** One cart as it would be bought now (the price here and stock today), with every reminder it had. */
export const loadCart = async (id: string): Promise<CartDetail | null> =>
  (
    await query(
      `query C($id: ID!) { abandonedCart(id: $id) { cart { ${cartFields} } lines { versionId name versionName quantity lineTotal { amount currency } available outOfStock } reminders { id position channel state skipReason sentBy code queuedAt sentAt clickedAt } } }`,
      z.object({ abandonedCart: detailSchema.nullable() }),
      { id },
    )
  ).abandonedCart

/** A single-use code's sizes a reminder sent by hand may carry (src/engine/modules/cartReminders/rules.ts). */
export const reminderPercents = [5, 10, 15, 20] as const

/** "Send reminder now": by email at once, even in quiet hours, with a single-use code if asked. */
export const remindNow = async (cartId: string, discountPercent: number | null): Promise<void> => {
  await query('mutation R($id: ID!, $p: Int) { remindNow(cartId: $id, discountPercent: $p) }', z.object({ remindNow: z.string() }), { id: cartId, p: discountPercent })
}

export const stopReminders = async (cartId: string, note: string | null): Promise<void> => {
  await query('mutation S($id: ID!, $note: String) { stopCartReminders(cartId: $id, note: $note) }', z.object({ stopCartReminders: z.boolean() }), { id: cartId, note })
}

export const resumeReminders = async (cartId: string): Promise<void> => {
  await query('mutation R($id: ID!) { resumeCartReminders(cartId: $id) }', z.object({ resumeCartReminders: z.boolean() }), { id: cartId })
}

/** The API's longest note on a stopped cart. */
export const maxStopNote = 200

/** Whether reminders go by themselves, and what the plan lets the store send: youSend, onePerCart or automatic (Pricing). */
export const loadReminderSending = async (): Promise<{ enabled: boolean; level: string } | null> =>
  (await query('{ reminderSettings { enabled level } }', z.object({ reminderSettings: z.object({ enabled: z.boolean(), level: z.string() }).nullable() }))).reminderSettings
