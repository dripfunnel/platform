import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog } from '@dripfunnel/shared/ui'
import { useState } from 'react'
import { z } from 'zod'
import { deleteOffer, duplicateOffer, endOffer, setOfferOn, type Offer } from '../../api/offers'
import { fill, formatCount, messages } from '../../messages'
import { zoneName } from '../orders/orderView'
import { dateTimeText, statusKeyOf } from './offerView'

// Turn off, turn on, end now, duplicate and delete (N2–N5), from the list's row actions and the offer's page alike.
// Each destructive one restates its consequence first; the API decides whether it may happen.

const words = messages.offers.act

const unlockSchema = z.object({ name: z.string() })

/** The API's refusal in the merchant's words; a plan's limit names the plan that lifts it, to the Owner only (U2). */
export const offerRefusal = (error: unknown, canUpgrade: boolean): string => {
  if (!isApiError(error)) return messages.offers.refused.other
  if (error.code === 'PLAN_LIMIT') {
    const plan = unlockSchema.safeParse(error.details['unlockedBy'])
    const limit = typeof error.details['limit'] === 'number' ? error.details['limit'] : null
    const head = error.details['key'] === 'live_offers' && limit !== null ? fill(messages.offers.refused.liveLimit, { count: formatCount(limit) }) : messages.offers.refused.PLAN_LIMIT
    return canUpgrade && plan.success ? `${head} ${fill(messages.offers.refused.unlock, { plan: plan.data.name })}` : `${head} ${canUpgrade ? '' : messages.offers.refused.askOwner}`.trim()
  }
  return (messages.offers.refused as Record<string, string>)[error.code] ?? messages.offers.refused.other
}

export type OfferAct = 'off' | 'on' | 'end' | 'duplicate' | 'delete'
export type ActDone = { kind: 'changed' } | { kind: 'duplicated'; id: string } | { kind: 'deleted' }

/** Which acts an offer offers now: Off on an offer that's on, On on one that's off and not past its end, End before it has. */
export const actsFor = (offer: Pick<Offer, 'enabled' | 'status' | 'endsAt'>, now: Date): OfferAct[] => {
  const ended = offer.status === 'ended' || offer.status === 'used_up'
  const passed = offer.endsAt !== null && new Date(offer.endsAt) <= now
  return [...(offer.enabled ? (['off'] as const) : passed ? [] : (['on'] as const)), ...(ended || passed ? [] : (['end'] as const)), 'duplicate', 'delete']
}

const changed = (work: () => Promise<void>) => async (): Promise<ActDone> => {
  await work()
  return { kind: 'changed' }
}

interface Asked {
  offer: Offer
  act: Exclude<OfferAct, 'on' | 'duplicate'>
}

export const useOfferActions = ({ sample, canUpgrade, timeZone, now, onDone }: { sample: boolean; canUpgrade: boolean; timeZone: string; now: () => Date; onDone: (toast: string, done: ActDone) => void }) => {
  const [asked, setAsked] = useState<Asked | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async (work: () => Promise<ActDone>, toast: string, fail: (message: string) => void) => {
    if (sample) {
      setAsked(null)
      return onDone(toast, { kind: 'changed' })
    }
    setBusy(true)
    try {
      const done = await work()
      setAsked(null)
      onDone(toast, done)
    } catch (e) {
      fail(offerRefusal(e, canUpgrade))
    } finally {
      setBusy(false)
    }
  }

  /** Starts one act: the gentle ones run at once and say how it went; the others ask first. */
  const start = (offer: Offer, act: OfferAct, fail: (message: string) => void) => {
    setError(null)
    if (act === 'on') {
      const later = offer.startsAt && new Date(offer.startsAt) > now()
      void run(changed(() => setOfferOn(offer.id, true)), fill(later ? words.onLater : words.onNow, { name: offer.name, date: offer.startsAt ? dateTimeText(offer.startsAt, timeZone) : '' }), fail)
    } else if (act === 'duplicate') void run(async () => ({ kind: 'duplicated', id: await duplicateOffer(offer.id) }), words.duplicated, fail)
    else setAsked({ offer, act })
  }

  const close = () => {
    setAsked(null)
    setError(null)
  }

  const dialog = asked
    ? (() => {
        const { offer, act } = asked
        const name = offer.name
        const live = statusKeyOf(offer, now())
        const body =
          act === 'off'
            ? words.offBody
            : act === 'end'
              ? fill(words.endBody, { date: dateTimeText(now().toISOString(), timeZone), zone: zoneName(timeZone) })
              : `${live === 'ended' || live === 'used_up' ? words.deleteBodyEnded : words.deleteBody}${offer.code ? ` ${fill(words.deleteCode, { code: offer.code })}` : ''}`
        const fail = (message: string) => setError(message)
        const confirm = () =>
          act === 'off'
            ? void run(changed(() => setOfferOn(offer.id, false)), fill(words.offDone, { name }), fail)
            : act === 'end'
              ? void run(changed(() => endOffer(offer.id)), fill(words.endDone, { name }), fail)
              : void run(async () => {
                  await deleteOffer(offer.id)
                  return { kind: 'deleted' }
                }, fill(words.deleteDone, { name }), fail)
        return (
          <ConfirmDialog
            open
            danger
            title={fill(act === 'off' ? words.offTitle : act === 'end' ? words.endTitle : words.deleteTitle, { name })}
            target={name}
            consequence={body}
            confirmLabel={act === 'off' ? words.off : act === 'end' ? words.end : words.delete}
            cancelLabel={words.cancel}
            blocked={busy ? words.working : null}
            error={error}
            onConfirm={confirm}
            onCancel={close}
          />
        )
      })()
    : null

  return { start, dialog, busy }
}
