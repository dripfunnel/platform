// @vitest-environment happy-dom
import { ApiError } from '@dripfunnel/shared/graphql'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Order, OrderDelivery as Delivery } from '../../api/order'
import type { Rider } from '../../api/riders'
import { fill, messages } from '../../messages'
import { stepsOf, viewOf, type DeliveryView } from './deliveryView'

// An own-delivery order's Delivery panel (OrderDelivery, docs/api/DELIVERY.md §3, §8; #846): the actions of each state
// for each seat, the reason Mark delivered needs, the cash question, and each refusal worded.

const w = messages.orders.detail.delivery

const api = vi.hoisted(() => ({ assignDelivery: vi.fn(), cancelDelivery: vi.fn(), markDeliveryDelivered: vi.fn(), markReadyForPickup: vi.fn(), offerDeliveryAgain: vi.fn() }))
vi.mock('../../api/order', async (actual) => ({ ...(await actual<typeof import('../../api/order')>()), ...api }))
const riderApi = vi.hoisted(() => ({ loadRiders: vi.fn() }))
vi.mock('../../api/riders', async (actual) => ({ ...(await actual<typeof import('../../api/riders')>()), ...riderApi }))

const { OrderDelivery, DeliveryWaiting } = await import('./OrderDelivery')

const rider = { name: 'Imran Qureshi', phone: '+91 98110 22334', vehicleType: 'Bike', vehicleNumber: 'RJ14 AB 2210' }
const at = (minutes: number) => new Date(Date.UTC(2026, 9, 10, 9, minutes)).toISOString()
const delivery = (state: Delivery['state'], over: Partial<Delivery> = {}): Delivery => ({
  id: 'd1',
  state,
  failedReason: null,
  failedNote: null,
  cashCollectedAt: null,
  codeLocked: false,
  codeUnconfirmedAt: null,
  rider: null,
  steps: [{ deliveryId: 'd1', state: 'packing', at: at(5) }],
  ...over,
})
const order = (over: Partial<Order> = {}): Order =>
  ({
    id: 'o1',
    number: 'KT-1042',
    state: 'placed',
    placedAt: at(0),
    paymentMethod: 'razorpay',
    paymentState: 'paid',
    total: { amount: '579600', currency: 'INR' },
    shippingOption: 'own_delivery',
    ...over,
  }) as Order

const views: Record<DeliveryView, Delivery> = {
  packing: delivery('packing'),
  searching: delivery('searching'),
  unassigned: delivery('unassigned'),
  assigned: delivery('assigned', { rider }),
  picked_up: delivery('picked_up', { rider }),
  code_locked: delivery('picked_up', { rider, codeLocked: true }),
  code_unconfirmed: delivery('picked_up', { rider, codeUnconfirmedAt: at(40) }),
  delivered: delivery('delivered', { rider }),
  failed: delivery('failed', { rider, failedReason: 'no_one_home' }),
  recalled: delivery('failed', { rider, failedReason: 'recalled' }),
  cancelled: delivery('cancelled'),
}

const actionsShown: Record<DeliveryView, string[]> = {
  packing: [w.actions.ready, w.actions.cancel],
  searching: [w.actions.cancel],
  unassigned: [w.actions.assign, w.actions.again, w.actions.cancel],
  assigned: [w.actions.cancel],
  picked_up: [w.actions.recall],
  code_locked: [w.actions.delivered, w.actions.notDelivered],
  code_unconfirmed: [w.actions.delivered, w.actions.notDelivered],
  delivered: [],
  failed: [w.actions.again],
  recalled: [w.actions.again],
  cancelled: [w.actions.again],
}

const changed = vi.fn()
const show = (d: Delivery, o: Order = order(), seat: { canAct?: boolean; canPick?: boolean; canMarkPaid?: boolean } = {}) =>
  render(<OrderDelivery order={o} delivery={d} timeZone="Asia/Kolkata" canAct={seat.canAct ?? true} canPick={seat.canPick ?? true} canMarkPaid={seat.canMarkPaid ?? true} onChanged={changed} />)

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)))
const press = async (name: string) => {
  fireEvent.click(screen.getByRole('button', { name }))
  await settle()
}
const dialog = () => within(document.querySelector('dialog[open]') as HTMLElement)
const confirm = async (name: string) => {
  fireEvent.click(dialog().getByRole('button', { name }))
  await settle()
}
const riderOf = (r: Partial<Rider> & Pick<Rider, 'id' | 'name'>): Rider => ({ phone: null, status: 'active', online: false, currentDeliveryId: null, deliveriesDone: 0, ...r })

beforeEach(() => {
  for (const fn of Object.values(api)) fn.mockResolvedValue(undefined)
  riderApi.loadRiders.mockResolvedValue({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } })
})

afterEach(() => {
  cleanup()
  vi.resetAllMocks()
  changed.mockReset()
})

describe('what the panel works out', () => {
  it('reads a parcel out as locked or unconfirmed, and a recall as its own state', () => {
    expect(viewOf(delivery('picked_up'))).toBe('picked_up')
    expect(viewOf(delivery('picked_up', { codeLocked: true }))).toBe('code_locked')
    expect(viewOf(delivery('picked_up', { codeLocked: true, codeUnconfirmedAt: at(1) }))).toBe('code_unconfirmed')
    expect(viewOf(delivery('failed', { failedReason: 'recalled' }))).toBe('recalled')
    expect(viewOf(delivery('failed', { failedReason: 'refused' }))).toBe('failed')
  })

  it('lists the steps oldest first, an earlier attempt’s marked', () => {
    const d = delivery('searching', {
      steps: [
        { deliveryId: 'd2', state: 'searching', at: at(30) },
        { deliveryId: 'd1', state: 'failed', at: at(20) },
        { deliveryId: 'd1', state: 'packing', at: at(5) },
      ],
    })
    d.id = 'd2'
    expect(stepsOf(order(), d).map((s) => s.text)).toEqual([w.steps.placed, fill(w.earlier, { step: w.steps.packing }), fill(w.earlier, { step: w.steps.failedEarlier }), w.steps.searching])
  })
})

describe('the actions of each state', () => {
  it.each(Object.entries(actionsShown) as [DeliveryView, string[]][])('%s offers %j', (view, names) => {
    show(views[view])
    const shown = screen.queryAllByRole('button').map((b) => b.textContent)
    expect(shown).toEqual(names)
    expect(document.querySelector('.df-pill')?.textContent).toBe(w.state[view].pill)
  })

  it('shows the panel read-only to a seat that can’t fulfil orders', () => {
    show(views.unassigned, order(), { canAct: false })
    expect(screen.queryAllByRole('button')).toEqual([])
    expect(screen.getByText(w.note.readOnly)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain(w.state.unassigned.title)
  })

  it('leaves Assign to the owner, who alone reads the riders, and says so', () => {
    show(views.unassigned, order(), { canPick: false })
    expect(screen.queryByRole('button', { name: w.actions.assign })).toBeNull()
    expect(screen.getByRole('button', { name: w.actions.again })).toBeTruthy()
    expect(screen.getByText(w.note.assignOwner)).toBeTruthy()
  })

  it('shows the rider’s phone only while the parcel is theirs to carry', () => {
    const { unmount } = show(views.assigned)
    expect(screen.getByRole('link', { name: fill(w.call, { name: rider.name }) }).getAttribute('href')).toBe('tel:+91 98110 22334')
    unmount()
    show(views.delivered)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByText('Imran Qureshi')).toBeTruthy()
  })

  it('says it is waiting for payment when there is no delivery yet', () => {
    render(<DeliveryWaiting />)
    expect(screen.getByText(w.waiting.title)).toBeTruthy()
  })
})

describe('steering the delivery', () => {
  it('marks it ready for pickup, and offers it again as a new attempt after a failure', async () => {
    show(views.packing)
    await press(w.actions.ready)
    await confirm(w.ready.confirm)
    expect(api.markReadyForPickup).toHaveBeenCalledWith('o1')
    expect(changed).toHaveBeenCalledWith(w.ready.done)
    cleanup()
    show(views.failed)
    await press(w.actions.again)
    expect(dialog().getByText(w.again.bodyNew)).toBeTruthy()
    await confirm(w.again.confirm)
    expect(api.offerDeliveryAgain).toHaveBeenCalledWith('d1')
  })

  it('states the consequence of cancelling before pickup and of recalling after it, each calling the same cancel', async () => {
    show(views.assigned)
    await press(w.actions.cancel)
    expect(dialog().getByText(fill(w.cancel.bodyAssigned, { name: rider.name }))).toBeTruthy()
    await confirm(w.cancel.confirm)
    expect(api.cancelDelivery).toHaveBeenCalledWith('d1')
    cleanup()
    show(views.picked_up)
    await press(w.actions.recall)
    expect(dialog().getByText(fill(w.recall.body, { name: rider.name }))).toBeTruthy()
    await confirm(w.recall.confirm)
    expect(api.cancelDelivery).toHaveBeenCalledTimes(2)
    expect(screen.getByText(w.note.picked_up)).toBeTruthy()
  })

  it('marks not delivered by recalling the parcel', async () => {
    show(views.code_locked)
    await press(w.actions.notDelivered)
    await confirm(w.notDelivered.confirm)
    expect(api.cancelDelivery).toHaveBeenCalledWith('d1')
  })
})

describe('Mark delivered', () => {
  const open = async (d: Delivery, o: Order, seat: { canMarkPaid?: boolean } = {}) => {
    show(d, o, seat)
    await press(w.actions.delivered)
  }
  const confirmButton = () => dialog().getByRole('button', { name: w.delivered.confirm }) as HTMLButtonElement
  const why = (text: string) => fireEvent.change(dialog().getByLabelText(w.delivered.reason), { target: { value: text } })

  it('needs a reason, and sends it trimmed; a prepaid order sends no cash answer', async () => {
    await open(views.code_locked, order())
    expect(confirmButton().disabled).toBe(true)
    why('   ')
    expect(confirmButton().disabled).toBe(true)
    why('  Called the customer; they have the parcel ')
    expect(confirmButton().disabled).toBe(false)
    expect(dialog().queryByLabelText(w.delivered.cash)).toBeNull()
    await confirm(w.delivered.confirm)
    expect(api.markDeliveryDelivered).toHaveBeenCalledWith('d1', 'Called the customer; they have the parcel', null)
    expect(changed).toHaveBeenCalledWith(fill(w.delivered.done, { number: 'KT-1042' }))
  })

  it('asks for cash on delivery whether it reached the store, and shows the rider’s claim', async () => {
    await open(views.code_unconfirmed, order({ paymentMethod: 'cod', paymentState: 'pending' }))
    why('Customer confirmed by phone')
    const cash = dialog().getByLabelText(w.delivered.cash) as HTMLSelectElement
    expect(cash.value).toBe('yes')
    fireEvent.change(cash, { target: { value: 'no' } })
    await confirm(w.delivered.confirm)
    expect(api.markDeliveryDelivered).toHaveBeenCalledWith('d1', 'Customer confirmed by phone', false)
  })

  it('lets only a seat that can mark orders paid say the cash reached the store', async () => {
    await open(views.code_locked, order({ paymentMethod: 'cod', paymentState: 'pending' }), { canMarkPaid: false })
    why('Spoke to them')
    const cash = dialog().getByLabelText(w.delivered.cash) as HTMLSelectElement
    expect(cash.value).toBe('no')
    fireEvent.change(cash, { target: { value: 'yes' } })
    expect(dialog().getByText(w.delivered.cashNeedsRole)).toBeTruthy()
    expect(confirmButton().disabled).toBe(true)
  })

  it('shows what the rider claimed about the cash, or that nothing was sent', () => {
    const cod = order({ paymentMethod: 'cod', paymentState: 'pending' })
    const { unmount } = show(delivery('picked_up', { rider, codeUnconfirmedAt: at(40), cashCollectedAt: at(35) }), cod)
    expect(screen.getByText(w.claimTitle)).toBeTruthy()
    expect(screen.getByText(/Cash collected: ₹5,796\.00/)).toBeTruthy()
    unmount()
    show(views.code_locked, cod)
    expect(screen.getByText(w.claimNone)).toBeTruthy()
  })
})

describe('Assign by hand', () => {
  it('offers the active riders, online first, and assigns the one picked', async () => {
    riderApi.loadRiders.mockResolvedValue({
      nodes: [riderOf({ id: 'r1', name: 'Zoya', online: false }), riderOf({ id: 'r2', name: 'Asha', online: true }), riderOf({ id: 'r3', name: 'Gone', status: 'suspended', online: true })],
      pageInfo: { hasNextPage: false, endCursor: null },
    })
    show(views.unassigned)
    await press(w.actions.assign)
    const pick = dialog().getByLabelText(w.assign.label) as HTMLSelectElement
    expect([...pick.options].map((o) => o.textContent)).toEqual([fill(w.assign.online, { name: 'Asha' }), fill(w.assign.offline, { name: 'Zoya' })])
    fireEvent.change(pick, { target: { value: 'r1' } })
    await confirm(w.assign.confirm)
    expect(api.assignDelivery).toHaveBeenCalledWith('d1', 'r1')
    expect(changed).toHaveBeenCalledWith(fill(w.assign.done, { name: 'Zoya' }))
  })

  it('says so when no rider is active, and when the riders can’t be read', async () => {
    show(views.unassigned)
    await press(w.actions.assign)
    expect(screen.getByText(w.assign.none)).toBeTruthy()
    riderApi.loadRiders.mockRejectedValue(new Error('down'))
    await press(w.actions.assign)
    expect(screen.getByText(w.assign.loadFailed)).toBeTruthy()
  })
})

describe('refusals', () => {
  const codes = Object.keys(w.refused).filter((code) => code !== 'other')

  it.each(codes)('words %s', async (code) => {
    api.cancelDelivery.mockRejectedValue(new ApiError(code, 'x'))
    show(views.assigned)
    await press(w.actions.cancel)
    await confirm(w.cancel.confirm)
    expect(within(document.querySelector('dialog') as HTMLElement).getByText((w.refused as Record<string, string>)[code] ?? '')).toBeTruthy()
    expect(changed).not.toHaveBeenCalled()
  })

  it('words any other refusal generally, and keeps the dialog open', async () => {
    api.cancelDelivery.mockRejectedValue(new Error('boom'))
    show(views.assigned)
    await press(w.actions.cancel)
    await confirm(w.cancel.confirm)
    expect(dialog().getByText(w.refused.other)).toBeTruthy()
  })
})
