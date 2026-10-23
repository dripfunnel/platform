import { useState } from 'react'
import { Text } from 'react-native'
import { bookLabel, loadShipFrom, shipItems, type Order } from '../../api/order'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Notice } from '../common/Notice'
import { TextField } from '../common/TextField'
import { useLoad } from '../common/useLoad'
import { ChoiceRows } from '../settings/ChoiceRows'
import { FormSheet } from '../settings/FormSheet'
import { PickerField } from '../settings/PickerField'
import { allLeft, leftToShip } from './orderDetail'
import { courierName } from './orderView'
import { isHttps } from './https'
import { PickLines } from './PickLines'
import { pickedCount, pickedLines, supplierSub, type PickRow } from './picks'

type Props = { order: Order; client: ApiClient; couriers: readonly string[]; onClose: () => void; onDone: () => Promise<void> }

const own = 'own'

// "Ship items" (PortalOrders): what goes in the parcel, from which of the store's locations, and how: a label booked through a
// connected courier, the tracking typed by hand, or a pickup handed over. Says what it will do before it does it.
export function ShipSheet({ order, client, couriers, onClose, onDone }: Props) {
  const { colors } = useTheme()
  const locations = useLoad(() => loadShipFrom(client), [client])
  const pickup = order.shippingOption === 'pickup'
  const [picks, setPicks] = useState<Record<string, number>>(() => allLeft(order))
  const [mode, setMode] = useState<string>(couriers[0] ?? own)
  const [warehouse, setWarehouse] = useState<string | null>(null)
  const [courier, setCourier] = useState('')
  const [tracking, setTracking] = useState('')
  const [link, setLink] = useState('')

  const rows: PickRow[] = order.parts.flatMap((part) => part.lines.map((line) => ({ line, part, max: leftToShip(line, part) })).filter((row) => row.max > 0))
  const count = pickedCount(picks)
  const places = locations.state.status === 'ready' ? locations.state.data : []
  const warehouseId = warehouse ?? places.find((place) => place.isDefault)?.id ?? places[0]?.id ?? ''
  const booking = !pickup && mode !== own
  const fields = !pickup && !booking
  const loaded = locations.state.status === 'ready' && places.length > 0

  const check = () => {
    if (count === 0) return t('orders.detail.ship.pickNone')
    const url = link.trim()
    if (!fields || url === '') return null
    if (!isHttps(url)) return t('orders.detail.ship.linkInvalid')
    return tracking.trim() === '' ? t('orders.detail.ship.linkNeedsNumber') : null
  }

  const submit = async () => {
    const lines = pickedLines(picks)
    if (booking) await bookLabel(client, { orderId: order.id, warehouseId, lines, courier: mode })
    else await shipItems(client, { orderId: order.id, warehouseId, lines, courierName: fields ? courier.trim() || null : null, trackingNumber: fields ? tracking.trim() || null : null, trackingUrl: fields ? link.trim() || null : null })
    await onDone()
    const first = order.customerName?.split(' ')[0]
    if (booking) return tCount('orders.detail.ship.doneBooked', count, { courier: courierName(mode) })
    if (pickup) return tCount('orders.detail.ship.doneHanded', count)
    return first ? tCount('orders.detail.ship.doneNamed', count, { name: first }) : tCount('orders.detail.ship.done', count)
  }

  return (
    <FormSheet
      title={tCount('orders.detail.ship.title', count)}
      body={pickup ? t('orders.detail.ship.notePickup') : booking ? t('orders.detail.ship.noteBook') : t('orders.detail.ship.note')}
      confirm={pickup ? t('orders.detail.ship.confirmPickup') : booking ? t('orders.detail.ship.confirmBook') : t('orders.detail.ship.confirm')}
      context="orders"
      ready={loaded}
      check={check}
      onClose={onClose}
      onSubmit={submit}
    >
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{t('orders.detail.ship.items')}</Text>
      <PickLines rows={rows} picks={picks} onPick={(lineId, quantity) => setPicks((current) => ({ ...current, [lineId]: quantity }))} sub={supplierSub} />
      {locations.state.status === 'loading' ? <Text style={{ color: colors.muted, fontSize: 13 }}>{t('orders.detail.ship.locationLoading')}</Text> : null}
      {locations.state.status === 'error' ? <Notice kind="error" text={t('orders.detail.ship.loadFailed')} /> : null}
      {locations.state.status === 'ready' && places.length === 0 ? <Notice text={t('orders.detail.ship.noLocation')} /> : null}
      {places.length > 0 ? <PickerField label={t('orders.detail.ship.location')} value={warehouseId} options={places.map((place) => ({ value: place.id, label: place.name }))} onChange={setWarehouse} /> : null}
      {!pickup && couriers.length > 0 ? (
        <ChoiceRows
          label={t('orders.detail.ship.how')}
          value={mode}
          options={[
            ...couriers.map((provider) => ({ value: provider, label: t('orders.detail.ship.book', { courier: courierName(provider) }), sub: t('orders.detail.ship.bookSub', { courier: courierName(provider) }) })),
            { value: own, label: t('orders.detail.ship.own'), sub: t('orders.detail.ship.ownSub') },
          ]}
          onChange={setMode}
        />
      ) : null}
      {fields ? (
        <>
          <TextField label={t('orders.detail.ship.courier')} value={courier} onChangeText={setCourier} placeholder={t('orders.detail.ship.courierPlaceholder')} maxLength={80} autoCapitalize="words" />
          <TextField label={t('orders.detail.ship.tracking')} value={tracking} onChangeText={setTracking} placeholder={t('orders.detail.ship.trackingPlaceholder')} maxLength={80} help={t('orders.detail.ship.trackingHint')} />
          <TextField label={t('orders.detail.ship.link')} value={link} onChangeText={setLink} placeholder={t('orders.detail.ship.linkPlaceholder')} keyboardType="url" />
        </>
      ) : null}
    </FormSheet>
  )
}
