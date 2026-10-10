import type { AbandonedCart, CartCounts, CartDetail, CartSummary, ReminderSettings } from '../../api/carts'

// Abandoned carts' states under ?state= (ui/README.md §6): loading, error, empty, list, noMatch, staff, readOnly,
// denied, and youSend (a plan where the merchant sends reminders).
export const cartStates = ['loading', 'error', 'empty', 'list', 'noMatch', 'staff', 'readOnly', 'denied', 'youSend'] as const
export type CartState = (typeof cartStates)[number]

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const minute = 60_000
const ago = (minutes: number) => new Date(Date.now() - minutes * minute).toISOString()
const inr = (amount: string) => ({ amount, currency: 'INR' })
const base = { phone: null, customerId: null, skipReason: null, lastSentAt: null, stoppedAt: null, stoppedBy: null, stoppedNote: null, recoveredOrderId: null, recoveredOrderNumber: null, recoveredWithCode: false, remindersSent: 0, lineCount: 1 }

const open: AbandonedCart[] = harness
  ? [
      { ...base, id: 'ab1', name: 'Vikram Shah', email: 'vikram.shah@mail.com', value: inr('249900'), step: 'pay', abandonedAt: ago(25), status: 'waiting', firstItem: 'Silk Banarasi saree' },
      { ...base, id: 'ab2', name: 'Ananya Rao', email: 'ananya.rao@mail.com', customerId: 'c1', value: inr('418000'), step: 'ship', abandonedAt: ago(180), status: 'reminded', firstItem: 'Linen kurta · M', lineCount: 2, remindersSent: 1, lastSentAt: ago(120) },
      { ...base, id: 'ab3', name: 'Sara Khan', email: 'sara.khan@mail.com', value: inr('129900'), step: 'ship', abandonedAt: ago(1560), status: 'reminded', firstItem: 'Block-print dupatta', remindersSent: 2, lastSentAt: ago(120) },
    ]
  : []
const recovered: AbandonedCart[] = harness
  ? [{ ...base, id: 'ab4', name: 'Rohan Mehta', email: 'rohan@mail.com', customerId: 'c2', value: inr('358000'), step: 'pay', abandonedAt: ago(1800), status: 'recovered', firstItem: 'Linen kurta · L', lineCount: 2, remindersSent: 1, recoveredOrderId: 'o2848', recoveredOrderNumber: 'KT-2848', recoveredWithCode: true }]
  : []
const lost: AbandonedCart[] = harness
  ? [
      { ...base, id: 'ab6', name: null, email: null, value: inr('59800'), step: 'contact', abandonedAt: ago(300), status: 'no_contact', firstItem: 'Cotton socks' },
      { ...base, id: 'ab9', name: 'Meera Iyer', email: 'meera@mail.com', value: inr('189000'), step: 'ship', abandonedAt: ago(2200), status: 'stopped', firstItem: 'Silk stole', remindersSent: 1, stoppedAt: ago(1300), stoppedBy: 'Farhan Ali', stoppedNote: 'She called — ordering by phone' },
      { ...base, id: 'ab7', name: 'Arjun Das', email: 'arjun@mail.com', value: inr('39900'), step: 'ship', abandonedAt: ago(900), status: 'skipped', skipReason: 'under_minimum', firstItem: 'Hand towel' },
    ]
  : []

export interface CartSample {
  open: AbandonedCart[]
  recovered: AbandonedCart[]
  lost: AbandonedCart[]
  counts: CartCounts
  summary: CartSummary
}

export const cartSample = (state: CartState | null): CartSample | null => {
  if (!harness || !state || state === 'loading' || state === 'error' || state === 'denied') return null
  const counts = state === 'empty' ? { open: 0, recovered: 0, lost: 0 } : { open: open.length, recovered: recovered.length, lost: lost.length }
  const summary = { days: 14, abandoned: state === 'empty' ? 0 : 7, leftBehind: [inr('1544500')], remindersSent: 5, reachable: 6, recovered: 1, recoveredSales: [inr('358000')], recoveredWithCode: 1 }
  if (state === 'empty' || state === 'noMatch') return { open: [], recovered: [], lost: [], counts, summary }
  return { open, recovered, lost, counts, summary }
}

/** The harness's cart page: Ananya's cart in full, any other as its row says. */
export const sampleDetail = (id: string): CartDetail | null => {
  const cart = [...open, ...recovered, ...lost].find((c) => c.id === id)
  if (!cart) return null
  return {
    cart,
    lines: [
      { versionId: 'v1', name: cart.firstItem?.split(' · ')[0] ?? 'Linen kurta', versionName: cart.firstItem?.split(' · ')[1] ?? null, quantity: 1, lineTotal: inr('249900'), available: 3, outOfStock: false },
      ...(cart.lineCount > 1 ? [{ versionId: 'v2', name: 'Block-print dupatta', versionName: null, quantity: 1, lineTotal: inr('168100'), available: 0, outOfStock: true }] : []),
    ],
    reminders: cart.remindersSent ? [{ id: 'r1', position: 1, channel: 'email', state: 'sent', skipReason: null, sentBy: null, code: null, queuedAt: ago(121), sentAt: ago(120), clickedAt: ago(100) }] : [],
  }
}

/** The Reminders tab as a new store on the plan's automatic has it, or on "you send" for ?state=youSend. */
export const sampleSettings = (state: CartState | null): ReminderSettings | null =>
  harness && state && state !== 'loading' && state !== 'error' && state !== 'denied'
    ? {
        enabled: state !== 'youSend',
        minimum: { amount: '200000', currency: 'INR' },
        skipOutOfStock: true,
        quietHours: true,
        weeklyCap: true,
        revision: null,
        level: state === 'youSend' ? 'youSend' : 'automatic',
        steps: [
          { position: 1, enabled: true, delayMinutes: 60, channel: 'email', subject: 'You left something in your cart', body: 'We saved your cart. Pick up right where you left off.', discountPercent: null },
          { position: 2, enabled: true, delayMinutes: 1440, channel: 'whatsapp', subject: 'Still thinking it over?', body: 'Here’s a little something to help you decide.', discountPercent: 10 },
          { position: 3, enabled: true, delayMinutes: 4320, channel: 'email', subject: 'Your cart won’t be saved much longer', body: 'Popular items sell out. Your cart is still here if you want it.', discountPercent: null },
        ],
      }
    : null
