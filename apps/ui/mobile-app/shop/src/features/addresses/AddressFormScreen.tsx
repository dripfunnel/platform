import { useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { regionName } from '@dripfunnel/mobile-shared/format'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { accountOperation, saveAddress, type AccountRead, type Pin, type SavedAddress } from '../../api/account'
import { useShop } from '../../api/ShopContext'
import { locale, t } from '../../messages'
import { errorKey } from '../common/errors'
import { Field } from '../common/fields'
import { Button, Resource, ScreenHeader, StateMessage } from '../common/ui'
import { useAction } from '../common/useAction'
import { useOperation } from '../common/useOperation'
import { PinMap } from './PinMap'
import { addressFields, addressProblems, type Draft, type Field as FieldName, type Problem } from './rules'

const empty = (country: string): Draft => ({ name: '', line1: '', line2: '', city: '', region: '', postalCode: '', country, phone: '' })

const draftOf = (a: SavedAddress): Draft => ({ name: a.name, line1: a.line1, line2: a.line2, city: a.city, region: a.region, postalCode: a.postalCode, country: a.country, phone: a.phone })

/** What the shopper has typed, as one line for the phone's geocoder; null until there is a street and a city. */
const lookupText = (d: Draft): string | null =>
  d.line1.trim() && d.city.trim() ? [d.line1, d.line2, d.city, d.region, d.postalCode, d.country ? regionName(d.country, locale) : ''].map((part) => part.trim()).filter(Boolean).join(', ') : null

const problemText = (problem: Problem | undefined, field: FieldName): string | null =>
  problem === 'required' ? t('form.required') : problem === 'invalid' ? t(field === 'phone' ? 'form.invalidPhone' : 'form.invalidPostal') : null

function Form({ read, id }: { read: AccountRead; id: string | null }) {
  const router = useRouter()
  const { client } = useShop()
  const { colors, radii } = useTheme()
  const action = useAction()
  const existing = id ? (read.account?.addresses.find((a) => a.id === id) ?? null) : null
  const [draft, setDraft] = useState<Draft>(existing ? draftOf(existing) : empty(read.countries.length === 1 ? (read.countries[0] ?? '') : ''))
  const [pin, setPin] = useState<Pin | null>(existing?.pin ?? null)
  const [isDefault, setIsDefault] = useState(existing?.isDefault ?? (read.account?.addresses.length ?? 0) === 0)
  const [problems, setProblems] = useState<Partial<Record<FieldName | 'country' | 'pin', Problem>>>({})

  // Choosing another country changes which fields it needs, so what was typed for the old one is not carried over.
  const chooseCountry = (country: string) => setDraft({ ...empty(country), name: draft.name, phone: draft.phone })

  const save = async () => {
    const found: typeof problems = addressProblems(draft)
    if (!pin) found.pin = 'required'
    setProblems(found)
    if (Object.keys(found).length > 0) return
    const done = await action.run(() => saveAddress(client, { id, address: { ...draft, pin }, isDefault }))
    if (done) router.back()
  }

  if (id && !existing) return <StateMessage title={t('addresses.notFound.title')} body={t('addresses.notFound.body')} />

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body}>
      <PinMap pin={pin} onChange={setPin} error={problems.pin ? t('address.pinRequired') : null} addressText={lookupText(draft)} />
      <View style={styles.field}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{t('address.country')}</Text>
        {read.countries.length <= 1 ? (
          <Text style={{ color: colors.textStrong, fontSize: 16 }}>{draft.country ? regionName(draft.country, locale) : t('address.noCountries')}</Text>
        ) : (
          <View accessibilityRole="radiogroup" style={styles.countries}>
            {read.countries.map((country) => (
              <Pressable
                key={country}
                accessibilityRole="radio"
                accessibilityState={{ checked: draft.country === country }}
                accessibilityLabel={regionName(country, locale)}
                onPress={() => chooseCountry(country)}
                style={[styles.country, { borderRadius: radii.button, borderColor: draft.country === country ? colors.focus : colors.fieldBorder, backgroundColor: draft.country === country ? colors.selected : colors.surface }]}
              >
                <Text style={{ color: colors.text, fontWeight: '700' }}>{regionName(country, locale)}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {problems.country ? (
          <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 13, fontWeight: '600' }}>
            {t('form.required')}
          </Text>
        ) : null}
      </View>
      {draft.country
        ? addressFields(draft.country).map(({ field, label, optional, autoComplete }) => (
            <Field
              key={field}
              label={t(label)}
              value={draft[field]}
              onChangeText={(value) => setDraft({ ...draft, [field]: value })}
              optional={optional}
              error={problemText(problems[field], field)}
              autoComplete={autoComplete}
              keyboardType={field === 'phone' ? 'phone-pad' : 'default'}
            />
          ))
        : null}
      <View style={styles.switchRow}>
        <Text style={{ color: colors.text, fontSize: 15, flex: 1 }}>{t('address.makeDefault')}</Text>
        <Switch accessibilityLabel={t('address.makeDefault')} value={isDefault} onValueChange={setIsDefault} />
      </View>
      {action.error ? (
        <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 14 }}>
          {t(errorKey(action.error))}
        </Text>
      ) : null}
      <Button label={t('address.save')} busy={action.busy} onPress={() => void save()} />
    </ScrollView>
  )
}

// A new address, or `id`'s: the pin is required in the app, because own delivery decides by it (api/DELIVERY.md §2).
export function AddressFormScreen({ id }: { id: string | null }) {
  const router = useRouter()
  const { colors } = useTheme()
  const { state, retry } = useOperation(accountOperation())
  return (
    <View style={[styles.screen, { backgroundColor: colors.page }]}>
      <ScreenHeader title={t(id ? 'address.edit' : 'address.add')} onBack={() => (router.canGoBack() ? router.back() : router.replace('/account/addresses'))} />
      <Resource state={state} onRetry={retry} skeleton="list">
        {(read) => (read.account ? <Form read={read} id={id} /> : <StateMessage title={t('account.guest.title')} body={t('account.guest.body')} />)}
      </Resource>
    </View>
  )
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { gap: 14, padding: 16, paddingBottom: 40 },
  field: { gap: 6 },
  countries: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  country: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
})
