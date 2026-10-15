import { useState } from 'react'
import { addTracking, type OrderShipment } from '../../api/order'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { TextField } from '../common/TextField'
import { FormSheet } from '../settings/FormSheet'
import { isHttps } from './https'

type Props = { shipment: OrderShipment; client: ApiClient; onClose: () => void; onDone: () => Promise<void> }

// Tracking for a shipment sent without it: the number, the courier and a link. The shopper gets it by email.
export function TrackingSheet({ shipment, client, onClose, onDone }: Props) {
  const [number, setNumber] = useState('')
  const [courier, setCourier] = useState(shipment.courierName ?? '')
  const [link, setLink] = useState('')
  return (
    <FormSheet
      title={t('orders.detail.shipments.addTitle')}
      body={t('orders.detail.shipments.addBody')}
      confirm={t('orders.detail.shipments.save')}
      context="orders"
      onClose={onClose}
      check={() => (number.trim() === '' ? t('orders.detail.shipments.numberMissing') : link.trim() !== '' && !isHttps(link.trim()) ? t('orders.detail.ship.linkInvalid') : null)}
      onSubmit={async () => {
        await addTracking(client, shipment.id, courier.trim() || null, number.trim(), link.trim() || null)
        await onDone()
        return t('orders.detail.shipments.added')
      }}
    >
      <TextField label={t('orders.detail.shipments.number')} value={number} onChangeText={setNumber} placeholder={t('orders.detail.ship.trackingPlaceholder')} maxLength={80} />
      <TextField label={t('orders.detail.ship.courier')} value={courier} onChangeText={setCourier} placeholder={t('orders.detail.ship.courierPlaceholder')} maxLength={80} autoCapitalize="words" />
      <TextField label={t('orders.detail.ship.link')} value={link} onChangeText={setLink} placeholder={t('orders.detail.ship.linkPlaceholder')} keyboardType="url" />
    </FormSheet>
  )
}
