import type { AbandonedCart, CartDetail, ReminderStep } from '../../api/carts'
import { agoText, canRemind, consentNoteOf, eventsOf, itemsText, moneyList, pillOf, senderOf, skipText, statusLine, stepSummary, stepText } from './cartText'

const cart = (over: Partial<AbandonedCart> = {}): AbandonedCart => ({
  id: 'ab-1',
  name: 'Vikram Shah',
  email: 'vikram@example.in',
  phone: null,
  customerId: null,
  value: { amount: '249900', currency: 'INR' },
  step: 'pay',
  abandonedAt: '2026-10-19T10:00:00.000Z',
  status: 'waiting',
  skipReason: null,
  firstItem: 'Silk saree',
  lineCount: 1,
  remindersSent: 0,
  lastSentAt: null,
  stoppedAt: null,
  stoppedBy: null,
  stoppedNote: null,
  recoveredOrderId: null,
  recoveredOrderNumber: null,
  recoveredWithCode: false,
  ...over,
})

const now = new Date('2026-10-19T10:25:00.000Z')

describe('who sends the next reminder', () => {
  it('is the merchant on youSend or with automatic sending off, the schedule otherwise, nobody in a read-only store', () => {
    expect(senderOf(false, { enabled: true, level: 'automatic' })).toBe('schedule')
    expect(senderOf(false, { enabled: true, level: 'onePerCart' })).toBe('schedule')
    expect(senderOf(false, { enabled: true, level: 'youSend' })).toBe('merchant')
    expect(senderOf(false, { enabled: false, level: 'automatic' })).toBe('merchant')
    expect(senderOf(true, { enabled: true, level: 'automatic' })).toBe('paused')
    expect(senderOf(false, null)).toBe('unknown')
  })
})

describe('a cart’s pill and line', () => {
  it('reads "Reminder due" for a waiting cart on the schedule and "Not contacted" while the merchant sends', () => {
    expect(pillOf(cart(), 'schedule')).toEqual({ tone: 'info', label: 'Reminder due' })
    expect(pillOf(cart(), 'merchant')).toEqual({ tone: 'warning', label: 'Not contacted' })
    expect(statusLine(cart(), now, 'schedule')).toBe('Goes by itself on your schedule')
    expect(statusLine(cart(), now, 'merchant')).toBe('Send a reminder yourself')
    expect(statusLine(cart(), now, 'paused')).toBe('Reminders paused')
    expect(statusLine(cart(), now, 'unknown')).toBe('No reminder sent yet')
  })

  it('names every other status by the API’s word, never one worked out here', () => {
    expect(pillOf(cart({ status: 'recovered' }), 'schedule')).toEqual({ tone: 'success', label: 'Recovered' })
    expect(pillOf(cart({ status: 'reminded' }), 'schedule')).toEqual({ tone: 'info', label: 'Reminded' })
    expect(pillOf(cart({ status: 'stopped' }), 'schedule')).toEqual({ tone: 'neutral', label: 'Stopped' })
  })

  it('says who stopped a cart and why, why one was skipped, and what a recovered one paid', () => {
    expect(statusLine(cart({ status: 'stopped', stoppedBy: 'Farhan Ali', stoppedNote: 'She called' }), now, 'schedule')).toBe('By Farhan Ali · She called')
    expect(statusLine(cart({ status: 'stopped' }), now, 'schedule')).toBe('By Someone')
    expect(statusLine(cart({ status: 'skipped', skipReason: 'under_minimum' }), now, 'schedule')).toBe('Under your minimum cart value')
    expect(skipText('a_reason_nobody_named')).toBe('No reminder was sent')
    expect(statusLine(cart({ status: 'recovered', recoveredOrderNumber: 'KT-2848', recoveredWithCode: true }), now, 'schedule')).toBe('Paid · order KT-2848 · with a reminder code')
    expect(statusLine(cart({ status: 'not_recovered', remindersSent: 2 }), now, 'schedule')).toBe('2 reminders sent')
    expect(statusLine(cart({ status: 'not_recovered', remindersSent: 1 }), now, 'schedule')).toBe('1 reminder sent')
    expect(statusLine(cart({ status: 'reminded', lastSentAt: '2026-10-19T08:25:00.000Z' }), now, 'schedule')).toBe('Last sent 2 hr ago')
  })

  it('says how long ago, down to "Just now"', () => {
    expect(agoText('2026-10-19T10:00:00.000Z', now)).toBe('25 min ago')
    expect(agoText('2026-10-19T10:24:40.000Z', now)).toBe('Just now')
    expect(agoText('2026-10-17T07:25:00.000Z', now)).toBe('2 days 3 hr ago')
  })

  it('says where they left in the region’s word', () => {
    expect(stepText('pay', 'IN')).toBe('Payment')
    expect(stepText('ship', 'US')).toBe('Shipping')
    expect(stepText('ship', 'IN')).toBe('Delivery')
    expect(stepText(null, 'IN')).toBe('Contact details')
  })

  it('shows the first item and how many more', () => {
    expect(itemsText(cart())).toBe('Silk saree')
    expect(itemsText(cart({ lineCount: 3 }))).toBe('Silk saree + 2 more')
    expect(itemsText(cart({ firstItem: null }))).toBe('—')
  })

  it('offers a reminder only to a cart that is waiting or was reminded', () => {
    expect(['waiting', 'reminded'].every((status) => canRemind(cart({ status: status as AbandonedCart['status'] })))).toBe(true)
    expect(['recovered', 'stopped', 'no_contact', 'opted_out', 'skipped', 'not_recovered'].some((status) => canRemind(cart({ status: status as AbandonedCart['status'] })))).toBe(false)
  })

  it('lists money in each currency it came in', () => {
    expect(moneyList([])).toBe('—')
    expect(moneyList([{ amount: '100000', currency: 'INR' }, { amount: '500', currency: 'USD' }])).toBe('₹1,000.00 and $5.00')
  })
})

describe('what happened', () => {
  const detail = (over: Partial<CartDetail> = {}): CartDetail => ({
    cart: cart({ status: 'recovered', recoveredOrderNumber: 'KT-2848', recoveredWithCode: true, stoppedAt: '2026-10-19T12:30:00.000Z', stoppedBy: 'Farhan Ali', stoppedNote: 'Resumed later' }),
    lines: [],
    reminders: [
      { id: 'r1', position: 1, channel: 'email', state: 'sent', skipReason: null, sentBy: null, code: null, queuedAt: '2026-10-19T10:59:00.000Z', sentAt: '2026-10-19T11:00:00.000Z', clickedAt: '2026-10-19T11:30:00.000Z' },
      { id: 'r2', position: null, channel: 'email', state: 'sent', skipReason: null, sentBy: 'Farhan Ali', code: 'SAVE10', queuedAt: '2026-10-19T12:00:00.000Z', sentAt: '2026-10-19T12:01:00.000Z', clickedAt: null },
      { id: 'r3', position: 2, channel: 'whatsapp', state: 'skipped', skipReason: 'weekly_cap', sentBy: null, code: null, queuedAt: '2026-10-19T13:00:00.000Z', sentAt: null, clickedAt: null },
      { id: 'r4', position: 3, channel: 'email', state: 'queued', skipReason: null, sentBy: null, code: null, queuedAt: '2026-10-19T14:00:00.000Z', sentAt: null, clickedAt: null },
    ],
    ...over,
  })

  it('lists the order first, then leaving, each reminder and its click, and a stop, newest first', () => {
    expect(eventsOf(detail(), 'IN').map((event) => event.what)).toEqual([
      'Paid · order KT-2848 with a reminder code',
      'Reminder 3 on its way',
      'Reminder 2 not sent: Reminded about another cart this week',
      'Reminders stopped by Farhan Ali — Resumed later',
      'A reminder sent by email (by Farhan Ali) · code SAVE10',
      'Came back to the cart',
      'Reminder 1 sent by email',
      'Left checkout at Payment',
    ])
  })

  it('has no order line for a cart that wasn’t bought', () => {
    const events = eventsOf(detail({ cart: cart(), reminders: [] }), 'IN')
    expect(events.map((event) => event.what)).toEqual(['Left checkout at Payment'])
  })
})

describe('a reminder step’s line', () => {
  const step = (over: Partial<ReminderStep> = {}): ReminderStep => ({ position: 2, enabled: true, delayMinutes: 1440, channel: 'whatsapp', subject: 'Hi', body: 'Hello', discountPercent: 10, ...over })

  it('says when, by what and with which code', () => {
    expect(stepSummary(step(), { locked: false, automatic: true, byHand: false })).toBe('1 day after they leave · WhatsApp · 10% off')
    expect(stepSummary(step({ position: 1, channel: 'email', discountPercent: null }), { locked: false, automatic: false, byHand: true })).toBe('Used when you send a reminder yourself · Email')
  })

  it('says a step is off or locked, and shows no code below automatic', () => {
    expect(stepSummary(step({ enabled: false }), { locked: false, automatic: true, byHand: false })).toBe('Off')
    expect(stepSummary(step(), { locked: true, automatic: false, byHand: false })).toBe('Automatic follow-ups are on a bigger plan')
    expect(stepSummary(step({ channel: 'email' }), { locked: false, automatic: false, byHand: false })).toBe('1 day after they leave · Email')
  })
})

describe('the consent note', () => {
  it('is WhatsApp opt-in in India, email opt-in in the EU and EEA, and the unsubscribe link elsewhere', () => {
    expect(consentNoteOf('IN')).toBe('india')
    expect(consentNoteOf('DE')).toBe('optIn')
    expect(consentNoteOf('NO')).toBe('optIn')
    expect(consentNoteOf('US')).toBe('unsubscribe')
    expect(consentNoteOf(null)).toBe('unsubscribe')
  })
})
