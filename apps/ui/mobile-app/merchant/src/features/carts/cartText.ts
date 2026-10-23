import type { AbandonedCart, CartDetail, CartMoney, CartStatus, ReminderSending, ReminderStep } from '../../api/carts'
import { formatDuration, formatList, formatMoney } from '@dripfunnel/mobile-shared/format'
import { locale, t, tryT, type MessageKey } from '../../messages'
import { tCount } from '../../messages/plural'
import { saysShipping } from '../common/region'
import type { Tone } from '../products/productView'

// How Abandoned carts words a cart (designs/Carts.dc.html, FIRST-RELEASE (store) §9): its reminder status and line, where the shopper
// left, how long ago, and what happened to it. The API decides every status; this puts it into words.

export const moneyText = (money: CartMoney): string => formatMoney(money, locale)

/** Several currencies read as a list ("₹1,000.00 and $5.00"); none reads as a dash. */
export const moneyList = (list: readonly CartMoney[]): string => (list.length ? formatList(list.map(moneyText), locale) : '—')

/** What sends a waiting cart's next reminder: the merchant, the schedule, nobody (store read-only), or not known yet. */
export type Sender = 'merchant' | 'schedule' | 'paused' | 'unknown'

/** Who sends a waiting cart's next reminder, from the switch and the plan; unknown until those are read. */
export const senderOf = (readOnly: boolean, sending: ReminderSending | null): Sender =>
  readOnly ? 'paused' : !sending ? 'unknown' : !sending.enabled || sending.level === 'youSend' ? 'merchant' : 'schedule'

// A status is a word and a colour, never colour alone (design.md §10).
export type PillTone = Tone | 'info'

export const statusTone: Record<CartStatus, PillTone> = {
  recovered: 'success',
  stopped: 'neutral',
  no_contact: 'neutral',
  opted_out: 'neutral',
  skipped: 'neutral',
  not_recovered: 'neutral',
  reminded: 'info',
  waiting: 'warning',
}

/** A cart's pill: one waiting on the schedule reads "Reminder due"; one waiting on the merchant, "Not contacted". */
export const pillOf = (cart: AbandonedCart, sender: Sender): { tone: PillTone; label: string } =>
  cart.status === 'waiting' && sender === 'schedule' ? { tone: 'info', label: t('carts.status.due') } : { tone: statusTone[cart.status], label: t(`carts.status.${cart.status}`) }

/** "25 min ago", "1 day 3 hr ago", to the minute: Hermes has no relative-time formatter, so this is the duration formatter's. */
export const agoText = (iso: string, now: Date): string => {
  const seconds = (now.getTime() - new Date(iso).getTime()) / 1000
  return seconds < 60 ? t('carts.justNow') : t('carts.ago', { duration: formatDuration(Math.floor(seconds / 60) * 60, locale) })
}

/** Where the shopper left checkout, in the region's words ("Shipping" in the US and Canada, "Delivery" elsewhere). */
export const stepText = (step: string | null, country: string | null): string =>
  step === 'pay' ? t('carts.step.pay') : step === 'ship' ? t(saysShipping(country) ? 'carts.step.shipping' : 'carts.step.delivery') : t('carts.step.contact')

export const skipText = (reason: string | null): string => (reason ? tryT(`carts.skip.${reason}`) : undefined) ?? t('carts.skip.other')

const someone = (cart: AbandonedCart): string => cart.stoppedBy ?? t('carts.someone')

/** The line under a cart's status: who stopped it and why, why it was skipped, when it was last reminded, what happens next. */
export const statusLine = (cart: AbandonedCart, now: Date, sender: Sender): string => {
  switch (cart.status) {
    case 'recovered':
      return t(cart.recoveredWithCode ? 'carts.line.recoveredCode' : 'carts.line.recovered', { number: cart.recoveredOrderNumber ?? '' })
    case 'stopped':
      return cart.stoppedNote ? t('carts.line.stoppedNote', { by: someone(cart), note: cart.stoppedNote }) : t('carts.line.stopped', { by: someone(cart) })
    case 'no_contact':
      return t('carts.line.noContact')
    case 'opted_out':
      return t('carts.line.optedOut')
    case 'skipped':
      return skipText(cart.skipReason)
    case 'not_recovered':
      return tCount('carts.line.notRecovered', cart.remindersSent)
    case 'reminded':
      return cart.lastSentAt ? t('carts.line.reminded', { ago: agoText(cart.lastSentAt, now) }) : t('carts.status.reminded')
    case 'waiting':
      return t(({ paused: 'carts.line.paused', merchant: 'carts.line.yourself', schedule: 'carts.line.scheduled', unknown: 'carts.line.waiting' } as const)[sender])
  }
}

/** Whether a reminder can still go to this cart: not bought, not stopped, and with someone to send it to. */
export const canRemind = (cart: AbandonedCart): boolean => cart.status === 'waiting' || cart.status === 'reminded'

export const itemsText = (cart: AbandonedCart): string =>
  cart.firstItem ? (cart.lineCount > 1 ? tCount('carts.items', cart.lineCount - 1, { first: cart.firstItem }) : cart.firstItem) : t('carts.noItems')

export const nameOf = (cart: Pick<AbandonedCart, 'name' | 'email'>): string => cart.name ?? cart.email ?? t('carts.guest')

// The EU and EEA, where reminders go only to shoppers who agreed to email: the API's cartReminders/rules.ts optInCountries.
const optInCountries: ReadonlySet<string> = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'IS', 'LI', 'NO'])

/** Which consent note the reminder settings show for the store's country: WhatsApp opt-in in India, email opt-in in the EU and EEA, else unsubscribe. */
export const consentNoteOf = (country: string | null): 'india' | 'optIn' | 'unsubscribe' => (country === 'IN' ? 'india' : country !== null && optInCountries.has(country) ? 'optIn' : 'unsubscribe')

export type CartEvent = { key: string; what: string; at: string | null; tone: 'past' | 'good' | 'next' }

/** "What happened": leaving, each reminder and its click, a stop, and the order that recovered it; newest first. */
export const eventsOf = ({ cart, reminders }: CartDetail, country: string | null): CartEvent[] => {
  const channel = (c: string | null) => t(c === 'whatsapp' ? 'carts.events.whatsapp' : 'carts.events.email')
  const events: CartEvent[] = [{ key: 'left', what: t('carts.events.left', { step: stepText(cart.step, country) }), at: cart.abandonedAt, tone: 'past' }]
  for (const r of reminders) {
    const which = r.position === null ? t('carts.events.byHand') : t('carts.events.numbered', { n: r.position })
    if (r.state === 'sent') {
      const what = [t('carts.events.sent', { which, channel: channel(r.channel) }), r.sentBy ? t('carts.events.by', { name: r.sentBy }) : '', r.code ? t('carts.events.code', { code: r.code }) : ''].join('')
      events.push({ key: `${r.id}-sent`, what, at: r.sentAt ?? r.queuedAt, tone: 'past' })
    } else if (r.state === 'skipped') events.push({ key: `${r.id}-skipped`, what: t('carts.events.skipped', { which, reason: skipText(r.skipReason) }), at: r.queuedAt, tone: 'past' })
    else events.push({ key: `${r.id}-queued`, what: t('carts.events.queued', { which }), at: r.queuedAt, tone: 'next' })
    if (r.clickedAt) events.push({ key: `${r.id}-clicked`, what: t('carts.events.clicked'), at: r.clickedAt, tone: 'past' })
  }
  if (cart.stoppedAt) {
    const what = cart.stoppedNote ? t('carts.events.stoppedNote', { by: someone(cart), note: cart.stoppedNote }) : t('carts.events.stopped', { by: someone(cart) })
    events.push({ key: 'stopped', what, at: cart.stoppedAt, tone: 'past' })
  }
  const dated = events.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
  return cart.recoveredOrderNumber ? [{ key: 'paid', what: t(cart.recoveredWithCode ? 'carts.events.paidCode' : 'carts.events.paid', { number: cart.recoveredOrderNumber }), at: null, tone: 'good' }, ...dated] : dated
}

/** "Only 3 left", "Out of stock now", "In stock": the line's stock today, as the API says it. */
export const stockText = (line: CartDetail['lines'][number]): string =>
  line.outOfStock ? t('carts.stock.out') : line.available !== null && line.available < 5 ? t('carts.stock.few', { count: line.available }) : t('carts.stock.in')

export const delayText = (minutes: number): string => tryT(`carts.reminders.delays.${minutes}` as MessageKey) ?? `${minutes}`

/** A reminder step's line under its title: when it goes (or that you send it yourself), by what, and its code. */
export const stepSummary = (step: ReminderStep, { locked, automatic, byHand }: { locked: boolean; automatic: boolean; byHand: boolean }): string => {
  if (locked) return t('carts.reminders.lockedStep')
  if (!step.enabled) return t('carts.reminders.stepOff')
  const when = byHand ? t('carts.reminders.byHand') : t('carts.reminders.after', { delay: delayText(step.delayMinutes) })
  const code = automatic && step.discountPercent ? t('carts.reminders.percentOff', { percent: step.discountPercent }) : null
  return [when, t(step.channel === 'whatsapp' ? 'carts.reminders.whatsapp' : 'carts.reminders.email'), code].filter(Boolean).join(' · ')
}
