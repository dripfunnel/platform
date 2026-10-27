import type { Delivery } from '../../api/orders'
import { t, type MessageKey } from '../../messages'

// An own delivery as the tracking screen shows it (api/DELIVERY.md §7): the steps, and while a rider has it the rider, the handover
// code, the position and the arrival time. The API sends each only while it applies, and this shows each only in the states it
// belongs to as well, so a late answer never puts a rider or a code on a finished delivery.

const path = ['packing', 'searching', 'assigned', 'picked_up', 'delivered'] as const
export type TrackingState = (typeof path)[number] | 'failed' | 'cancelled'

const known = new Set<string>([...path, 'failed', 'cancelled'])
// Nobody took the offer yet: to the customer it is still a search.
const shown = (state: string): TrackingState | null => (state === 'unassigned' ? 'searching' : known.has(state) ? (state as TrackingState) : null)

const stateKey = {
  packing: 'tracking.state.packing',
  searching: 'tracking.state.searching',
  assigned: 'tracking.state.assigned',
  picked_up: 'tracking.state.picked_up',
  delivered: 'tracking.state.delivered',
  failed: 'tracking.state.failed',
  cancelled: 'tracking.state.cancelled',
} as const satisfies Record<TrackingState, MessageKey>

const leadKey = {
  packing: 'tracking.lead.packing',
  searching: 'tracking.lead.searching',
  assigned: 'tracking.lead.assigned',
  picked_up: 'tracking.lead.picked_up',
  delivered: 'tracking.lead.delivered',
  failed: 'tracking.lead.failed',
  cancelled: 'tracking.lead.cancelled',
} as const satisfies Record<TrackingState, MessageKey>

const progressKey = {
  done: 'tracking.progress.done',
  current: 'tracking.progress.current',
  todo: 'tracking.progress.todo',
  ended: 'tracking.progress.ended',
} as const satisfies Record<string, MessageKey>

const vehicleKey = {
  bike: 'tracking.vehicle.bike',
  scooter: 'tracking.vehicle.scooter',
  car: 'tracking.vehicle.car',
  bicycle: 'tracking.vehicle.bicycle',
  foot: 'tracking.vehicle.foot',
} as const satisfies Record<string, MessageKey>

const isVehicle = (kind: string): kind is keyof typeof vehicleKey => kind in vehicleKey

export type TrackingStep = {
  state: TrackingState
  label: string
  /** When it was reached, in the store's zone; null for a step still to come. */
  at: string | null
  progress: 'done' | 'current' | 'todo'
  /** The progress in words, so a step is never told apart by colour alone. */
  progressLabel: string
  /** A delivery that failed or was cancelled ends here, and wears the danger colour. */
  stopped: boolean
}

export type TrackingRider = { name: string; vehicle: string | null; phone: string | null; photoUrl: string | null }

export type Tracking = {
  state: TrackingState
  /** Delivered, not delivered or cancelled: nothing more than the steps is shown. */
  ended: boolean
  status: string
  lead: string
  steps: TrackingStep[]
  rider: TrackingRider | null
  code: string | null
  /** While a rider has the parcel and the API gave a position. */
  position: { latitude: number; longitude: number; reportedAt: string | null } | null
  etaAt: string | null
}

/** The number as the engine holds it (+ and digits); anything else is not dialled. */
const dialable = (phone: string | null): string | null => {
  const clean = phone?.replace(/[\s().-]/g, '') ?? ''
  return /^\+?\d{6,15}$/.test(clean) ? clean : null
}

/** The delivery as the screen shows it, or null when the API sent a state this app has no words for. */
export const trackingOf = (delivery: Delivery, when: (iso: string) => string): Tracking | null => {
  const state = shown(delivery.state)
  if (!state) return null
  const ended = state === 'delivered' || state === 'failed' || state === 'cancelled'
  const reached = new Map<TrackingState, string>()
  for (const s of delivery.steps) {
    const at = shown(s.state)
    if (at && s.at && !reached.has(at)) reached.set(at, s.at)
  }
  // The journey a delivery makes, ending where this one did: a failed one has no "Delivered", a cancelled one stops where it was.
  const last: readonly TrackingState[] = state === 'failed' ? [...path.slice(0, 4), 'failed'] : state === 'cancelled' ? [...path.filter((p) => reached.has(p) && p !== 'delivered'), 'cancelled'] : path
  const here = last.indexOf(state)
  const steps = last.map((s, i): TrackingStep => {
    const progress = i < here || (ended && i === here) ? 'done' : i === here ? 'current' : 'todo'
    const stopped = i === here && (state === 'failed' || state === 'cancelled')
    const at = reached.get(s)
    return { state: s, label: t(stateKey[s]), at: at && progress !== 'todo' ? when(at) : null, progress, progressLabel: t(progressKey[stopped ? 'ended' : progress]), stopped }
  })

  const withRider = state === 'assigned' || state === 'picked_up'
  const rider = withRider && delivery.rider ? { name: delivery.rider.firstName, vehicle: [delivery.rider.vehicleType && isVehicle(delivery.rider.vehicleType) ? t(vehicleKey[delivery.rider.vehicleType]) : null, delivery.rider.vehicleNumber].filter(Boolean).join(' · ') || null, phone: dialable(delivery.rider.phone), photoUrl: delivery.rider.photoUrl } : null
  const onTheWay = state === 'picked_up'
  return {
    state,
    ended,
    status: t(stateKey[state]),
    lead: t(leadKey[state], { name: delivery.rider?.firstName ?? '' }),
    steps,
    rider,
    code: withRider ? delivery.handoverCode : null,
    position: onTheWay ? delivery.position : null,
    etaAt: onTheWay ? delivery.etaAt : null,
  }
}
