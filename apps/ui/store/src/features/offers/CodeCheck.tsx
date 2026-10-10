import { isApiError } from '@dripfunnel/shared/graphql'
import { useEffect, useId, useRef, useState } from 'react'
import { checkCode, type CodeCheck as Check, type Offer } from '../../api/offers'
import { fill, formatCount, formatList, messages } from '../../messages'
import { moneyText } from '../orders/orderView'
import { dateTimeText, dayText } from './offerView'

// "Check a code a customer gives you" (B3): what a shopper typing it meets, as the API answers it (O3).

const words = messages.offers.check

type Result = { kind: 'idle' } | { kind: 'looking' } | { kind: 'failed'; message: string } | { kind: 'answered'; code: string; check: Check | null }
type Tone = 'success' | 'info' | 'warning' | 'neutral' | 'danger'

/** The answer's headline, its detail and its tone; the API's answer decides which. */
export const checkWords = (code: string, check: Check | null, timeZone: string, now: Date): { title: string; body: string; tone: Tone } => {
  if (!check) return { title: fill(words.unknown, { code }), body: words.unknownBody, tone: 'danger' }
  const offer = check.offer
  if (check.deleted || !offer) return { title: fill(words.deleted, { code: check.code }), body: words.deletedBody, tone: 'neutral' }
  const name = offer.name
  const minimum = offer.conditions.find((c) => c.operation === 'minimum_order_amount')
  switch (check.answer) {
    case 'WORKS': {
      const extras = [
        check.singleUse ? words.singleUse : '',
        offer.perCustomerLimit === 1 ? words.oncePerShopper : '',
        offer.conditions.some((c) => c.operation === 'customer_group' || c.operation === 'specific_customers') ? words.someCustomers : '',
        offer.conditions.some((c) => c.operation === 'first_order') ? words.firstOrder : '',
        minimum ? fill(words.minimum, { amount: formatList(minimum.amounts.map(moneyText)) }) : '',
      ].filter(Boolean)
      const ends = offer.endsAt ? fill(words.ends, { date: dateTimeText(offer.endsAt, timeZone) }) : ''
      return { title: fill(words.works, { code: check.code }), body: [`${name}.`, ends, ...extras].filter(Boolean).join(' '), tone: 'success' }
    }
    case 'INVALID':
      if (offer.status === 'scheduled' && offer.startsAt) return { title: fill(words.notYet, { code: check.code }), body: fill(words.notYetBody, { name, date: dateTimeText(offer.startsAt, timeZone) }), tone: 'info' }
      return { title: fill(words.off, { code: check.code }), body: fill(words.offBody, { name }), tone: 'neutral' }
    case 'EXPIRED': {
      const at = check.expiresAt && new Date(check.expiresAt) <= now ? check.expiresAt : offer.endsAt
      return { title: fill(words.expired, { code: check.code }), body: fill(words.expiredBody, { name, day: at ? dayText(at, timeZone) : '' }), tone: 'neutral' }
    }
    case 'USED_UP':
      return check.singleUse && check.usedAt
        ? { title: fill(words.usedUp, { code: check.code }), body: fill(words.usedOnce, { name, date: dateTimeText(check.usedAt, timeZone) }), tone: 'warning' }
        : { title: fill(words.usedUp, { code: check.code }), body: fill(words.usedUpBody, { name, total: formatCount(offer.totalUsesLimit ?? offer.usesCount) }), tone: 'warning' }
  }
}

/** The harness's answer, from its sample offers, as the API would give it. */
const sampleCheck = (typed: string, offers: readonly Offer[]): Check | null => {
  const offer = offers.find((o) => o.code === typed)
  if (!offer) return null
  const answer = offer.status === 'live' ? 'WORKS' : offer.status === 'ended' ? 'EXPIRED' : offer.status === 'used_up' ? 'USED_UP' : 'INVALID'
  return { code: typed, offer, deleted: false, singleUse: false, usedAt: null, expiresAt: null, answer }
}

export const CodeCheck = ({ sample, timeZone }: { sample: readonly Offer[] | null; timeZone: string }) => {
  const id = useId()
  const [code, setCode] = useState('')
  const [result, setResult] = useState<Result>({ kind: 'idle' })
  const latest = useRef(0)

  // Asked once typing pauses; only the latest code's answer is shown, whatever order the answers arrive in.
  useEffect(() => {
    const typed = code.trim().toUpperCase()
    const mine = ++latest.current
    if (typed.length < 2) return setResult({ kind: 'idle' })
    if (sample) return setResult({ kind: 'answered', code: typed, check: sampleCheck(typed, sample) })
    setResult({ kind: 'looking' })
    const timer = setTimeout(
      () =>
        void checkCode(typed).then(
          (check) => mine === latest.current && setResult({ kind: 'answered', code: typed, check }),
          (error: unknown) => mine === latest.current && setResult({ kind: 'failed', message: isApiError(error, 'RATE_LIMITED') ? words.tooMany : words.failed }),
        ),
      400,
    )
    return () => clearTimeout(timer)
  }, [code, sample])

  const answer = result.kind === 'answered' ? checkWords(result.code, result.check, timeZone, new Date()) : null
  return (
    <section className="df-offers-check" aria-labelledby={id}>
      <label className="df-offers-check-field">
        <span id={id}>{words.label}</span>
        <input value={code} onChange={(e) => setCode(e.target.value)} placeholder={words.placeholder} autoCapitalize="characters" spellCheck={false} maxLength={40} />
      </label>
      <div className="df-offers-check-answer" role="status">
        {result.kind === 'looking' && <span className="df-offers-sub">{words.looking}</span>}
        {result.kind === 'failed' && <p className="df-offers-check-result df-offers-check-result--danger">{result.message}</p>}
        {answer && (
          <div className={`df-offers-check-result df-offers-check-result--${answer.tone}`}>
            <strong>{answer.title}</strong>
            <span>{answer.body}</span>
          </div>
        )}
      </div>
    </section>
  )
}
