import { z } from 'zod'
import { pageInfoSchema, typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// Abandoned carts on the Store API (FIRST-RELEASE (store) §9; apps/api src/apis/store/cartReminders.ts): the merchant side's alone.
// Owner and Manager remind and stop, Staff read (`carts.read`, `carts.write`). Every status, value and figure is the API's;
// amounts are digit strings of minor units.

const moneySchema = z.object({ amount: z.string().regex(/^-?\d+$/), currency: z.string() })
export type CartMoney = z.infer<typeof moneySchema>

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

export const cartPageSize = 25

/** One page of a tab, newest left first, searched by name, email or product; `after` pages on. */
export const loadCarts = async (client: ApiClient, tab: CartTab, search: string, after: string | null = null): Promise<{ rows: AbandonedCart[]; next: string | null }> => {
  const { abandonedCarts } = await typedQuery(client)(
    `query Carts($tab: String!, $search: String, $first: Int, $after: String) {
      abandonedCarts(tab: $tab, search: $search, first: $first, after: $after) { nodes { ${cartFields} } pageInfo { hasNextPage hasPreviousPage startCursor endCursor } }
    }`,
    z.object({ abandonedCarts: z.object({ nodes: z.array(cartSchema), pageInfo: pageInfoSchema }) }),
    { tab, search: search.trim() || null, first: cartPageSize, after },
  )
  return { rows: abandonedCarts.nodes, next: abandonedCarts.pageInfo.hasNextPage ? abandonedCarts.pageInfo.endCursor : null }
}

const countsSchema = z.object({ open: z.number().int(), recovered: z.number().int(), lost: z.number().int() })
export type CartCounts = z.infer<typeof countsSchema>

export const loadCartCounts = async (client: ApiClient): Promise<CartCounts> =>
  (await typedQuery(client)('{ abandonedCartCounts { open recovered lost } }', z.object({ abandonedCartCounts: countsSchema }))).abandonedCartCounts

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
export const loadCartSummary = async (client: ApiClient): Promise<CartSummary> =>
  (
    await typedQuery(client)(
      '{ cartSummary(days: 14) { days abandoned leftBehind { amount currency } remindersSent reachable recovered recoveredSales { amount currency } recoveredWithCode } }',
      z.object({ cartSummary: summarySchema }),
    )
  ).cartSummary

const lineSchema = z.object({
  versionId: z.string(),
  name: z.string().nullable(),
  versionName: z.string().nullable(),
  quantity: z.number().int(),
  lineTotal: moneySchema.nullable(),
  available: z.number().int().nullable(),
  outOfStock: z.boolean(),
})
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

/** One cart as it would be bought now (today's price and stock) with every reminder it had; null for one that isn't here. */
export const loadCart = async (client: ApiClient, id: string): Promise<CartDetail | null> =>
  (
    await typedQuery(client)(
      `query Cart($id: ID!) { abandonedCart(id: $id) { cart { ${cartFields} } lines { versionId name versionName quantity lineTotal { amount currency } available outOfStock } reminders { id position channel state skipReason sentBy code queuedAt sentAt clickedAt } } }`,
      z.object({ abandonedCart: detailSchema.nullable() }),
      { id },
    )
  ).abandonedCart

/** The only code a reminder sent by hand may carry (apps/api cartReminders/rules.ts), and only on the plan's `automatic`. */
export const handCodePercent = 10

/** "Send reminder now": by email at once, even in quiet hours, with a single-use code if asked. */
export const remindNow = async (client: ApiClient, cartId: string, discountPercent: number | null): Promise<void> => {
  await typedQuery(client)('mutation RemindNow($id: ID!, $p: Int) { remindNow(cartId: $id, discountPercent: $p) }', z.object({ remindNow: z.string().nullable() }), { id: cartId, p: discountPercent })
}

/** The API's longest note on a stopped cart. */
export const maxStopNote = 200

export const stopReminders = async (client: ApiClient, cartId: string, note: string | null): Promise<void> => {
  await typedQuery(client)('mutation StopReminders($id: ID!, $note: String) { stopCartReminders(cartId: $id, note: $note) }', z.object({ stopCartReminders: z.boolean().nullable() }), { id: cartId, note })
}

export const resumeReminders = async (client: ApiClient, cartId: string): Promise<void> => {
  await typedQuery(client)('mutation ResumeReminders($id: ID!) { resumeCartReminders(cartId: $id) }', z.object({ resumeCartReminders: z.boolean().nullable() }), { id: cartId })
}

/** What the plan lets the store send: `youSend` (by hand, one a cart, no code), `onePerCart` or `automatic`. */
export const levels = ['youSend', 'onePerCart', 'automatic'] as const
export type ReminderLevel = (typeof levels)[number]

export type ReminderSending = { enabled: boolean; level: ReminderLevel }

/** Whether reminders go by themselves, and the plan's level; null when the store has no settings yet. */
export const loadReminderSending = async (client: ApiClient): Promise<ReminderSending | null> =>
  (await typedQuery(client)('{ reminderSettings { enabled level } }', z.object({ reminderSettings: z.object({ enabled: z.boolean(), level: z.enum(levels) }).nullable() }))).reminderSettings

const stepSchema = z.object({
  position: z.number().int(),
  enabled: z.boolean(),
  delayMinutes: z.number().int(),
  channel: z.enum(['email', 'whatsapp']),
  subject: z.string(),
  body: z.string(),
  discountPercent: z.number().int().nullable(),
})
export type ReminderStep = z.infer<typeof stepSchema>

const settingsSchema = z.object({
  enabled: z.boolean(),
  minimum: moneySchema.nullable(),
  skipOutOfStock: z.boolean(),
  quietHours: z.boolean(),
  weeklyCap: z.boolean(),
  steps: z.array(stepSchema),
  // Null until the store saves its own; the next save sends it back.
  revision: z.number().int().nullable(),
  level: z.enum(levels),
})
export type ReminderSettings = z.infer<typeof settingsSchema>

/** The three steps and who gets reminded, at the revision read (null before the first save, and for a store without settings). */
export const loadReminderSettings = async (client: ApiClient): Promise<ReminderSettings | null> =>
  (
    await typedQuery(client)(
      '{ reminderSettings { enabled minimum { amount currency } skipOutOfStock quietHours weeklyCap steps { position enabled delayMinutes channel subject body discountPercent } revision level } }',
      z.object({ reminderSettings: settingsSchema.nullable() }),
    )
  ).reminderSettings

/** The minutes after leaving a step may wait, and the sizes of a step's code (apps/api cartReminders/rules.ts). */
export const reminderDelays = [30, 60, 240, 600, 1440, 2880, 4320] as const
export const reminderPercents = [5, 10, 15, 20] as const
/** The API's longest subject and message. */
export const reminderText = { subject: 120, body: 500 } as const

export type ReminderSettingsInput = Omit<ReminderSettings, 'revision' | 'level'>

/** Saves the whole screen at the revision it was read at; answers the new revision. */
export const saveReminderSettings = async (client: ApiClient, input: ReminderSettingsInput, revision: number | null): Promise<number> =>
  (
    await typedQuery(client)(
      'mutation SaveReminders($input: ReminderSettingsInput!, $revision: Int) { saveReminderSettings(input: $input, revision: $revision) }',
      z.object({ saveReminderSettings: z.number().int() }),
      { input, revision },
    )
  ).saveReminderSettings

/** "Send me a test" of one step, to the person's own email only (#321). */
export const sendTestReminder = async (client: ApiClient, position: number): Promise<void> => {
  await typedQuery(client)('mutation SendTest($p: Int!) { sendTestReminder(position: $p) }', z.object({ sendTestReminder: z.boolean().nullable() }), { p: position })
}

/** The store's country (the region's words and consent note) and, for the minimum cart value, its pricing currency; either may be unknown. */
export const loadCartPlace = async (client: ApiClient): Promise<{ country: string | null; currency: string | null }> => {
  const [info, locale] = await Promise.all([
    typedQuery(client)('{ storeInfo { country } }', z.object({ storeInfo: z.object({ country: z.string().nullable() }).nullable() })),
    typedQuery(client)('{ storeLocale { pricingCurrency } }', z.object({ storeLocale: z.object({ pricingCurrency: z.string().nullable() }).nullable() })),
  ])
  return { country: info.storeInfo?.country ?? null, currency: locale.storeLocale?.pricingCurrency ?? null }
}
