import { useState } from 'react'
import { FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { t } from '../../messages'
import { TextButton } from '../common/ui'
import { countries, dialOf, flagOf, type CountryIso } from './phone'

const byName = [...countries].sort((a, b) => t(`countries.${a.iso}`).localeCompare(t(`countries.${b.iso}`)))

type Props = { value: CountryIso | null; onChange: (country: CountryIso) => void }

/** The country code as a dropdown: the chosen flag and code, and a list of countries with their flags to choose from. */
export function CountryPicker({ value, onChange }: Props) {
  const { colors, radii, controlHeight } = useTheme()
  const [open, setOpen] = useState(false)
  const label = value ? `${t('signIn.phone.countryCode')}: ${t(`countries.${value}`)} +${dialOf(value)}` : `${t('signIn.phone.countryCode')}: ${t('signIn.phone.chooseCountry')}`

  return (
    <View style={styles.field}>
      <Text style={{ color: colors.text, fontSize: 13, fontWeight: '700' }}>{t('signIn.phone.countryCode')}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={[styles.trigger, { minHeight: controlHeight + 8, borderRadius: radii.button, borderColor: colors.fieldBorder, backgroundColor: colors.surface }]}
      >
        <Text style={{ color: colors.text, fontSize: 16 }}>{value ? `${flagOf(value)} +${dialOf(value)}` : t('signIn.phone.select')}</Text>
        <Text aria-hidden style={{ color: colors.muted, fontSize: 12 }}>
          ▼
        </Text>
      </Pressable>

      <Modal transparent animationType="slide" visible={open} onRequestClose={() => setOpen(false)}>
        <View style={[styles.backdrop, { backgroundColor: colors.backdrop }]}>
          <View accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.surface, borderTopLeftRadius: radii.sheet, borderTopRightRadius: radii.sheet }]}>
            <View style={styles.head}>
              <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
                {t('signIn.phone.chooseCountry')}
              </Text>
              <TextButton label={t('common.close')} onPress={() => setOpen(false)} />
            </View>
            <FlatList
              data={byName}
              initialNumToRender={byName.length}
              keyExtractor={(country) => country.iso}
              renderItem={({ item }) => {
                const chosen = item.iso === value
                return (
                  <Pressable
                    accessibilityRole="radio"
                    accessibilityLabel={`${t(`countries.${item.iso}`)} +${item.dial}`}
                    accessibilityState={{ checked: chosen }}
                    onPress={() => {
                      onChange(item.iso)
                      setOpen(false)
                    }}
                    style={[styles.row, { backgroundColor: chosen ? colors.selected : colors.surface, borderColor: colors.border }]}
                  >
                    <Text style={styles.flag}>{flagOf(item.iso)}</Text>
                    <Text style={{ flex: 1, color: colors.text, fontSize: 16 }}>{t(`countries.${item.iso}`)}</Text>
                    <Text style={{ color: colors.muted, fontSize: 16 }}>{`+${item.dial}`}</Text>
                  </Pressable>
                )
              }}
            />
          </View>
        </View>
      </Modal>
    </View>
  )
}

const styles = StyleSheet.create({
  field: { gap: 6 },
  trigger: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderWidth: 1, paddingHorizontal: 14 },
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: { maxHeight: '80%', paddingTop: 8 },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  title: { fontSize: 18, fontWeight: '800' },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, borderBottomWidth: 1 },
  flag: { fontSize: 24 },
})
