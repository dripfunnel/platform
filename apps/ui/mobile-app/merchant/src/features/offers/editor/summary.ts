import type { Offer } from '../../../api/offers'
import { formatList, minorOf, moneyText } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../../messages'
import { countryName, dateTimeText, statusKeyOf, timeLine, type RegionWords, type StatusKey } from '../offerView'
import type { OfferDraft, StoreFacts } from '../offerDraft'

// The editor's summary beside the form (OFFERS-DESIGN §1, C1): the offer in a sentence, what it will do, and the calm warnings. Words
// only: every figure is what was typed, and the API decides what it comes to.

/** A typed amount as money, formatted like every other figure (zero while nothing valid is typed). */
export const typedMoney = (text: string, currency: string): string => {
  const minor = minorOf(text, currency)
  return moneyText({ amount: typeof minor === 'string' && minor !== 'invalid' ? minor : '0', currency })
}

/** The conditions the offer needs together, for the "every condition must be met" line. */
export const andParts = (d: OfferDraft, facts: StoreFacts, marketName: string | null): string[] =>
  [
    d.minimum === 'amount' && d.minAmounts[facts.main] ? t('offers.editor.and.amount', { amount: typedMoney(d.minAmounts[facts.main] ?? '', facts.main) }) : '',
    (d.minimum === 'items' || d.minimum === 'these') && d.minQuantity ? t('offers.editor.and.items', { count: d.minQuantity }) : '',
    d.who === 'groups' ? t('offers.editor.and.group') : d.who === 'first' ? t('offers.editor.and.first') : d.who === 'customers' ? t('offers.editor.and.customers') : d.who === 'market' ? t('offers.editor.and.market', { market: marketName ?? formatList(d.countries.map(countryName), locale) }) : '',
    d.type === 'products' ? t('offers.editor.and.product') : '',
  ].filter(Boolean)

export type Outlook = { loud: string | null; warns: string[]; will: { key: StatusKey; text: string } }

type Inputs = { draft: OfferDraft; facts: StoreFacts; region: RegionWords; offer: Offer | null; startsAt: string | null; now: Date }

/** What saving will do and what to double-check first. */
export const outlookOf = ({ draft: d, facts, region, offer, startsAt, now }: Inputs): Outlook => {
  const startsLater = startsAt !== null && new Date(startsAt) > now
  const value = d.kind === 'percent' ? `${d.percent || 0}%` : typedMoney(d.amounts[facts.main] ?? '', facts.main)
  const quiet = d.trigger === 'automatic' && d.minimum === 'none' && d.who === 'all' && !d.startsAt && !d.endsAt && !d.totalUses && !d.repeat
  const loud = quiet
    ? t(d.type === 'shipping' ? (d.shipMode === 'off' ? 'offers.editor.loud.shippingOff' : 'offers.editor.loud.shipping') : `offers.editor.loud.${d.type}`, {
        value,
        ship: region.ship,
        amount: typedMoney(d.amounts[facts.main] ?? '', facts.main),
        buy: d.buyQuantity,
        get: d.getQuantity,
      })
    : null
  const warns = [
    d.kind === 'percent' && Number(d.percent) > 50 && d.type !== 'bxgy' && d.type !== 'shipping' ? t('offers.editor.warns.big', { percent: d.percent, tenth: String(Math.round(Number(d.percent) / 10)) }) : '',
    d.type === 'order' && d.kind === 'fixed' && !d.tiers.length && d.minimum === 'none' ? t('offers.editor.warns.noMinimum', { amount: value }) : '',
    d.trigger === 'code' && !d.singleUse && !d.endsAt && !d.totalUses && !d.perCustomer ? t('offers.editor.warns.openCode') : '',
  ].filter(Boolean)
  const will = offer === null ? (startsLater && startsAt ? { key: 'scheduled' as const, text: t('offers.editor.will.scheduled', { date: dateTimeText(startsAt, facts.timeZone) }) } : { key: 'live' as const, text: t('offers.editor.will.live') }) : { key: statusKeyOf(offer, now), text: timeLine(offer, now, facts.timeZone) }
  return { loud, warns, will }
}
