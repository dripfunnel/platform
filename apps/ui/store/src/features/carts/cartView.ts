import type { StatusIconName, StatusTone } from '@dripfunnel/shared/ui'
import type { AbandonedCart, CartDetail, CartStatus } from '../../api/carts'
import { fill, formatCount, locale, messages, plural } from '../../messages'

// How Abandoned carts words a cart (designs/Carts.dc.html, FIRST-RELEASE §9): its reminder status and line, where the
// shopper left, how long ago, and what happened to it. The API decides every status; this puts it into words.

const words = messages.carts

export interface CartAccess {
  canRead: boolean
  /** Send, stop and resume reminders; save the Reminders tab (carts.write). */
  canEdit: boolean
  viewOnly: boolean
  readOnly: boolean
  canUpgrade: boolean
}

export const cartAccessOf = (forced: string | null, acting: { permissions: readonly string[] }, readOnly: boolean): CartAccess => {
  const none = { canRead: false, canEdit: false, viewOnly: false, readOnly: false, canUpgrade: false }
  if (forced === 'denied') return none
  if (forced === 'staff') return { ...none, canRead: true, viewOnly: true }
  if (forced === 'readOnly') return { ...none, canRead: true, readOnly: true, canUpgrade: true }
  if (forced) return { canRead: true, canEdit: true, viewOnly: false, readOnly: false, canUpgrade: true }
  const has = (p: string) => acting.permissions.includes(p)
  const writes = has('carts.write')
  return { canRead: has('carts.read'), canEdit: writes && !readOnly, viewOnly: has('carts.read') && !writes, readOnly, canUpgrade: has('billing') }
}

// A status is a word, an icon and a colour, never colour alone (design.md §10).
export const cartLook: Record<CartStatus, { tone: StatusTone; icon: StatusIconName }> = {
  recovered: { tone: 'success', icon: 'ok' },
  stopped: { tone: 'neutral', icon: 'ban' },
  no_contact: { tone: 'neutral', icon: 'cross' },
  opted_out: { tone: 'neutral', icon: 'ban' },
  skipped: { tone: 'neutral', icon: 'pause' },
  not_recovered: { tone: 'neutral', icon: 'cross' },
  reminded: { tone: 'info', icon: 'clock' },
  waiting: { tone: 'warning', icon: 'hour' },
}

/** A cart's pill: a cart waiting on the schedule reads "Reminder due"; one waiting on the merchant, "Not contacted". */
export const pillOf = (cart: AbandonedCart, sender: Sender): { tone: StatusTone; icon: StatusIconName; label: string } =>
  cart.status === 'waiting' && sender === 'schedule' ? { tone: 'info', icon: 'clock', label: words.status.due } : { ...cartLook[cart.status], label: words.status[cart.status] }

/** "25 minutes ago", "yesterday": how long ago, in the portal's language. */
export const agoText = (iso: string, now: Date): string => {
  const minutes = Math.round((new Date(iso).getTime() - now.getTime()) / 60_000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (Math.abs(minutes) < 60) return rtf.format(Math.min(0, minutes), 'minute')
  if (Math.abs(minutes) < 24 * 60) return rtf.format(Math.round(minutes / 60), 'hour')
  return rtf.format(Math.round(minutes / (24 * 60)), 'day')
}

/** Where the shopper left checkout, in the region's words ("Shipping" in the US, "Delivery" elsewhere). */
export const stepText = (step: string | null, country: string | null): string =>
  step === 'pay' ? words.step.pay : step === 'ship' ? (country === 'US' || country === 'CA' ? words.step.shipping : words.step.delivery) : words.step.contact

export const skipText = (reason: string | null): string => (reason && reason in words.skip ? words.skip[reason as keyof typeof words.skip] : words.skip.other)

/** What sends next while a cart waits: the merchant, or the schedule (Reminders tab). */
export type Sender = 'merchant' | 'schedule' | 'paused'

/** The line under a cart's status: who stopped it, why it was skipped, when it was last reminded, … */
export const statusLine = (cart: AbandonedCart, now: Date, sender: Sender): string => {
  switch (cart.status) {
    case 'recovered':
      return fill(cart.recoveredWithCode ? words.line.recoveredCode : words.line.recovered, { number: cart.recoveredOrderNumber ?? '' })
    case 'stopped':
      return cart.stoppedNote ? fill(words.line.stoppedNote, { by: cart.stoppedBy ?? words.someone, note: cart.stoppedNote }) : fill(words.line.stopped, { by: cart.stoppedBy ?? words.someone })
    case 'no_contact':
      return words.line.noContact
    case 'opted_out':
      return words.line.optedOut
    case 'skipped':
      return skipText(cart.skipReason)
    case 'not_recovered':
      return fill(plural(words.line.notRecovered, cart.remindersSent), { count: formatCount(cart.remindersSent) })
    case 'reminded':
      return cart.lastSentAt ? fill(words.line.reminded, { ago: agoText(cart.lastSentAt, now) }) : words.status.reminded
    case 'waiting':
      return sender === 'paused' ? words.line.paused : sender === 'merchant' ? words.line.yourself : words.line.scheduled
  }
}

/** Whether a reminder can still go to this cart: not bought, not stopped, and with someone to send it to. */
export const canRemind = (cart: AbandonedCart): boolean => cart.status === 'waiting' || cart.status === 'reminded'

export const itemsText = (cart: AbandonedCart): string =>
  cart.firstItem ? (cart.lineCount > 1 ? fill(plural(words.items, cart.lineCount - 1), { first: cart.firstItem, count: formatCount(cart.lineCount - 1) }) : cart.firstItem) : words.noItems

export interface CartEvent {
  key: string
  what: string
  at: string | null
  tone: 'past' | 'good' | 'next'
}

/** "What happened": leaving, each reminder and its click, a stop, and the order that recovered it; newest first. */
export const eventsOf = ({ cart, reminders }: CartDetail, country: string | null): CartEvent[] => {
  const w = words.events
  const channel = (c: string | null) => (c === 'whatsapp' ? w.whatsapp : w.email)
  const events: CartEvent[] = [{ key: 'left', what: fill(w.left, { step: stepText(cart.step, country) }), at: cart.abandonedAt, tone: 'past' }]
  for (const r of reminders) {
    const n = r.position === null ? w.byHand : fill(w.numbered, { n: String(r.position) })
    if (r.state === 'sent') events.push({ key: `${r.id}-sent`, what: [fill(w.sent, { which: n, channel: channel(r.channel) }), r.sentBy ? fill(w.by, { name: r.sentBy }) : '', r.code ? fill(w.code, { code: r.code }) : ''].join(''), at: r.sentAt ?? r.queuedAt, tone: 'past' })
    else if (r.state === 'skipped') events.push({ key: `${r.id}-skipped`, what: fill(w.skipped, { which: n, reason: skipText(r.skipReason) }), at: r.queuedAt, tone: 'past' })
    else events.push({ key: `${r.id}-queued`, what: fill(w.queued, { which: n }), at: r.queuedAt, tone: 'next' })
    if (r.clickedAt) events.push({ key: `${r.id}-clicked`, what: w.clicked, at: r.clickedAt, tone: 'past' })
  }
  if (cart.stoppedAt) events.push({ key: 'stopped', what: cart.stoppedNote ? fill(w.stoppedNote, { by: cart.stoppedBy ?? words.someone, note: cart.stoppedNote }) : fill(w.stopped, { by: cart.stoppedBy ?? words.someone }), at: cart.stoppedAt, tone: 'past' })
  const dated = events.sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
  return cart.recoveredOrderNumber ? [{ key: 'paid', what: fill(cart.recoveredWithCode ? w.paidCode : w.paid, { number: cart.recoveredOrderNumber }), at: null, tone: 'good' }, ...dated] : dated
}
