import { useState } from 'react'
import { Text } from 'react-native'
import { shipItems } from '../../api/order'
import { loadSupplierPlaces, type SupplierOrder } from '../../api/supplier'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Notice } from '../common/Notice'
import { TextField } from '../common/TextField'
import { useLoad } from '../common/useLoad'
import { isHttps } from '../orders/https'
import { PickLines } from '../orders/PickLines'
import { pickedCount, pickedLines } from '../orders/picks'
import { FormSheet } from '../settings/FormSheet'
import { PickerField } from '../settings/PickerField'
import { allLeft, leftToSend, toStore } from './supplierView'

type Props = { order: SupplierOrder; store: string; client: ApiClient; onClose: () => void; onDone: () => Promise<void> }

// "Ship items" for a supplier (PortalOrders as a supplier): what goes, from which of its own locations, with the courier and tracking if it has them. A to-store
// part is sent to the store, which delivers it; a to-shopper part is the supplier's to ship. Says what it will do before it does it.
export function SupplierShipSheet({ order, store, client, onClose, onDone }: Props) {
  const { colors } = useTheme()
  const locations = useLoad(() => loadSupplierPlaces(client), [client])
  const sending = toStore(order)
  const [picks, setPicks] = useState<Record<string, number>>(() => allLeft(order))
  const [warehouse, setWarehouse] = useState<string | null>(null)
  const [courier, setCourier] = useState('')
  const [tracking, setTracking] = useState('')
  const [link, setLink] = useState('')

  const rows = order.parts.flatMap((part) => part.lines.map((line) => ({ line, max: leftToSend(line, part) })).filter((row) => row.max > 0))
  const count = pickedCount(picks)
  const places = locations.state.status === 'ready' ? locations.state.data : []
  const warehouseId = warehouse ?? places.find((place) => place.isDefault)?.id ?? places[0]?.id ?? ''
  const loaded = locations.state.status === 'ready' && places.length > 0

  const check = () => {
    if (count === 0) return t('orders.detail.ship.pickNone')
    const url = link.trim()
    if (url === '') return null
    if (!isHttps(url)) return t('orders.detail.ship.linkInvalid')
    return tracking.trim() === '' ? t('orders.detail.ship.linkNeedsNumber') : null
  }

  const submit = async () => {
    await shipItems(client, { orderId: order.id, warehouseId, lines: pickedLines(picks), courierName: courier.trim() || null, trackingNumber: tracking.trim() || null, trackingUrl: link.trim() || null })
    await onDone()
    return tCount(sending ? 'supplier.order.ship.doneToStore' : 'orders.detail.ship.done', count, { store })
  }

  return (
    <FormSheet
      title={tCount(sending ? 'supplier.order.ship.titleToStore' : 'orders.detail.ship.title', count)}
      body={sending ? t('supplier.order.ship.noteToStore', { store }) : t('supplier.order.ship.noteToShopper')}
      confirm={sending ? t('supplier.order.ship.confirmToStore') : t('orders.detail.ship.confirm')}
      context="orders"
      ready={loaded}
      check={check}
      onClose={onClose}
      onSubmit={submit}
    >
      <Text style={{ color: colors.text, fontSize: 14, fontWeight: '700' }}>{t('orders.detail.ship.items')}</Text>
      <PickLines rows={rows} picks={picks} onPick={(lineId, quantity) => setPicks((current) => ({ ...current, [lineId]: quantity }))} sub={() => null} />
      {locations.state.status === 'loading' ? <Text style={{ color: colors.muted, fontSize: 13 }}>{t('orders.detail.ship.locationLoading')}</Text> : null}
      {locations.state.status === 'error' ? <Notice kind="error" text={t('orders.detail.ship.loadFailed')} /> : null}
      {locations.state.status === 'ready' && places.length === 0 ? <Notice text={t('supplier.order.ship.noLocation')} /> : null}
      {places.length > 0 ? <PickerField label={t('orders.detail.ship.location')} value={warehouseId} options={places.map((place) => ({ value: place.id, label: place.name }))} onChange={setWarehouse} /> : null}
      <TextField label={t('orders.detail.ship.courier')} value={courier} onChangeText={setCourier} placeholder={t('orders.detail.ship.courierPlaceholder')} maxLength={80} autoCapitalize="words" />
      <TextField label={t('orders.detail.ship.tracking')} value={tracking} onChangeText={setTracking} placeholder={t('orders.detail.ship.trackingPlaceholder')} maxLength={80} help={t('orders.detail.ship.trackingHint')} />
      <TextField label={t('orders.detail.ship.link')} value={link} onChangeText={setLink} placeholder={t('orders.detail.ship.linkPlaceholder')} keyboardType="url" />
    </FormSheet>
  )
}
