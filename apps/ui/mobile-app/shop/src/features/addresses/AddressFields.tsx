import { Pressable, StyleSheet, Text, View } from 'react-native'
import { regionName } from '@dripfunnel/mobile-shared/format'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import type { Pin } from '../../api/account'
import { locale, t } from '../../messages'
import { Field } from '../common/fields'
import { PinMap } from './PinMap'
import { addressFields, addressProblems, type Draft, type Field as FieldName, type Problem } from './rules'

export type AddressProblems = Partial<Record<FieldName | 'country' | 'pin', Problem>>

export const emptyDraft = (country: string): Draft => ({ name: '', line1: '', line2: '', city: '', region: '', postalCode: '', country, phone: '' })

export const draftOf = (a: Draft): Draft => ({ name: a.name, line1: a.line1, line2: a.line2, city: a.city, region: a.region, postalCode: a.postalCode, country: a.country, phone: a.phone })

/** What is missing or malformed in an address and its pin: the pin is required in the app, because own delivery decides by it (api/DELIVERY.md §2). */
export const checkAddress = (draft: Draft, pin: Pin | null): AddressProblems => {
  const found: AddressProblems = addressProblems(draft)
  if (!pin) found.pin = 'required'
  return found
}

/** What the shopper has typed, as one line for the phone's geocoder; null until there is a street and a city. */
const lookupText = (d: Draft): string | null =>
  d.line1.trim() && d.city.trim() ? [d.line1, d.line2, d.city, d.region, d.postalCode, d.country ? regionName(d.country, locale) : ''].map((part) => part.trim()).filter(Boolean).join(', ') : null

const problemText = (problem: Problem | undefined, field: FieldName): string | null =>
  problem === 'required' ? t('form.required') : problem === 'invalid' ? t(field === 'phone' ? 'form.invalidPhone' : 'form.invalidPostal') : null

type Props = { countries: string[]; draft: Draft; onDraft: (draft: Draft) => void; pin: Pin | null; onPin: (pin: Pin) => void; problems: AddressProblems }

/** The store's address form with its map pin, shared by the Account's addresses and checkout. The caller holds the draft and the pin. */
export function AddressFields({ countries, draft, onDraft, pin, onPin, problems }: Props) {
  const { colors, radii } = useTheme()
  // Choosing another country changes which fields it needs, so what was typed for the old one is not carried over.
  const chooseCountry = (country: string) => onDraft({ ...emptyDraft(country), name: draft.name, phone: draft.phone })

  return (
    <>
      <PinMap pin={pin} onChange={onPin} error={problems.pin ? t('address.pinRequired') : null} addressText={lookupText(draft)} />
      <View style={styles.field}>
        <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{t('address.country')}</Text>
        {countries.length <= 1 ? (
          <Text style={{ color: colors.textStrong, fontSize: 16 }}>{draft.country ? regionName(draft.country, locale) : t('address.noCountries')}</Text>
        ) : (
          <View accessibilityRole="radiogroup" style={styles.countries}>
            {countries.map((country) => (
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
              onChangeText={(value) => onDraft({ ...draft, [field]: value })}
              optional={optional}
              error={problemText(problems[field], field)}
              autoComplete={autoComplete}
              keyboardType={field === 'phone' ? 'phone-pad' : 'default'}
            />
          ))
        : null}
    </>
  )
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  countries: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  country: { minHeight: 44, paddingHorizontal: 14, justifyContent: 'center', borderWidth: 1 },
})
