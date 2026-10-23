import { deleteOffer, duplicateOffer, endOffer, setOfferOn, type Offer } from '../../api/offers'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { useFeedback } from '../shell/Feedback'
import { dateTimeText, statusKeyOf, zoneName } from './offerView'
import { offerRefusal } from './offerRefusal'

// Turn off, turn on, end now, duplicate and delete (OFFERS-DESIGN N2–N5), from a row's menu and the offer's page alike. Each
// destructive one restates its consequence first; the API decides whether it may happen.

export type OfferAct = 'off' | 'on' | 'end' | 'duplicate' | 'delete'
export type ActDone = { kind: 'changed' } | { kind: 'duplicated'; id: string } | { kind: 'deleted' }

/** Which acts an offer offers now: Off on an offer that's on, On on one that's off and not past its end, End before it has. */
export const actsFor = (offer: Pick<Offer, 'enabled' | 'status' | 'endsAt'>, now: Date): OfferAct[] => {
  const ended = offer.status === 'ended' || offer.status === 'used_up'
  const passed = offer.endsAt !== null && new Date(offer.endsAt) <= now
  return [...(offer.enabled ? (['off'] as const) : passed ? [] : (['on'] as const)), ...(ended || passed ? [] : (['end'] as const)), 'duplicate', 'delete']
}

type Options = {
  client: ApiClient
  timeZone: string
  onDone: (message: string, done: ActDone) => void
  /** A refusal, in the merchant's words, for the screen to show where the act began. */
  onFail: (message: string) => void
}

export function useOfferActions({ client, timeZone, onDone, onFail }: Options): { start: (offer: Offer, act: OfferAct) => void } {
  const feedback = useFeedback()

  const run = async (work: () => Promise<ActDone>, message: string) => {
    try {
      onDone(message, await work())
    } catch (error) {
      onFail(offerRefusal(error))
    }
  }

  const start = (offer: Offer, act: OfferAct) => {
    const name = offer.name
    const now = new Date()
    if (act === 'on') {
      const later = offer.startsAt !== null && new Date(offer.startsAt) > now
      void run(async () => (await setOfferOn(client, offer.id, true), { kind: 'changed' }), t(later ? 'offers.act.onLater' : 'offers.act.onNow', { name, date: offer.startsAt ? dateTimeText(offer.startsAt, timeZone) : '' }))
      return
    }
    if (act === 'duplicate') {
      void run(async () => ({ kind: 'duplicated', id: await duplicateOffer(client, offer.id) }), t('offers.act.duplicated'))
      return
    }
    const closed = statusKeyOf(offer, now)
    const body =
      act === 'off'
        ? t('offers.act.offBody')
        : act === 'end'
          ? t('offers.act.endBody', { date: dateTimeText(now.toISOString(), timeZone), zone: zoneName(timeZone) })
          : `${closed === 'ended' || closed === 'used_up' ? t('offers.act.deleteBodyEnded') : t('offers.act.deleteBody')}${offer.code ? ` ${t('offers.act.deleteCode', { code: offer.code })}` : ''}`
    feedback.sheet({
      title: t(act === 'off' ? 'offers.act.offTitle' : act === 'end' ? 'offers.act.endTitle' : 'offers.act.deleteTitle', { name }),
      body,
      confirm: t(act === 'off' ? 'offers.act.off' : act === 'end' ? 'offers.act.end' : 'offers.act.delete'),
      danger: true,
      saves: true,
      onConfirm: () =>
        act === 'off'
          ? run(async () => (await setOfferOn(client, offer.id, false), { kind: 'changed' }), t('offers.act.offDone', { name }))
          : act === 'end'
            ? run(async () => (await endOffer(client, offer.id), { kind: 'changed' }), t('offers.act.endDone', { name }))
            : run(async () => (await deleteOffer(client, offer.id), { kind: 'deleted' }), t('offers.act.deleteDone', { name })),
    })
  }

  return { start }
}

export const actLabel = (act: OfferAct): string => t(`offers.menu.${act}`)

