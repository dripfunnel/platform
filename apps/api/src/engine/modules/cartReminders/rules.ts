import { z } from 'zod'
import type { ReminderChannel, SkipReason } from '#db/scoped/cartReminders'

// The pure rules of abandoned carts and their reminders (FIRST-RELEASE §9; the Carts prototype's Reminders tab).

/** A cart untouched this long in checkout is abandoned (Carts spec: "idle ≥ 20 min"). */
export const idleMs = 20 * 60 * 1000
/** Reminders go within a week of leaving, and a recovery counts within it (Carts: "paid within 7 days of leaving"). */
export const reminderWindowMs = 7 * 86_400_000
/** The weekly cap's week (Carts: "more than one cart in 7 days"). */
export const weeklyCapMs = 7 * 86_400_000

/** The delays the Reminders tab offers, in minutes after the shopper leaves. */
export const reminderDelays = [30, 60, 240, 600, 1440, 2880, 4320] as const
export const reminderPercents = [5, 10, 15, 20] as const
export const reminderSteps = 3

/** The plan's `cart_reminders` index (planKeys.ts): by hand only, the first automatically, or all three with codes and WhatsApp. */
export const reminderLevels = ['youSend', 'onePerCart', 'automatic'] as const
export type ReminderLevel = (typeof reminderLevels)[number]
export const levelOf = (index: number): ReminderLevel => reminderLevels[Math.min(Math.max(Math.floor(index), 0), reminderLevels.length - 1)] ?? 'youSend'

/** Quiet hours in the store's own time (Carts: "between 9 pm and 8 am … they go out at 8 am"). */
const quietFrom = 21 * 60
const quietUntil = 8 * 60

/** How long to hold a reminder that falls in quiet hours; 0 outside them. `minutes` is the time of day in the store's zone. */
export const quietWaitMs = (minutes: number): number => {
  if (minutes >= quietFrom) return (24 * 60 - minutes + quietUntil) * 60_000
  if (minutes < quietUntil) return (quietUntil - minutes) * 60_000
  return 0
}

/**
 * Countries whose stores remind only shoppers who agreed to marketing (the EU and EEA: Carts' "EU rules … only shoppers who
 * tick 'Email me about my cart and offers'"). Decided here (#321): the EU's 27 and Iceland, Liechtenstein and Norway.
 */
export const optInCountries: ReadonlySet<string> = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
])

/** Whether the store may email this shopper about their cart: never after they stopped or chose other channels; in an opt-in country only once they agreed. */
export const mayEmail = (storeCountry: string | null, consent: { consent_state: string; consent_channels: readonly string[] } | null): boolean => {
  const state = consent?.consent_state ?? 'not_asked'
  if (state === 'stopped' || state === 'declined') return false
  // Agreeing to some channels and not email is no agreement to email, wherever the store is (decided on #321).
  if (state === 'opted_in' && consent && consent.consent_channels.length > 0 && !consent.consent_channels.includes('email')) return false
  if (storeCountry !== null && optInCountries.has(storeCountry)) return state === 'opted_in' && (consent?.consent_channels.includes('email') ?? false)
  return true
}

/** Whether the shopper agreed to WhatsApp (Carts: "WhatsApp needs opt-in"); checked when it is chosen and again as it goes. */
export const mayWhatsApp = (consent: { consent_state: string; consent_channels: readonly string[] } | null): boolean =>
  consent?.consent_state === 'opted_in' && consent.consent_channels.includes('whatsapp')

export interface DecisionFacts {
  byHand: boolean
  storeSending: boolean
  flowEnabled: boolean
  /** The plan level allows this step automatically. */
  levelAllows: boolean
  stepEnabled: boolean
  cartOpen: boolean
  stopped: boolean
  recovered: boolean
  /** The email, or for WhatsApp the number, it would go to. */
  contact: string | null
  /** The shopper's marketing answer allows this channel (mayEmail; WhatsApp is checked as it is chosen). */
  mayContact: boolean
  /** On the suppression list: it bounced or complained (THIRD-PARTY-ACCESS §2.4). */
  suppressed: boolean
  skipOutOfStock: boolean
  allOutOfStock: boolean
  underMinimum: boolean
  weeklyCap: boolean
  remindedAnotherCart: boolean
}

/**
 * Why a reminder isn't sent, in the prototype's order (recovered › stopped › no contact › opted out › out of stock › under
 * minimum), or null to send it. One sent by hand answers only the first four: the person sending it chose to.
 */
export const skipReasonOf = (f: DecisionFacts): SkipReason | null => {
  if (!f.cartOpen) return 'cart_gone'
  if (f.recovered) return 'recovered'
  if (f.stopped) return 'stopped'
  if (f.contact === null) return 'no_contact'
  if (!f.mayContact) return 'opted_out'
  if (f.suppressed) return 'undeliverable'
  if (f.byHand) return null
  if (!f.storeSending || !f.flowEnabled || !f.levelAllows || !f.stepEnabled) return 'paused'
  if (f.skipOutOfStock && f.allOutOfStock) return 'out_of_stock'
  if (f.underMinimum) return 'under_minimum'
  if (f.weeklyCap && f.remindedAnotherCart) return 'weekly_cap'
  return null
}

const text = (max: number) => z.string().transform((s) => s.trim()).pipe(z.string().max(max))

export const stepSchema = z
  .object({
    position: z.number().int().min(1).max(reminderSteps),
    enabled: z.boolean(),
    delayMinutes: z.number().int().refine((d) => (reminderDelays as readonly number[]).includes(d)),
    channel: z.enum(['email', 'whatsapp']),
    subject: text(120),
    body: text(500),
    discountPercent: z.number().int().refine((p) => (reminderPercents as readonly number[]).includes(p)).nullable(),
  })
  .strict()

export const settingsSchema = z
  .object({
    enabled: z.boolean(),
    minimum: z.object({ amount: z.string().regex(/^\d{1,15}$/), currency: z.string().regex(/^[A-Z]{3}$/) }).strict().nullable(),
    skipOutOfStock: z.boolean(),
    quietHours: z.boolean(),
    weeklyCap: z.boolean(),
    steps: z.array(stepSchema).length(reminderSteps),
  })
  .strict()
  .superRefine((s, ctx) => {
    const positions = s.steps.map((x) => x.position)
    if (new Set(positions).size !== reminderSteps) ctx.addIssue({ code: 'custom', message: 'one of each step' })
    const on = [...s.steps].sort((a, b) => a.position - b.position).filter((x) => x.enabled)
    // "Must go later than the reminder before it."
    if (on.some((x, i) => i > 0 && x.delayMinutes <= (on[i - 1]?.delayMinutes ?? 0))) ctx.addIssue({ code: 'custom', message: 'later than the one before' })
    // "Add a subject line."
    if (s.steps.some((x) => x.channel === 'email' && x.enabled && x.subject === '')) ctx.addIssue({ code: 'custom', message: 'a subject' })
  })

export type ReminderSettingsInput = z.input<typeof settingsSchema>
export type ReminderSettingsValue = z.output<typeof settingsSchema>

export interface ReminderStepView {
  position: number
  enabled: boolean
  delayMinutes: number
  channel: ReminderChannel
  subject: string
  body: string
  discountPercent: number | null
}

/**
 * Where a store starts (the prototype's defaults), until it saves its own: the words are the merchant's to change, and a
 * reminder sent by hand before any save uses the first. WhatsApp is offered in India only, so the default is email.
 */
export const defaultSteps: readonly ReminderStepView[] = [
  { position: 1, enabled: true, delayMinutes: 60, channel: 'email', subject: 'You left something in your cart', body: 'We saved your cart. Pick up right where you left off.', discountPercent: null },
  { position: 2, enabled: true, delayMinutes: 1440, channel: 'email', subject: 'Still thinking it over?', body: 'Here’s a little something to help you decide.', discountPercent: 10 },
  { position: 3, enabled: true, delayMinutes: 4320, channel: 'email', subject: 'Your cart won’t be saved much longer', body: 'Popular items sell out. Your cart is still here if you want it.', discountPercent: null },
]
