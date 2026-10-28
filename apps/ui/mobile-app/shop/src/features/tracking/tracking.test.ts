import type { Delivery } from '../../api/orders'
import { t } from '../../messages'
import { trackingOf } from './tracking'

const when = (iso: string) => `at ${iso.slice(11, 16)}`

const rider = { firstName: 'Asha', phone: '+91 98765-00000', photoUrl: '/shop-api/assets/abc', vehicleType: 'scooter', vehicleNumber: 'RJ14 0001' }
const position = { latitude: 26.91, longitude: 75.79, reportedAt: '2026-10-27T10:44:00Z' }
const steps = (...states: string[]) => states.map((state, i) => ({ state, at: `2026-10-27T10:${10 + i * 10}:00Z` }))

// What the API answers for each state, with everything it may hold: the app shows only what each state allows.
const delivery = (state: string, over: Partial<Delivery> = {}): Delivery => ({ state, steps: [], rider, position, etaAt: '2026-10-27T10:52:00Z', handoverCode: '2580', ...over })

describe('what a delivery shows in each state', () => {
  it('shows the steps alone while it is being packed or a rider is looked for', () => {
    for (const state of ['packing', 'searching', 'unassigned']) {
      const view = trackingOf(delivery(state, { rider: null, position: null, etaAt: null, handoverCode: null }), when)
      expect(view).toMatchObject({ rider: null, code: null, position: null, etaAt: null, ended: false })
    }
  })

  it('shows the rider and the handover code, but no position or arrival time, once a rider is assigned', () => {
    const view = trackingOf(delivery('assigned', { position: null, etaAt: null }), when)
    expect(view).toMatchObject({
      state: 'assigned',
      status: t('tracking.state.assigned'),
      lead: t('tracking.lead.assigned', { name: 'Asha' }),
      rider: { name: 'Asha', vehicle: `${t('tracking.vehicle.scooter')} · RJ14 0001`, phone: '+919876500000', photoUrl: '/shop-api/assets/abc' },
      code: '2580',
      position: null,
      etaAt: null,
    })
  })

  it('adds the position and the arrival time while the rider has the parcel', () => {
    const view = trackingOf(delivery('picked_up'), when)
    expect(view).toMatchObject({ state: 'picked_up', rider: { name: 'Asha' }, code: '2580', position, etaAt: '2026-10-27T10:52:00Z', ended: false })
  })

  it('shows the steps alone once it has ended, whatever a late answer still carries', () => {
    for (const state of ['delivered', 'failed', 'cancelled']) {
      const view = trackingOf(delivery(state, { steps: steps('packing', 'searching', 'assigned', 'picked_up', state) }), when)
      expect(view).toMatchObject({ rider: null, code: null, position: null, etaAt: null, ended: true })
    }
  })

  it('shows no position or arrival time before the parcel is picked up, though the API sent them', () => {
    expect(trackingOf(delivery('assigned'), when)).toMatchObject({ position: null, etaAt: null })
  })

  it('has no words for a state it does not know, rather than a guess', () => {
    expect(trackingOf(delivery('teleporting'), when)).toBeNull()
  })
})

describe('the steps', () => {
  it('run the whole journey for a delivery in progress, each with its time once reached and none for what is still to come', () => {
    const view = trackingOf(delivery('assigned', { steps: steps('packing', 'searching', 'assigned') }), when)
    expect(view?.steps.map((s) => [s.state, s.progress, s.at])).toEqual([
      ['packing', 'done', 'at 10:10'],
      ['searching', 'done', 'at 10:20'],
      ['assigned', 'current', 'at 10:30'],
      ['picked_up', 'todo', null],
      ['delivered', 'todo', null],
    ])
    expect(view?.steps.map((s) => s.progressLabel)).toEqual([t('tracking.progress.done'), t('tracking.progress.done'), t('tracking.progress.current'), t('tracking.progress.todo'), t('tracking.progress.todo')])
  })

  it('end at “Not delivered” for a failed delivery, with no “Delivered” step, and say it ended there', () => {
    const view = trackingOf(delivery('failed', { steps: steps('packing', 'searching', 'assigned', 'picked_up', 'failed') }), when)
    expect(view?.steps.map((s) => s.state)).toEqual(['packing', 'searching', 'assigned', 'picked_up', 'failed'])
    expect(view?.steps.at(-1)).toMatchObject({ stopped: true, progressLabel: t('tracking.progress.ended') })
  })

  it('stop where a cancelled delivery was', () => {
    const view = trackingOf(delivery('cancelled', { steps: steps('packing', 'searching') }), when)
    expect(view?.steps.map((s) => s.state)).toEqual(['packing', 'searching', 'cancelled'])
  })

  it('end a delivered one at “Delivered”, done', () => {
    const view = trackingOf(delivery('delivered', { steps: steps('packing', 'searching', 'assigned', 'picked_up', 'delivered') }), when)
    expect(view?.steps.at(-1)).toMatchObject({ state: 'delivered', progress: 'done', stopped: false })
  })
})

describe('the rider', () => {
  it('is dialled only from a number the engine could hold: digits, and a plus', () => {
    expect(trackingOf(delivery('assigned', { rider: { ...rider, phone: '+91 (98765) 00000' } }), when)?.rider?.phone).toBe('+919876500000')
    expect(trackingOf(delivery('assigned', { rider: { ...rider, phone: 'call me' } }), when)?.rider?.phone).toBeNull()
    expect(trackingOf(delivery('assigned', { rider: { ...rider, phone: null } }), when)?.rider?.phone).toBeNull()
  })

  it('has the vehicle as the API names it, in words for a kind the app knows and the plate alone for one it does not', () => {
    expect(trackingOf(delivery('assigned', { rider: { ...rider, vehicleType: 'hoverboard' } }), when)?.rider?.vehicle).toBe('RJ14 0001')
    expect(trackingOf(delivery('assigned', { rider: { ...rider, vehicleType: null, vehicleNumber: null } }), when)?.rider?.vehicle).toBeNull()
  })
})
