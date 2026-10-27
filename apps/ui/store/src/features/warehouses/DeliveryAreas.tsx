import { useId, useState } from 'react'
import type { Place, PlaceInput } from '../../api/stock'
import { messages, fill } from '../../messages'
import { defaultRiderKm, delivers, feeMinor, feeText, isPinned, kmText, metresOfKm, ownPlaces } from '../settings/ownDelivery'
import { moneyText } from '@dripfunnel/shared/format'

const words = messages.warehouses.delivery

/** A saved location as the API takes it back, so a delivery save never changes its name, address or pin. */
export const placeInputOfPlace = (p: Place): PlaceInput => {
  const address: PlaceInput['address'] = {}
  for (const key of ['line1', 'line2', 'city', 'region', 'postalCode', 'country'] as const) {
    const value = p.address?.[key]
    if (value) address[key] = value
  }
  return { name: p.name, address, latitude: p.latitude, longitude: p.longitude }
}

export type DeliveryPatch = Required<Pick<PlaceInput, 'ownDelivery'>> & Pick<PlaceInput, 'deliveryRadiusM' | 'riderRadiusM' | 'deliveryFeeAmount'>

const PlaceDelivery = ({ place, currency, canEdit, busy, onSave, onPin }: { place: Place; currency: string; canEdit: boolean; busy: boolean; onSave: (patch: DeliveryPatch) => void; onPin: () => void }) => {
  const id = useId()
  const pinned = isPinned(place)
  const [on, setOn] = useState(delivers(place))
  const [area, setArea] = useState(kmText(place.deliveryRadiusM))
  const [rider, setRider] = useState(place.riderRadiusM == null ? String(defaultRiderKm) : kmText(place.riderRadiusM))
  const [fee, setFee] = useState(feeText(place, currency))
  const [tried, setTried] = useState(false)

  const areaM = metresOfKm(area)
  const riderM = metresOfKm(rider)
  const feeM = feeMinor(fee, currency)
  const problem = {
    area: areaM === null || areaM === 'invalid' ? words.kmInvalid : null,
    rider: riderM === null || riderM === 'invalid' ? words.kmInvalid : null,
    fee: feeM === 'invalid' ? fill(words.feeInvalid, { example: moneyText({ amount: 4900, currency }) }) : feeM === null ? words.feeMissing : null,
  }
  const dirty = on !== delivers(place) || (on && (area !== kmText(place.deliveryRadiusM) || rider !== (place.riderRadiusM == null ? String(defaultRiderKm) : kmText(place.riderRadiusM)) || fee !== feeText(place, currency)))
  const ro = !canEdit || busy

  const reset = () => {
    setOn(delivers(place))
    setArea(kmText(place.deliveryRadiusM))
    setRider(place.riderRadiusM == null ? String(defaultRiderKm) : kmText(place.riderRadiusM))
    setFee(feeText(place, currency))
    setTried(false)
  }
  const save = () => {
    if (!on) return onSave({ ownDelivery: false })
    const first = (['area', 'rider', 'fee'] as const).find((k) => problem[k])
    if (first) {
      setTried(true)
      return document.getElementById(`${id}-${first}`)?.focus()
    }
    onSave({ ownDelivery: true, deliveryRadiusM: areaM as number, riderRadiusM: riderM as number, deliveryFeeAmount: feeM })
  }

  const field = (key: 'area' | 'rider' | 'fee', label: string, hint: string, value: string, set: (v: string) => void) => (
    <div className="df-places-field">
      <label htmlFor={`${id}-${key}`}>{label}</label>
      <input
        id={`${id}-${key}`}
        inputMode={key === 'fee' ? 'decimal' : 'numeric'}
        value={value}
        disabled={ro}
        aria-invalid={tried && problem[key] !== null}
        aria-describedby={`${id}-${key}-note`}
        onChange={(e) => set(e.target.value)}
      />
      <span id={`${id}-${key}-note`} className={tried && problem[key] ? 'df-places-problem' : 'df-places-hint'}>
        {tried && problem[key] ? problem[key] : hint}
      </span>
    </div>
  )

  return (
    <li>
      <span className="df-places-mark" aria-hidden="true">
        {place.name.slice(0, 2).toUpperCase()}
      </span>
      <span className="df-places-text">
        <strong>{place.name}</strong>
        <span>{pinned ? words.pinSet : words.pinNone}</span>
        <label className="df-ops-pick">
          <input type="checkbox" role="switch" aria-label={fill(words.switchFor, { name: place.name })} checked={on} disabled={ro || (!pinned && !on)} onChange={() => setOn(!on)} />
          <span className="df-ops-text">
            <strong>{words.switch}</strong>
            <span>{!pinned && !on ? words.pinFirst : on ? words.onNote : words.offNote}</span>
          </span>
        </label>
        {on && (
          <div className="df-places-grid">
            {field('area', words.area, words.areaHint, area, setArea)}
            {field('rider', words.rider, words.riderHint, rider, setRider)}
            {field('fee', fill(words.fee, { currency }), words.feeHint, fee, setFee)}
          </div>
        )}
        {canEdit && (
          <span className="df-places-actions">
            {!pinned && (
              <button type="button" className="df-button df-button--small" disabled={busy} aria-label={fill(words.setPinFor, { name: place.name })} onClick={onPin}>
                {words.setPin}
              </button>
            )}
            {dirty && (
              <>
                <button type="button" className="df-button df-button--small" disabled={busy} onClick={reset}>
                  {words.reset}
                </button>
                <button type="button" className="df-button df-button--small df-button--primary" disabled={busy} onClick={save}>
                  {words.save}
                </button>
              </>
            )}
          </span>
        )}
      </span>
    </li>
  )
}

/** Own delivery per location (SetOwnDelivery "warehouse", docs/api/DELIVERY.md §2): the store's own locations only, never a supplier's. */
export const DeliveryAreas = ({ places, currency, canEdit, busy, onSave, onPin }: { places: readonly Place[]; currency: string; canEdit: boolean; busy: boolean; onSave: (place: Place, patch: DeliveryPatch) => void; onPin: (place: Place) => void }) => {
  const own = ownPlaces(places)
  const id = useId()
  if (own.length === 0) return null
  return (
    <section className="df-places-theirs" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>{words.title}</h2>
      <p className="df-places-hint">{words.sub}</p>
      <ul className="df-places-list">
        {own.map((p) => (
          <PlaceDelivery key={`${p.id}:${p.revision}`} place={p} currency={currency} canEdit={canEdit} busy={busy} onSave={(patch) => onSave(p, patch)} onPin={() => onPin(p)} />
        ))}
      </ul>
    </section>
  )
}
