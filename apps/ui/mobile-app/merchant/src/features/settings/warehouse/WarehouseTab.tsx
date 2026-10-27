import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { loadOwnDeliveryPlan } from '../../../api/settingsRiders'
import { loadShipping } from '../../../api/settingsShipping'
import { deletePlace, loadPlaces, makeDefaultPlace, savePlace, type Place } from '../../../api/settingsWarehouse'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { ApiError, isApiError } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../../messages'
import { tCount } from '../../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { moneyText } from '@dripfunnel/mobile-shared/format'
import { Button } from '../../common/Button'
import { Switch } from '../../common/Switch'
import { TextField } from '../../common/TextField'
import { useFeedback } from '../../shell/Feedback'
import { countryOptions } from '../countries'
import { openPortal } from '../portalLink'
import { dotted } from '../dotted'
import { FormSheet } from '../FormSheet'
import { PickerField } from '../PickerField'
import { RowCard } from '../RowCard'
import { TabFrame } from '../TabFrame'
import { addressLine, blankPlace, deliveryProblemOf, formOfPlace, placeInputOf, splitPlaces, type DeliveryForm, type PlaceForm } from './placeDraft'

// Settings › Warehouse (SetOps "Warehouse"; FIRST-RELEASE (store) §15): the store's own stock locations to add, edit, make the default and delete, and
// its suppliers' named apart and read-only.
export function WarehouseTab() {
  return (
    <TabFrame
      label={t('settings.tabs.warehouse')}
      load={async (client) => {
        const [places, currency] = await Promise.all([loadPlaces(client), loadDeliveryCurrency(client)])
        return { places, currency }
      }}
    >
      {({ data, client, canEdit, refresh, apply }) => (
        <PlaceList places={data.places} currency={data.currency} client={client} canEdit={canEdit} refresh={refresh} apply={(places) => apply({ ...data, places })} />
      )}
    </TabFrame>
  )
}

/** The store's currency when its plan has own delivery, which is when a location's delivery fields show. Own delivery is extra, so a failed read leaves the rest of the tab. */
const loadDeliveryCurrency = async (client: ApiClient): Promise<string | null> => {
  try {
    return (await loadOwnDeliveryPlan(client)) ? ((await loadShipping(client))?.currency ?? null) : null
  } catch {
    return null
  }
}

type Sheet = { kind: 'form'; form: PlaceForm } | { kind: 'default'; place: Place } | { kind: 'delete'; place: Place }
type Props = { places: readonly Place[]; currency: string | null; client: ApiClient; canEdit: boolean; refresh: () => Promise<void>; apply: (places: Place[]) => void }

function PlaceList({ places, currency, client, canEdit, refresh, apply }: Props) {
  const { colors } = useTheme()
  const feedback = useFeedback()
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const { own, theirs } = splitPlaces(places)
  const close = () => setSheet(null)

  const openMenu = (place: Place) =>
    feedback.menu({
      title: place.name,
      ...(addressLine(place) ? { sub: addressLine(place) } : {}),
      items: [
        ...(place.isDefault ? [] : [{ key: 'default', label: t('settings.warehouse.makeDefault'), onPress: () => setSheet({ kind: 'default', place }) }]),
        { key: 'edit', label: t('settings.warehouse.edit'), onPress: () => setSheet({ kind: 'form', form: formOfPlace(place, currency) }) },
        ...(place.isDefault
          ? []
          : [
              {
                key: 'delete',
                label: t('settings.warehouse.delete'),
                danger: true,
                onPress: () => (place.units > 0 ? feedback.toast({ message: t('settings.warehouse.holdsStock', { name: place.name, count: tCount('settings.warehouse.units', place.units) }) }) : setSheet({ kind: 'delete', place })),
              },
            ]),
      ],
    })

  return (
    <>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('settings.warehouse.title')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.warehouse.sub')}</Text>
        {canEdit ? <Button saves label={t('settings.warehouse.add')} onPress={() => setSheet({ kind: 'form', form: blankPlace })} /> : null}
      </View>
      {own.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.warehouse.empty')}</Text> : null}
      {own.map((place) => (
        <RowCard
          key={place.id}
          title={place.name}
          sub={dotted([addressLine(place), tCount('settings.warehouse.units', place.units)])}
          status={place.isDefault ? t('settings.warehouse.default') : undefined}
          tone="ok"
          onPress={canEdit ? () => openMenu(place) : null}
          accessibilityLabel={t('settings.warehouse.manage', { name: place.name })}
        />
      ))}
      {theirs.length > 0 ? (
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
            {t('settings.warehouse.theirsTitle')}
          </Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{t('settings.warehouse.theirsSub')}</Text>
          {theirs.map((place) => (
            <RowCard key={place.id} title={place.name} sub={dotted([place.supplierName ?? '', addressLine(place), tCount('settings.warehouse.units', place.units)])} />
          ))}
        </View>
      ) : null}

      {sheet?.kind === 'form' ? <PlaceSheet initial={sheet.form} currency={currency ?? ''} client={client} onClose={close} onDone={refresh} onFresh={apply} /> : null}
      {sheet?.kind === 'default' ? (
        <FormSheet
          title={t('settings.warehouse.makeDefaultTitle', { name: sheet.place.name })}
          body={t('settings.warehouse.makeDefaultBody')}
          confirm={t('settings.warehouse.makeDefault')}
          context="settingsWarehouse"
          onClose={close}
          onSubmit={async () => {
            await makeDefaultPlace(client, sheet.place.id)
            await refresh()
            return t('settings.warehouse.madeDefault', { name: sheet.place.name })
          }}
        />
      ) : null}
      {sheet?.kind === 'delete' ? (
        <FormSheet
          title={t('settings.warehouse.deleteTitle', { name: sheet.place.name })}
          body={t('settings.warehouse.deleteBody')}
          confirm={t('settings.warehouse.deleteConfirm')}
          danger
          context="settingsWarehouse"
          onClose={close}
          onSubmit={async () => {
            await deletePlace(client, sheet.place.id)
            await refresh()
            return t('settings.warehouse.deleted', { name: sheet.place.name })
          }}
        />
      ) : null}
    </>
  )
}

function PlaceSheet({ initial, currency, client, onClose, onDone, onFresh }: { initial: PlaceForm; currency: string; client: ApiClient; onClose: () => void; onDone: () => Promise<void>; onFresh: (places: Place[]) => void }) {
  const [form, setForm] = useState(initial)
  const [tried, setTried] = useState(false)
  const set = (key: keyof Omit<PlaceForm, 'id' | 'revision' | 'delivery'>, value: string) => setForm((current) => ({ ...current, [key]: value }))
  const setDelivery = (patch: Partial<DeliveryForm>) => setForm((current) => (current.delivery ? { ...current, delivery: { ...current.delivery, ...patch } } : current))
  const adding = initial.id === null
  return (
    <FormSheet
      title={adding ? t('settings.warehouse.addTitle') : t('settings.warehouse.editTitle', { name: initial.name })}
      body={adding ? t('settings.warehouse.addBody') : t('settings.warehouse.editBody')}
      confirm={adding ? t('settings.warehouse.saveAdd') : t('settings.common.save')}
      context="settingsWarehouse"
      onClose={onClose}
      check={() => {
        setTried(true)
        if (form.name.trim() === '') return t('settings.warehouse.nameMissing')
        const problem = deliveryProblemOf(form.delivery, currency)
        if (problem === null) return null
        if (problem === 'feeInvalid') return t('settings.warehouse.delivery.feeInvalid', { example: moneyText({ amount: '4900', currency }) })
        return t(problem === 'fee' ? 'settings.warehouse.delivery.feeMissing' : 'settings.warehouse.delivery.kmInvalid')
      }}
      onSubmit={async () => {
        try {
          await savePlace(client, form.id, form.revision, placeInputOf(form, currency))
        } catch (error) {
          // Someone else saved first: the list is read once and shown, and the next Save goes at their revision with what was typed kept. If that read
          // fails the sheet says the server could not be reached, never that the list is current; if the location is gone it says so.
          if (isApiError(error, 'STALE_REVISION')) {
            const fresh = await loadPlaces(client).catch(() => null)
            if (!fresh) throw new ApiError('NO_RESPONSE', 'places')
            onFresh(fresh)
            const again = fresh.find((place) => place.id === form.id)
            if (!again) throw new ApiError('NOT_FOUND', 'location')
            setForm((current) => ({ ...current, revision: again.revision }))
          }
          throw error
        }
        await onDone()
        return adding ? t('settings.warehouse.added', { name: form.name.trim() }) : t('settings.warehouse.saved')
      }}
    >
      <TextField label={t('settings.warehouse.name')} value={form.name} onChangeText={(value) => set('name', value)} placeholder={t('settings.warehouse.namePlaceholder')} autoCapitalize="words" maxLength={120} invalid={tried && form.name.trim() === ''} />
      <TextField label={t('settings.warehouse.line1')} value={form.line1} onChangeText={(value) => set('line1', value)} autoCapitalize="words" maxLength={120} />
      <TextField label={t('settings.warehouse.line2')} value={form.line2} onChangeText={(value) => set('line2', value)} autoCapitalize="words" maxLength={120} />
      <TextField label={t('settings.warehouse.city')} value={form.city} onChangeText={(value) => set('city', value)} autoCapitalize="words" maxLength={120} />
      <TextField label={t('settings.warehouse.region')} value={form.region} onChangeText={(value) => set('region', value)} autoCapitalize="words" maxLength={120} />
      <TextField label={t('settings.warehouse.postalCode')} value={form.postalCode} onChangeText={(value) => set('postalCode', value)} maxLength={120} />
      <PickerField label={t('settings.warehouse.country')} value={form.country} options={[{ value: '', label: t('settings.warehouse.noCountry') }, ...countryOptions()]} onChange={(value) => set('country', value)} searchable />
      {form.delivery ? <DeliveryFields delivery={form.delivery} currency={currency} tried={tried} onChange={setDelivery} /> : null}
    </FormSheet>
  )
}

// A location's own-delivery fields (SetOwnDelivery "warehouse"; docs/api/DELIVERY.md §2): the switch needs a map pin, which is set on the web (#815).
function DeliveryFields({ delivery, currency, tried, onChange }: { delivery: DeliveryForm; currency: string; tried: boolean; onChange: (patch: Partial<DeliveryForm>) => void }) {
  const { colors } = useTheme()
  const problem = deliveryProblemOf(delivery, currency)
  return (
    <View style={styles.delivery}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('settings.warehouse.delivery.title')}
      </Text>
      <Text style={[styles.sub, { color: colors.muted }]}>{delivery.pinned ? t('settings.warehouse.delivery.pinSet') : `${t('settings.warehouse.delivery.pinNone')}. ${t('settings.warehouse.delivery.pinNote')}`}</Text>
      {delivery.pinned ? null : <Button kind="secondary" label={t('settings.warehouse.delivery.setPinOnWeb')} onPress={() => void openPortal('/settings/warehouse')} />}
      <Switch label={t('settings.warehouse.delivery.switch')} value={delivery.on} disabled={!delivery.pinned && !delivery.on} onChange={(on) => onChange({ on })} />
      <Text style={[styles.sub, { color: colors.muted }]}>{!delivery.pinned && !delivery.on ? t('settings.warehouse.delivery.pinFirst') : t(delivery.on ? 'settings.warehouse.delivery.onNote' : 'settings.warehouse.delivery.offNote')}</Text>
      {delivery.on ? (
        <>
          <TextField label={t('settings.warehouse.delivery.area')} value={delivery.area} onChangeText={(area) => onChange({ area })} keyboardType="number-pad" help={t('settings.warehouse.delivery.areaHint')} invalid={tried && problem === 'area'} />
          <TextField label={t('settings.warehouse.delivery.rider')} value={delivery.rider} onChangeText={(rider) => onChange({ rider })} keyboardType="number-pad" help={t('settings.warehouse.delivery.riderHint')} invalid={tried && problem === 'rider'} />
          <TextField label={t('settings.warehouse.delivery.fee', { currency })} value={delivery.fee} onChangeText={(fee) => onChange({ fee })} keyboardType="decimal-pad" help={t('settings.warehouse.delivery.feeHint')} invalid={tried && (problem === 'fee' || problem === 'feeInvalid')} />
        </>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  delivery: { gap: 10 },
  head: { gap: 8 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
})
