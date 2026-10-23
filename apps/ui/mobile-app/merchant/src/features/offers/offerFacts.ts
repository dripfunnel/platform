import type { Offer } from '../../api/offers'
import { formatList, formatNumber } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { countryName, dateTimeText, kindOf, orList, zoneName, type OfferNames, type RegionWords } from './offerView'

// An offer's page, "Details": each fact as a label and its words (OFFERS-DESIGN §2). The API decides every rule; this words them.

/** "Who it's for" in words, from the offer's conditions (OFFERS-DESIGN I1–I6). */
export const whoText = (offer: Offer, names: OfferNames): string => {
  const parts = offer.conditions.flatMap((c) => {
    if (c.operation === 'customer_group') return [t('offers.page.who.groups', { names: orList(c.groupIds.map((id) => names.groups.get(id) ?? t('offers.what.aGroup'))) })]
    if (c.operation === 'first_order') return [t('offers.page.who.firstOrder')]
    if (c.operation === 'specific_customers') return [t('offers.page.who.customers', { count: formatNumber(c.customerIds.length, locale) })]
    if (c.operation === 'shipping_country') return [t('offers.page.who.countries', { countries: formatList(c.countries.map(countryName), locale) })]
    return []
  })
  return parts.length ? parts.join(t('offers.joiner')) : t('offers.page.who.everyone')
}

export const offerFacts = (offer: Offer, region: RegionWords, names: OfferNames, timeZone: string): [string, string][] => {
  const zone = zoneName(timeZone)
  const combines = (['product', 'order', 'shipping'] as const).filter((k) => offer.combines[k]).map((k) => (k === 'shipping' ? region.ship : t(`offers.sentence.kinds.${k}`)))
  const unlimited = t('offers.page.details.unlimited')
  return [
    [t('offers.page.details.type'), t(`offers.kinds.${kindOf(offer.action)}`, { ship: region.ship })],
    [t('offers.page.details.how'), offer.trigger === 'automatic' ? t('offers.page.details.automatic') : t('offers.page.details.withCode', { code: region.code })],
    [t('offers.page.details.name'), offer.name],
    ...(offer.internalName ? [[t('offers.page.details.note'), offer.internalName] as [string, string]] : []),
    [t('offers.page.details.who'), whoText(offer, names)],
    [t('offers.page.details.starts'), offer.startsAt ? `${dateTimeText(offer.startsAt, timeZone)} (${zone})` : t('offers.page.details.whenOn')],
    [t('offers.page.details.ends'), offer.endsAt ? `${dateTimeText(offer.endsAt, timeZone)} (${zone})` : t('offers.page.details.noEnd')],
    [t('offers.page.details.total'), offer.totalUsesLimit ? formatNumber(offer.totalUsesLimit, locale) : unlimited],
    [t('offers.page.details.perCustomer'), offer.perCustomerLimit ? formatNumber(offer.perCustomerLimit, locale) : unlimited],
    [t('offers.page.details.combines'), combines.length ? t('offers.page.details.combinesWith', { kinds: formatList(combines, locale) }) : t('offers.page.details.combinesNothing')],
  ]
}
