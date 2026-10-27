import { useState } from 'react'
import { StyleSheet, Text } from 'react-native'
import { useRouter } from 'expo-router'
import type { Rider } from '../../../api/settingsRiders'
import { dispatchTimes, type ShippingSettings } from '../../../api/settingsShipping'
import type { Place } from '../../../api/settingsWarehouse'
import { formatList } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../../messages'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { Switch } from '../../common/Switch'
import { TextField } from '../../common/TextField'
import { StatusChip } from '../../products/StatusChip'
import { ChoiceRows } from '../ChoiceRows'
import { RowCard } from '../RowCard'
import { useWrite } from '../useWrite'
import { delivers, isPinned, minutesOf, missingOf, type Missing } from '../ownDelivery'
import { settingsTabHref } from '../routes'

/** What the checklist checks: the store's riders and locations, read with the shipping settings. */
export type OwnDeliveryReads = { riders: readonly Rider[]; places: readonly Place[] }

export type OwnSettings = { ownDelivery: boolean; dispatchWhen: ShippingSettings['dispatchWhen']; offerMinutes: number }

type Props = {
  server: ShippingSettings
  reads: OwnDeliveryReads
  canEdit: boolean
  /** Saves the three settings over the saved shipping; throws what the API refused. */
  save: (own: OwnSettings) => Promise<void>
}

// Settings › Shipping › Own delivery (SetOwnDelivery "shipping"; docs/api/DELIVERY.md §2): the switch with what it still needs, when riders are offered, and
// the alert time. It saves on its own, over the saved shipping, so it never carries the form's unsaved edits.
export function OwnDeliveryCard({ server, reads, canEdit, save }: Props) {
  const { colors } = useTheme()
  const router = useRouter()
  const form = useWrite('settingsShipping')
  const [on, setOn] = useState(server.ownDelivery)
  const [when, setWhen] = useState(server.dispatchWhen)
  const [minutes, setMinutes] = useState(String(server.offerMinutes))
  const [refused, setRefused] = useState<Missing[]>([])
  const [tried, setTried] = useState(false)

  const riderReady = reads.riders.some((rider) => rider.status === 'active')
  const warehouseReady = reads.places.some((place) => place.supplierId === null && delivers(place) && isPinned(place))
  const ready = riderReady && warehouseReady
  const todo = (piece: Missing, local: boolean) => !local || refused.includes(piece)
  const rows = [
    { piece: 'rider' as const, tab: 'riders', todo: todo('rider', riderReady) },
    { piece: 'warehouse' as const, tab: 'warehouse', todo: todo('warehouse', warehouseReady) },
  ]

  const minutesBad = minutesOf(minutes) === null
  const dirty = on !== server.ownDelivery || when !== server.dispatchWhen || minutes.trim() !== String(server.offerMinutes)

  const submit = async () => {
    const offerMinutes = minutesOf(minutes)
    if (offerMinutes === null) {
      setTried(true)
      return
    }
    setRefused([])
    const saved = await form.run(async () => {
      try {
        await save({ ownDelivery: on, dispatchWhen: when, offerMinutes })
      } catch (error) {
        const pieces = missingOf(error)
        if (pieces) {
          setOn(server.ownDelivery)
          setRefused(pieces)
        }
        throw error
      }
      return t('settings.shipping.own.saved')
    })
    if (saved) setTried(false)
  }

  return (
    <SectionCard title={t('settings.shipping.own.title')}>
      <StatusChip label={t(server.ownDelivery ? 'settings.shipping.own.on' : 'settings.shipping.own.off')} tone={server.ownDelivery ? 'success' : 'neutral'} />
      <Switch label={t('settings.shipping.own.switch')} value={on} disabled={!canEdit || (!ready && !on)} onChange={setOn} />
      {!on ? (
        <>
          <Text accessibilityRole="header" style={[styles.heading, { color: colors.text }]}>
            {t('settings.shipping.own.needTitle')}
          </Text>
          {rows.map((row) => (
            <RowCard
              key={row.piece}
              title={t(`settings.shipping.own.${row.piece}`)}
              sub={t(`settings.shipping.own.${row.piece}Body`)}
              status={t(row.todo ? 'settings.shipping.own.todo' : 'settings.shipping.own.done')}
              tone={row.todo ? 'wait' : 'ok'}
              onPress={row.todo ? () => router.push(settingsTabHref(row.tab) as never) : null}
              {...(row.todo ? { accessibilityLabel: t(`settings.shipping.own.${row.piece}Go`) } : {})}
            />
          ))}
          {!ready ? <Text style={[styles.note, { color: colors.muted }]}>{t('settings.shipping.own.finish')}</Text> : null}
        </>
      ) : null}
      <ChoiceRows
        label={t('settings.shipping.own.offerTitle')}
        value={when}
        disabled={!canEdit}
        onChange={setWhen}
        options={dispatchTimes.map((time) => ({ value: time, label: t(time === 'placed' ? 'settings.shipping.own.placed' : 'settings.shipping.own.ready'), sub: t(time === 'placed' ? 'settings.shipping.own.placedSub' : 'settings.shipping.own.readySub') }))}
      />
      <TextField
        label={t('settings.shipping.own.minutes')}
        value={minutes}
        onChangeText={setMinutes}
        keyboardType="number-pad"
        editable={canEdit}
        invalid={tried && minutesBad}
        help={tried && minutesBad ? t('settings.shipping.own.minutesInvalid') : undefined}
      />
      <Text style={[styles.note, { color: colors.muted }]}>{t('settings.shipping.own.note')}</Text>
      {refused.length > 0 ? <Notice kind="error" text={`${t('settings.shipping.own.problemTitle')}: ${formatList(refused.map((piece) => t(`settings.shipping.own.${piece}`)), locale)}.`} /> : null}
      {form.failure ? <Notice kind="error" text={form.failure} /> : null}
      {canEdit ? <Button saves busy={form.busy} disabled={!dirty} label={t('settings.shipping.own.save')} onPress={() => void submit()} /> : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  heading: { fontSize: 14, fontWeight: '700' },
  note: { fontSize: 13, lineHeight: 19 },
})
