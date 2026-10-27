import { describe, expect, it } from 'vitest'
import { createI18n } from '../platform/i18n/i18n'
import { deliveryFields, trackingOf } from './tracking'

const { t } = createI18n('en-US')
const when = (iso: string) => `at ${iso.slice(11, 16)}`
const rider = { firstName: 'Asha', phone: '+91 97000 00001', vehicleType: 'bike', vehicleNumber: 'RJ14 0001' }
const delivery = (state: string, extra: Record<string, unknown> = {}) => ({
  state,
  steps: [
    { state: 'packing', at: '2026-10-27T10:14:00Z' },
    { state: 'searching', at: '2026-10-27T10:31:00Z' },
    { state: 'assigned', at: '2026-10-27T10:33:00Z' },
    { state: 'picked_up', at: '2026-10-27T10:40:00Z' },
  ],
  rider: null,
  handoverCode: null,
  ...extra,
})
const progress = (state: string, extra: Record<string, unknown> = {}) => trackingOf(delivery(state, extra), t, when)?.steps.map((s) => `${s.label}:${s.progress}:${s.at ?? '-'}`)

describe('the delivery on an order page', () => {
  it('asks the Shop API for no map, position or estimate', () => {
    expect(deliveryFields).toBe('delivery { state steps { state at } rider { firstName phone vehicleType vehicleNumber } handoverCode }')
    expect(deliveryFields).not.toMatch(/position|etaAt|latitude|longitude|photo/i)
  })

  it('is none for an order with no delivery, and for a state this core has no words for', () => {
    expect(trackingOf(null, t, when)).toBeNull()
    expect(trackingOf(undefined, t, when)).toBeNull()
    expect(trackingOf({ state: 'teleporting', steps: [], rider: null, handoverCode: null }, t, when)).toBeNull()
  })

  it('shows the steps reached with their times, and the ones still to come without', () => {
    expect(progress('packing')).toEqual(['Being packed:current:at 10:14', 'Looking for a rider:todo:-', 'Rider assigned:todo:-', 'On the way:todo:-', 'Delivered:todo:-'])
    expect(progress('searching')).toEqual(['Being packed:done:at 10:14', 'Looking for a rider:current:at 10:31', 'Rider assigned:todo:-', 'On the way:todo:-', 'Delivered:todo:-'])
    // Nobody took the offer yet is still a search to the customer.
    expect(trackingOf(delivery('unassigned'), t, when)?.status).toBe('Looking for a rider')
  })

  it('shows a handed-back delivery by where it is now, not by the assignment it had', () => {
    expect(progress('searching')?.[2]).toBe('Rider assigned:todo:-')
  })

  it('shows the rider and the handover code while it is assigned or on the way', () => {
    for (const state of ['assigned', 'picked_up']) {
      const tracking = trackingOf(delivery(state, { rider, handoverCode: '2580' }), t, when)
      expect(tracking?.ended).toBe(false)
      expect(tracking?.rider).toEqual({ title: 'Your delivery partner', name: 'Asha', vehicle: 'Bike · RJ14 0001', call: { href: 'tel:+919700000001', label: 'Call Asha' } })
      expect(tracking?.code).toMatchObject({ value: '2580', label: 'Handover code 2 5 8 0', title: 'Your handover code' })
      expect(tracking?.code?.hint).toContain('Give this code to your rider')
    }
    expect(trackingOf(delivery('assigned', { rider, handoverCode: '2580' }), t, when)?.lead).toBe('Asha is on the way to collect your order.')
  })

  it('shows the rider and the code in no other state, whatever the API sent', () => {
    for (const state of ['packing', 'searching', 'delivered', 'failed', 'cancelled']) {
      const tracking = trackingOf(delivery(state, { rider, handoverCode: '2580' }), t, when)
      expect(tracking?.rider).toBeNull()
      expect(tracking?.code).toBeNull()
    }
  })

  it('ends with its steps only: delivered, not delivered, or cancelled where it stopped', () => {
    expect(trackingOf(delivery('delivered'), t, when)).toMatchObject({ ended: true, status: 'Delivered', lead: 'Your order has been delivered.' })
    expect(progress('delivered')?.at(-1)).toBe('Delivered:done:-')
    const failed = trackingOf(delivery('failed'), t, when)
    expect(failed).toMatchObject({ ended: true, status: 'Not delivered' })
    expect(failed?.steps.map((s) => s.label)).toEqual(['Being packed', 'Looking for a rider', 'Rider assigned', 'On the way', 'Not delivered'])
    const cancelled = trackingOf({ ...delivery('cancelled'), steps: [{ state: 'packing', at: '2026-10-27T10:14:00Z' }, { state: 'searching', at: '2026-10-27T10:31:00Z' }] }, t, when)
    expect(cancelled?.steps.map((s) => `${s.label}:${s.progress}`)).toEqual(['Being packed:done', 'Looking for a rider:done', 'Cancelled:done'])
  })

  it('words a rider with no number, an unknown vehicle or a number that cannot be dialled without inventing anything', () => {
    const tracking = trackingOf(delivery('assigned', { rider: { firstName: 'Asha', phone: 'call the shop', vehicleType: 'hovercraft', vehicleNumber: null }, handoverCode: '1234' }), t, when)
    expect(tracking?.rider).toEqual({ title: 'Your delivery partner', name: 'Asha', vehicle: null, call: null })
    expect(trackingOf(delivery('assigned', { rider: null, handoverCode: '1234' }), t, when)?.rider).toBeNull()
  })
})
