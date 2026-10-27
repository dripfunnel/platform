import { useId, useState } from 'react'
import type { Rider } from '../../api/riders'
import type { ShippingSettings } from '../../api/shipping'
import type { Place } from '../../api/stock'
import { dispatchTimes } from '../../api/shipping'
import { formatList, messages } from '../../messages'
import { refusalIn } from '../common/refusal'
import { delivers, isPinned, minutesOf, missingOf, ownPlaces, type Missing } from './ownDelivery'

const words = messages.settings.shipping.own
const refusalOf = refusalIn(messages.settings.shipping.refused)

export interface OwnDelivery {
  riders: Rider[]
  moreRiders: boolean
  places: Place[]
}

export interface OwnDeliveryCardProps {
  server: ShippingSettings
  own: OwnDelivery
  canEdit: boolean
  /** Saves the three own-delivery settings over the saved shipping; throws what the API refused. */
  save: (own: { ownDelivery: boolean; dispatchWhen: ShippingSettings['dispatchWhen']; offerMinutes: number }) => Promise<void>
  goTab: (tab: 'riders' | 'warehouse') => void
}

/** Settings › Shipping › Own delivery (SetOwnDelivery "shipping", docs/api/DELIVERY.md §2): the switch, when riders are offered, and what is still missing. */
export const OwnDeliveryCard = ({ server, own, canEdit, save, goTab }: OwnDeliveryCardProps) => {
  const id = useId()
  const [on, setOn] = useState(server.ownDelivery)
  const [when, setWhen] = useState(server.dispatchWhen)
  const [minutes, setMinutes] = useState(String(server.offerMinutes))
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<{ text: string; missing: Missing[] } | null>(null)
  const [tried, setTried] = useState(false)

  const riderReady = own.moreRiders || own.riders.some((r) => r.status === 'active')
  const warehouseReady = ownPlaces(own.places).some((p) => delivers(p) && isPinned(p))
  const ready = riderReady && warehouseReady
  const missing = (piece: Missing, local: boolean) => !local || refused?.missing.includes(piece) === true
  const rows = [
    { piece: 'rider' as const, label: words.rider, body: words.riderBody, go: words.riderGo, tab: 'riders' as const, todo: missing('rider', riderReady) },
    { piece: 'warehouse' as const, label: words.warehouse, body: words.warehouseBody, go: words.warehouseGo, tab: 'warehouse' as const, todo: missing('warehouse', warehouseReady) },
  ]

  const minutesBad = minutesOf(minutes) === null
  const dirty = on !== server.ownDelivery || when !== server.dispatchWhen || minutes.trim() !== String(server.offerMinutes)
  const ro = !canEdit || busy

  const submit = async () => {
    const offerMinutes = minutesOf(minutes)
    if (offerMinutes === null) {
      setTried(true)
      return document.getElementById(`${id}-minutes`)?.focus()
    }
    setBusy(true)
    setRefused(null)
    try {
      await save({ ownDelivery: on, dispatchWhen: when, offerMinutes })
    } catch (error) {
      const pieces = missingOf(error)
      if (pieces) {
        setOn(server.ownDelivery)
        setRefused({ text: words.notReady, missing: pieces })
      } else setRefused({ text: refusalOf(error), missing: [] })
    } finally {
      setBusy(false)
    }
  }

  const pieceLabels = (refused?.missing ?? []).map((m) => (m === 'plan' ? words.plan : m === 'rider' ? words.rider : words.warehouse))

  return (
    <section className="df-set-card" aria-labelledby={`${id}-title`}>
      <div className="df-ops-head">
        <h2 id={`${id}-title`}>{words.title}</h2>
        <span className={server.ownDelivery ? 'df-ops-status df-ops-status--ok' : 'df-ops-status'}>{server.ownDelivery ? words.on : words.off}</span>
      </div>
      <label className="df-ops-pick">
        <input type="checkbox" role="switch" checked={on} disabled={ro || (!ready && !on)} onChange={() => setOn(!on)} />
        <span className="df-ops-text">
          <strong>{words.switch}</strong>
        </span>
      </label>
      {!on && (
        <div role="group" aria-labelledby={`${id}-need`}>
          <h3 id={`${id}-need`}>{words.needTitle}</h3>
          <div className="df-ops-rows">
            {rows.map((r) => (
              <div key={r.piece} className="df-ops-row">
                <span className="df-ops-text">
                  <strong>{r.label}</strong>
                  <span>{r.body}</span>
                </span>
                <span className={r.todo ? 'df-ops-status df-ops-status--warn' : 'df-ops-status df-ops-status--ok'}>{r.todo ? words.todo : words.done}</span>
                {r.todo && (
                  <button type="button" className="df-button df-button--small" onClick={() => goTab(r.tab)}>
                    {r.go}
                  </button>
                )}
              </div>
            ))}
          </div>
          {!ready && <p className="df-set-lede">{words.finish}</p>}
        </div>
      )}
      <div role="radiogroup" aria-labelledby={`${id}-offer`} className="df-ops-rows">
        <h3 id={`${id}-offer`}>{words.offerTitle}</h3>
        {dispatchTimes.map((t) => (
          <div key={t} className={when === t ? 'df-ops-row df-ops-choice df-ops-choice--on' : 'df-ops-row df-ops-choice'}>
            <label className="df-ops-pick">
              <input type="radio" name={`${id}-when`} checked={when === t} disabled={ro} onChange={() => setWhen(t)} />
              <span className="df-ops-text">
                <strong>{t === 'placed' ? words.placed : words.ready}</strong>
                <span>{t === 'placed' ? words.placedSub : words.readySub}</span>
              </span>
            </label>
          </div>
        ))}
      </div>
      <div className="df-places-field">
        <label htmlFor={`${id}-minutes`}>{words.minutes}</label>
        <input
          id={`${id}-minutes`}
          inputMode="numeric"
          value={minutes}
          disabled={ro}
          aria-invalid={tried && minutesBad}
          aria-describedby={tried && minutesBad ? `${id}-minutes-problem` : undefined}
          onChange={(e) => setMinutes(e.target.value)}
        />
        {tried && minutesBad && (
          <span id={`${id}-minutes-problem`} className="df-places-problem">
            {words.minutesInvalid}
          </span>
        )}
      </div>
      <p className="df-set-lede">{words.note}</p>
      {refused && (
        <p className="df-set-failure" role="alert">
          {pieceLabels.length > 0 ? `${refused.text} ${formatList(pieceLabels)}.` : refused.text}
        </p>
      )}
      {canEdit && (
        <div className="df-set-foot">
          <span />
          <button type="button" className="df-button df-button--primary" disabled={busy || !dirty} onClick={() => void submit()}>
            {words.save}
          </button>
        </div>
      )}
    </section>
  )
}
