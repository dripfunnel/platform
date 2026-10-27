import type { OrderDelivery } from '../../api/order'
import { actionsOf, isCashPending, reasonText, riderOpen, stepsOf, telUrl, viewOf, withRider } from './deliveryView'

const rider = { name: 'Imran Qureshi', phone: '+91 98110 22334', vehicleType: 'Bike', vehicleNumber: 'RJ14 AB 2210' }

const delivery = (over: Partial<OrderDelivery> = {}): OrderDelivery => ({
  id: 'd1',
  state: 'packing',
  failedReason: null,
  failedNote: null,
  cashCollectedAt: null,
  codeLocked: false,
  codeUnconfirmedAt: null,
  rider: null,
  steps: [],
  ...over,
})

describe('the delivery panel’s state', () => {
  it('splits a picked-up parcel by its code flags, and a recall from a failed delivery', () => {
    expect(viewOf(delivery({ state: 'picked_up' }))).toBe('picked_up')
    expect(viewOf(delivery({ state: 'picked_up', codeLocked: true }))).toBe('code_locked')
    expect(viewOf(delivery({ state: 'picked_up', codeLocked: true, codeUnconfirmedAt: '2026-10-20T10:00:00Z' }))).toBe('code_unconfirmed')
    expect(viewOf(delivery({ state: 'failed', failedReason: 'no_one_home' }))).toBe('failed')
    expect(viewOf(delivery({ state: 'failed', failedReason: 'recalled' }))).toBe('recalled')
  })

  it('offers each state only what DL 9 allows, in the prototype’s order', () => {
    expect(actionsOf.packing).toEqual(['ready', 'cancel'])
    expect(actionsOf.searching).toEqual(['cancel'])
    expect(actionsOf.unassigned).toEqual(['assign', 'again', 'cancel'])
    expect(actionsOf.assigned).toEqual(['cancel'])
    expect(actionsOf.picked_up).toEqual(['recall'])
    expect(actionsOf.code_locked).toEqual(['delivered', 'notDelivered'])
    expect(actionsOf.code_unconfirmed).toEqual(['delivered', 'notDelivered'])
    expect(actionsOf.delivered).toEqual([])
    for (const view of ['failed', 'recalled', 'cancelled'] as const) expect(actionsOf[view]).toEqual(['again'])
  })

  it('shows the rider’s phone only while they carry or are about to carry the parcel', () => {
    expect((['assigned', 'picked_up', 'code_locked', 'code_unconfirmed'] as const).every(riderOpen)).toBe(true)
    expect((['packing', 'searching', 'unassigned', 'delivered', 'failed', 'recalled', 'cancelled'] as const).some(riderOpen)).toBe(false)
    expect(withRider('searching')).toBe(false)
    expect(withRider('delivered')).toBe(true)
  })

  it('dials the number as digits, the plus kept', () => {
    expect(telUrl('+91 98110 22334')).toBe('tel:+919811022334')
    expect(telUrl('(0141) 223-3445')).toBe('tel:01412233445')
  })

  it('treats only an unpaid cash-on-delivery order as cash to collect', () => {
    expect(isCashPending({ paymentMethod: 'cod', paymentState: 'pending' })).toBe(true)
    expect(isCashPending({ paymentMethod: 'cod', paymentState: 'paid' })).toBe(false)
    expect(isCashPending({ paymentMethod: 'razorpay', paymentState: 'pending' })).toBe(false)
  })

  it('words a reason, and says “other” for one it has no words for', () => {
    expect(reasonText('no_one_home')).toBe('no one home')
    expect(reasonText('lost_keys')).toBe('other')
    expect(reasonText(null)).toBe('other')
  })
})

describe('the delivery’s steps', () => {
  it('start at the order being placed, oldest first, naming the rider who accepted', () => {
    const steps = stepsOf(
      { placedAt: '2026-10-20T08:00:00Z' },
      delivery({
        state: 'picked_up',
        rider,
        steps: [
          { deliveryId: 'd1', state: 'assigned', at: '2026-10-20T09:00:00Z' },
          { deliveryId: 'd1', state: 'packing', at: '2026-10-20T08:10:00Z' },
          { deliveryId: 'd1', state: 'picked_up', at: '2026-10-20T09:30:00Z' },
        ],
      }),
    )
    expect(steps.map((step) => step.text)).toEqual(['Order placed', 'Being packed', 'Accepted by Imran Qureshi', 'Picked up'])
  })

  it('mark an earlier attempt as one, and say a recall was the merchant’s', () => {
    const steps = stepsOf(
      { placedAt: '2026-10-20T08:00:00Z' },
      delivery({
        id: 'd2',
        state: 'failed',
        failedReason: 'recalled',
        rider,
        steps: [
          { deliveryId: 'd1', state: 'failed', at: '2026-10-20T09:00:00Z' },
          { deliveryId: 'd2', state: 'failed', at: '2026-10-20T10:00:00Z' },
        ],
      }),
    )
    expect(steps.map((step) => step.text)).toEqual(['Order placed', 'Earlier attempt · Not delivered', 'Recalled by you'])
  })

  it('give a failed delivery’s reason', () => {
    const steps = stepsOf({ placedAt: '2026-10-20T08:00:00Z' }, delivery({ state: 'failed', failedReason: 'wrong_address', steps: [{ deliveryId: 'd1', state: 'failed', at: '2026-10-20T10:00:00Z' }] }))
    expect(steps.at(-1)?.text).toBe('Not delivered: wrong address')
  })
})
