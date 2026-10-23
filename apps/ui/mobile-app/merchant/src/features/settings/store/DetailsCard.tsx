import { useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { assetPath, uploadPhoto } from '../../../api/products'
import { saveStoreInfo, type StoreInfo } from '../../../api/settingsStore'
import { regionName } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { Chip } from '../../common/Chip'
import { Notice } from '../../common/Notice'
import { SectionCard } from '../../common/SectionCard'
import { TextField } from '../../common/TextField'
import { fileDeps } from '../../products/files'
import { pickFromLibrary } from '../../products/pickPhoto'
import { ProductPhoto } from '../../products/ProductPhoto'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { PickerField } from '../PickerField'
import { useWrite } from '../useWrite'
import { cleanNumber, cleanPrefix, countryWords, formOf, inputOf, isDirty, problemOf, type StoreForm } from './storeDraft'
import { timeZoneList } from './timeZones'

type Props = { info: StoreInfo; client: ApiClient; canEdit: boolean }

// SetStore's first card at phone width: the store's details, its address, time zone, units, order numbers and logo. It saves on its own;
// the currencies and languages below it do too. The API checks every field again.
export function DetailsCard({ info, client, canEdit }: Props) {
  const { colors } = useTheme()
  const [saved, setSaved] = useState(() => formOf(info))
  const [form, setForm] = useState<StoreForm>(saved)
  const [tried, setTried] = useState(false)
  const [logo, setLogo] = useState<{ busy: boolean; problem: string | null }>({ busy: false, problem: null })
  const write = useWrite('settingsStore')
  const words = countryWords(info.country)
  const problem = tried ? problemOf(form) : null
  const dirty = isDirty(form, saved)
  const off = !canEdit

  const set = <K extends keyof StoreForm>(key: K, value: StoreForm[K]) => setForm((current) => ({ ...current, [key]: value }))
  const setAddress = (key: keyof StoreForm['address'], value: string) => setForm((current) => ({ ...current, address: { ...current.address, [key]: value } }))

  const save = async () => {
    setTried(true)
    if (problemOf(form) !== null) return
    const sent = { ...form, orderPrefix: form.orderPrefix.toUpperCase(), nextOrderNumber: String(Number(form.nextOrderNumber)) }
    if (await write.run(async () => (await saveStoreInfo(client, inputOf(sent)), t('settings.store.savedInfo')))) {
      setSaved(sent)
      setForm(sent)
      setTried(false)
    }
  }

  const chooseLogo = async () => {
    setLogo({ busy: true, problem: null })
    try {
      const [picked] = await pickFromLibrary(1)
      if (picked) set('logoAssetId', await uploadPhoto(fileDeps(), picked))
      setLogo({ busy: false, problem: null })
    } catch (error) {
      setLogo({ busy: false, problem: errorMessage(error, 'products') })
    }
  }

  return (
    <SectionCard title={t('settings.store.title')}>
      {write.failure ? <Notice kind="error" text={write.failure} /> : null}
      <TextField label={t('settings.store.name')} value={form.name} onChangeText={(value) => set('name', value)} editable={!off} maxLength={80} autoCapitalize="words" invalid={problem === 'nameMissing'} help={problem === 'nameMissing' ? t('settings.store.nameMissing') : t('settings.store.nameHelp')} />
      <TextField label={t('settings.store.legal')} value={form.legalName} onChangeText={(value) => set('legalName', value)} editable={!off} maxLength={200} autoCapitalize="words" help={t('settings.store.legalHelp')} />
      <TextField label={t('settings.store.description')} value={form.description} onChangeText={(value) => set('description', value)} editable={!off} maxLength={120} autoCapitalize="sentences" help={t('settings.store.descriptionHelp', { count: form.description.length })} />
      <TextField label={t('settings.store.email')} value={form.contactEmail} onChangeText={(value) => set('contactEmail', value)} editable={!off} maxLength={320} keyboardType="email-address" autoComplete="email" help={t('settings.store.emailHelp')} />
      <TextField label={t('settings.store.phone')} value={form.contactPhone} onChangeText={(value) => set('contactPhone', value)} editable={!off} maxLength={40} keyboardType="phone-pad" autoComplete="tel" />
      <TextField label={t('settings.store.street')} value={form.address.street} onChangeText={(value) => setAddress('street', value)} editable={!off} maxLength={200} autoCapitalize="words" help={t('settings.store.streetHelp')} />
      <TextField label={t('settings.store.city')} value={form.address.city} onChangeText={(value) => setAddress('city', value)} editable={!off} maxLength={200} autoCapitalize="words" />
      <TextField label={t(`settings.store.words.${words}.postal`)} value={form.address.postal} onChangeText={(value) => setAddress('postal', value)} editable={!off} maxLength={200} />
      <TextField label={t(`settings.store.words.${words}.region`)} value={form.address.region} onChangeText={(value) => setAddress('region', value)} editable={!off} maxLength={200} autoCapitalize="words" />
      <TextField label={t('settings.store.countryLabel')} value={info.country ? regionName(info.country, locale) : ''} onChangeText={() => undefined} editable={false} help={t('settings.store.countryHelp')} />
      <TextField label={t(`settings.store.words.${words}.taxId`)} value={form.taxId} onChangeText={(value) => set('taxId', value)} editable={!off} maxLength={30} autoCapitalize="characters" help={t(`settings.store.words.${words}.taxHelp`)} />
      <PickerField label={t('settings.store.timeZone')} value={form.timeZone} options={timeZoneList(form.timeZone).map((zone) => ({ value: zone, label: zone.replaceAll('_', ' ') }))} onChange={(value) => set('timeZone', value)} disabled={off} searchable help={t('settings.store.timeZoneHelp')} />

      <View style={styles.group}>
        <Text style={[styles.label, { color: colors.text }]}>{t('settings.store.units')}</Text>
        <View style={styles.chips}>
          <Chip label={t('settings.store.metric')} selected={form.unitSystem === 'metric'} disabled={off} onPress={() => set('unitSystem', 'metric')} />
          <Chip label={t('settings.store.imperial')} selected={form.unitSystem === 'imperial'} disabled={off} onPress={() => set('unitSystem', 'imperial')} />
        </View>
        <Text style={[styles.help, { color: colors.muted }]}>{t('settings.store.unitsHelp')}</Text>
      </View>

      <View style={styles.group}>
        <Text style={[styles.label, { color: colors.text }]}>{t('settings.store.orders')}</Text>
        <Text style={[styles.help, { color: colors.muted }]}>{t('settings.store.nextOrder', { number: `${form.orderPrefix.toUpperCase()}${form.nextOrderNumber}` })}</Text>
        <TextField label={t('settings.store.prefix')} value={form.orderPrefix} onChangeText={(value) => set('orderPrefix', cleanPrefix(value))} editable={!off} maxLength={6} autoCapitalize="characters" code />
        <TextField label={t('settings.store.nextNumber')} value={form.nextOrderNumber} onChangeText={(value) => set('nextOrderNumber', cleanNumber(value))} editable={!off} maxLength={9} keyboardType="number-pad" invalid={problem === 'nextMissing'} help={problem === 'nextMissing' ? t('settings.store.nextMissing') : undefined} />
      </View>

      <View style={styles.group}>
        <Text style={[styles.label, { color: colors.text }]}>{t('settings.store.logo')}</Text>
        <View style={styles.logoRow}>
          <ProductPhoto path={form.logoAssetId ? assetPath(form.logoAssetId) : null} size={72} label={t('settings.store.logo')} radius={14} />
          <Text style={[styles.help, styles.logoText, { color: logo.problem ? colors.danger : colors.muted }]}>{logo.problem ?? (form.logoAssetId !== saved.logoAssetId ? t('settings.store.logoNew') : t('settings.store.logoHelp'))}</Text>
        </View>
        {canEdit ? <Button kind="secondary" saves busy={logo.busy} label={form.logoAssetId ? t('settings.store.logoReplace') : t('settings.store.logoChoose')} onPress={() => void chooseLogo()} /> : null}
      </View>

      <Text style={[styles.help, { color: colors.muted }]}>{t('settings.store.savesCard')}</Text>
      {canEdit ? <Button saves busy={write.busy} disabled={!dirty} label={t('settings.store.saveInfo')} onPress={() => void save()} /> : null}
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  group: { gap: 8 },
  label: { fontSize: 14, fontWeight: '700' },
  help: { fontSize: 13, lineHeight: 18 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logoText: { flex: 1 },
})
