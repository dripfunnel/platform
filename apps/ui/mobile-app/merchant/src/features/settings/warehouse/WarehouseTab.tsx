import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { deletePlace, loadPlaces, makeDefaultPlace, savePlace, type Place } from '../../../api/settingsWarehouse'
import type { ApiClient } from '../../../graphql'
import { isApiError } from '../../../graphql'
import { t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { tCount } from '../../../messages/plural'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { TextField } from '../../common/TextField'
import { useFeedback } from '../../shell/Feedback'
import { countryOptions } from '../countries'
import { dotted } from '../dotted'
import { FormSheet } from '../FormSheet'
import { PickerField } from '../PickerField'
import { RowCard } from '../RowCard'
import { TabFrame } from '../TabFrame'
import { addressLine, blankPlace, formOfPlace, placeInputOf, splitPlaces, type PlaceForm } from './placeDraft'

// Settings › Warehouse (SetOps "Warehouse"; FIRST-RELEASE (store) §15): the store's own stock locations to add, edit, make the default and delete, and
// its suppliers' named apart and read-only.
export function WarehouseTab() {
  return (
    <TabFrame label={t('settings.tabs.warehouse')} load={loadPlaces}>
      {({ data, client, canEdit, refresh }) => <PlaceList places={data} client={client} canEdit={canEdit} refresh={refresh} />}
    </TabFrame>
  )
}

type Sheet = { kind: 'form'; form: PlaceForm } | { kind: 'default'; place: Place } | { kind: 'delete'; place: Place }
type Props = { places: readonly Place[]; client: ApiClient; canEdit: boolean; refresh: () => Promise<void> }

function PlaceList({ places, client, canEdit, refresh }: Props) {
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
        { key: 'edit', label: t('settings.warehouse.edit'), onPress: () => setSheet({ kind: 'form', form: formOfPlace(place) }) },
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

      {sheet?.kind === 'form' ? <PlaceSheet initial={sheet.form} client={client} onClose={close} onDone={refresh} /> : null}
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

function PlaceSheet({ initial, client, onClose, onDone }: { initial: PlaceForm; client: ApiClient; onClose: () => void; onDone: () => Promise<void> }) {
  const [form, setForm] = useState(initial)
  const [tried, setTried] = useState(false)
  const set = (key: keyof Omit<PlaceForm, 'id' | 'revision'>, value: string) => setForm((current) => ({ ...current, [key]: value }))
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
        return form.name.trim() === '' ? t('settings.warehouse.nameMissing') : null
      }}
      onSubmit={async () => {
        try {
          await savePlace(client, form.id, form.revision, placeInputOf(form))
        } catch (error) {
          // Saving again would only be refused again: the sheet closes saying so, and the list reads again with their change.
          if (!isApiError(error, 'STALE_REVISION')) throw error
          await onDone()
          return errorMessage(error, 'settingsWarehouse')
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
    </FormSheet>
  )
}

const styles = StyleSheet.create({
  head: { gap: 8 },
  title: { fontSize: 17, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
})
