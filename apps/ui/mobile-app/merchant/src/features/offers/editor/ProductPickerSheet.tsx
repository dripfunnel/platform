import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../../messages'
import { tCount } from '../../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { Button } from '../../common/Button'
import { TextField } from '../../common/TextField'
import { usePickable } from '../../collections/useLiveReads'
import { SheetFrame } from '../../shell/BottomSheet'

type Props = {
  client: ApiClient
  chosen: readonly string[]
  limit: number
  onToggle: (product: { id: string; name: string }, on: boolean) => void
  onClose: () => void
}

// "Choose products" (OfferEditor's picker, D2): search the catalogue and tick products. Picking one means all its versions, now and later.
export function ProductPickerSheet({ client, chosen, limit, onToggle, onClose }: Props) {
  const { colors, radii } = useTheme()
  const [query, setQuery] = useState('')
  const found = usePickable(client, true, query)
  const [seen, setSeen] = useState<Record<string, string>>({})

  useEffect(() => {
    if (found.status === 'ready') setSeen((known) => ({ ...known, ...Object.fromEntries(found.data.map((p) => [p.id, p.name])) }))
  }, [found])

  return (
    <SheetFrame onClose={onClose}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {t('offers.editor.picker.title')}
      </Text>
      <TextField label={t('offers.editor.picker.search')} value={query} onChangeText={setQuery} placeholder={t('offers.editor.picker.search')} returnKeyType="search" />
      {chosen.length >= limit ? <Text style={[styles.note, { color: colors.muted }]}>{t('offers.editor.picker.full', { max: limit })}</Text> : null}
      <ScrollView style={styles.list} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
        {found.status === 'loading' ? <ActivityIndicator color={colors.muted} style={styles.busy} /> : null}
        {found.status === 'failed' ? (
          <Text accessibilityRole="alert" style={[styles.note, { color: colors.danger }]}>
            {t('offers.editor.picker.failed')}
          </Text>
        ) : null}
        {found.status === 'ready' && found.data.length === 0 ? <Text style={[styles.note, { color: colors.muted }]}>{t('offers.editor.picker.none', { query: query.trim() })}</Text> : null}
        {found.status === 'ready'
          ? found.data.map((product) => {
              const on = chosen.includes(product.id)
              const full = !on && chosen.length >= limit
              return (
                <Pressable
                  key={product.id}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on, disabled: full }}
                  accessibilityLabel={product.name}
                  disabled={full}
                  onPress={() => onToggle({ id: product.id, name: seen[product.id] ?? product.name }, !on)}
                  style={[styles.row, { borderColor: colors.border, backgroundColor: on ? colors.infoSurface : colors.surface, borderRadius: radii.button, opacity: full ? 0.5 : 1 }]}
                >
                  <View style={[styles.box, { borderColor: on ? colors.focus : colors.fieldBorder, backgroundColor: on ? colors.focus : colors.surface }]}>
                    <Text style={[styles.mark, { color: colors.onInk }]}>{on ? '✓' : ''}</Text>
                  </View>
                  <Text style={[styles.name, { color: colors.text }]}>{product.name}</Text>
                </Pressable>
              )
            })
          : null}
      </ScrollView>
      <Button label={tCount('offers.editor.picker.done', chosen.length)} onPress={onClose} />
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: '800', lineHeight: 25 },
  note: { fontSize: 13, lineHeight: 18, padding: 4 },
  list: { maxHeight: 320 },
  busy: { padding: 14 },
  row: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderWidth: 1, marginBottom: 6 },
  box: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  mark: { fontSize: 12, fontWeight: '800' },
  name: { flex: 1, fontSize: 14 },
})
