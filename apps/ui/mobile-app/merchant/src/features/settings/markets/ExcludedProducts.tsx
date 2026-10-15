import { useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import type { ApiClient } from '../../../graphql'
import { t } from '../../../messages'
import { useTheme } from '../../../theme'
import { Chip } from '../../common/Chip'
import { TextField } from '../../common/TextField'
import { usePickable } from '../../collections/useLiveReads'

type Excluded = { id: string; name: string; gone?: boolean }
type Props = { client: ApiClient; excluded: readonly Excluded[]; disabled: boolean; onChange: (excluded: Excluded[]) => void }

// "All except some": the products not sold in this market, each a chip that sells it again when pressed, and a search of the store's products
// to leave more out. What the search finds is the API's answer.
export function ExcludedProducts({ client, excluded, disabled, onChange }: Props) {
  const { colors, radii } = useTheme()
  const [query, setQuery] = useState('')
  const found = usePickable(client, !disabled, query)
  const hidden = new Set(excluded.map((product) => product.id))
  return (
    <View style={styles.block}>
      <View style={styles.chips}>
        {excluded.map((product) => (
          <Chip key={product.id} label={product.name} accessibilityLabel={t('settings.markets.sellAgain', { name: product.name })} disabled={disabled} onPress={() => onChange(excluded.filter((other) => other.id !== product.id))} />
        ))}
      </View>
      {!disabled ? (
        <>
          <TextField label={t('settings.markets.findProduct')} value={query} onChangeText={setQuery} placeholder={t('settings.common.search')} returnKeyType="search" />
          <View style={[styles.list, { borderColor: colors.border, borderRadius: radii.button }]}>
            {found.status === 'loading' ? <ActivityIndicator color={colors.muted} style={styles.busy} /> : null}
            {found.status === 'failed' ? <Text style={[styles.note, { color: colors.danger }]}>{t('errors.generic')}</Text> : null}
            {found.status === 'ready' && found.data.length === 0 ? <Text style={[styles.note, { color: colors.muted }]}>{t('settings.common.noMatch')}</Text> : null}
            {found.status === 'ready'
              ? found.data
                  .filter((product) => !hidden.has(product.id))
                  .map((product) => (
                    <Pressable key={product.id} accessibilityRole="button" onPress={() => onChange([...excluded, { id: product.id, name: product.name }])} style={[styles.row, { borderColor: colors.border }]}>
                      <Text style={[styles.name, { color: colors.text }]}>{product.name}</Text>
                    </Pressable>
                  ))
              : null}
          </View>
        </>
      ) : null}
      <Text style={[styles.note, { color: colors.muted }]}>{t('settings.markets.excludedHelp')}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  list: { borderWidth: 1, overflow: 'hidden' },
  busy: { padding: 14 },
  note: { fontSize: 13, lineHeight: 18, padding: 4 },
  row: { minHeight: 50, justifyContent: 'center', paddingHorizontal: 12, borderBottomWidth: 1 },
  name: { fontSize: 14 },
})
