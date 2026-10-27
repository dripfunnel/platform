import { z } from 'zod'
import type { Translate } from '../platform/i18n/i18n'

// An own-delivery order's delivery on the order page (api/DELIVERY.md §7, "On the website"): the steps, the rider and the
// handover code, worded here so every theme says the same. Never the map, the rider's position or the arrival estimate: the
// query asks for none of them.

const text = z.string().nullable().optional()

/** What the page asks of `order.delivery`: nothing about where the rider is, or when they will arrive. */
export const deliveryFields = 'delivery { state steps { state at } rider { firstName phone vehicleType vehicleNumber } handoverCode }'

export const deliverySchema = z
  .object({
    state: text,
    steps: z.array(z.object({ state: text, at: text })).nullable().optional(),
    rider: z.object({ firstName: text, phone: text, vehicleType: text, vehicleNumber: text }).nullable().optional(),
    handoverCode: text,
  })
  .nullable()
  .optional()

const path = ['packing', 'searching', 'assigned', 'picked_up', 'delivered'] as const
export type TrackingState = (typeof path)[number] | 'failed' | 'cancelled'

const known = new Set<string>([...path, 'failed', 'cancelled'])
// Nobody took the offer yet: to the customer it is still a search.
const shown = (state: string): TrackingState | null => (state === 'unassigned' ? 'searching' : known.has(state) ? (state as TrackingState) : null)

const vehicles = new Set(['bike', 'scooter', 'car', 'bicycle', 'foot'])

export type TrackingStep = {
  state: TrackingState
  label: string
  /** When it was reached, in the store's time zone and the shopper's words; null for a step still to come. */
  at: string | null
  progress: 'done' | 'current' | 'todo'
}

export type OrderTracking = {
  state: TrackingState
  /** The delivery has ended: delivered, not delivered or cancelled. Nothing more is shown of it than the steps. */
  ended: boolean
  title: string
  /** Where it stands, and one line on what happens next. */
  status: string
  lead: string
  stepsLabel: string
  steps: TrackingStep[]
  /** Only while a rider is assigned or has the parcel. */
  rider: { title: string; name: string; vehicle: string | null; call: { href: string; label: string } | null } | null
  /** Only while a rider is assigned or has the parcel, and never in a push or an email. */
  code: { title: string; value: string; label: string; hint: string } | null
}

type Raw = NonNullable<z.infer<typeof deliverySchema>>

/** The delivery as the page shows it, or null where there is none or the API sent a state this core has no words for. */
export const trackingOf = (raw: z.infer<typeof deliverySchema>, t: Translate, when: (iso: string) => string): OrderTracking | null => {
  if (!raw?.state) return null
  const state = shown(raw.state)
  if (!state) return null
  const ended = state === 'delivered' || state === 'failed' || state === 'cancelled'
  const reached = new Map<TrackingState, string>()
  for (const s of raw.steps ?? []) {
    const at = s.state ? shown(s.state) : null
    if (at && s.at && !reached.has(at)) reached.set(at, s.at)
  }
  // The journey a delivery makes, ending where this one did: a failed one has no "Delivered", a cancelled one stops where it was.
  const last: readonly TrackingState[] = state === 'failed' ? [...path.slice(0, 4), 'failed'] : state === 'cancelled' ? [...path.filter((p) => reached.has(p) && p !== 'delivered'), 'cancelled'] : path
  const here = last.indexOf(state)
  const steps = last.map((s, i): TrackingStep => {
    const progress = i < here || (ended && i === here) ? 'done' : i === here ? 'current' : 'todo'
    const at = reached.get(s)
    return { state: s, label: t(`order.delivery.state.${s}`), at: at && progress !== 'todo' ? when(at) : null, progress }
  })

  const live = (state === 'assigned' || state === 'picked_up') && raw.rider?.firstName
  const rider = live && raw.rider ? riderOf(raw.rider, t) : null
  const code = (state === 'assigned' || state === 'picked_up') && raw.handoverCode ? { title: t('order.delivery.code.title'), value: raw.handoverCode, label: t('order.delivery.code.label', { code: raw.handoverCode.split('').join(' ') }), hint: t('order.delivery.code.hint') } : null
  return {
    state,
    ended,
    title: t('order.delivery.title'),
    status: t(`order.delivery.state.${state}`),
    lead: t(`order.delivery.lead.${state}`, { name: raw.rider?.firstName ?? '' }),
    stepsLabel: t('order.delivery.steps'),
    steps,
    rider,
    code,
  }
}

const riderOf = (r: NonNullable<Raw['rider']>, t: Translate): NonNullable<OrderTracking['rider']> => {
  const name = r.firstName ?? ''
  const vehicle = [r.vehicleType && vehicles.has(r.vehicleType) ? t(`order.delivery.vehicle.${r.vehicleType}`) : null, r.vehicleNumber].filter(Boolean).join(' · ') || null
  // The number as the engine holds it (+ and digits); anything else is not dialled.
  const phone = r.phone?.replace(/[\s().-]/g, '') ?? ''
  return { title: t('order.delivery.rider'), name, vehicle, call: /^\+?\d{6,15}$/.test(phone) ? { href: `tel:${phone}`, label: t('order.delivery.call', { name }) } : null }
}
