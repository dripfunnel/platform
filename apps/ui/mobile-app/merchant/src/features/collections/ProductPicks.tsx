import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '@dripfunnel/mobile-shared/theme'
import { TextField } from '../common/TextField'
import { usePickable } from './useLiveReads'

type Props = {
  client: ApiClient
  picked: readonly string[]
  names: Readonly<Record<string, string>>
  disabled: boolean
  onToggle: (id: string) => void
  onSeen: (seen: readonly { id: string; name: string }[]) => void
}

// A hand-picked collection's products (CATALOG-DESIGN.md H3): what is picked so far, and a search of the store's products to tick more.
export function ProductPicks({ client, picked, names, disabled, onToggle, onSeen }: Props) {
  const { colors, radii } = useTheme()
  const [query, setQuery] = useState('')
  const found = usePickable(client, true, query)

  useEffect(() => {
    if (found.status === 'ready') onSeen(found.data)
  }, [found])

  const row = (id: string, name: string, status: string) => {
    const on = picked.includes(id)
    return (
      <Pressable
        key={id}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: on, disabled }}
        accessibilityLabel={name}
        disabled={disabled}
        onPress={() => onToggle(id)}
        style={[styles.pick, { borderColor: colors.border, backgroundColor: on ? colors.infoSurface : colors.surface }]}
      >
        <View style={[styles.box, { borderColor: on ? colors.focus : colors.fieldBorder, backgroundColor: on ? colors.focus : colors.surface }]}>
          <Text style={[styles.mark, { color: colors.onInk }]}>{on ? '✓' : ''}</Text>
        </View>
        <Text style={[styles.name, { color: colors.text }]}>{name}</Text>
        <Text style={[styles.status, { color: colors.muted }]}>{status}</Text>
      </Pressable>
    )
  }

  return (
    <View style={styles.block}>
      <Text style={[styles.sub, { color: colors.textStrong }]}>{picked.length === 0 ? t('collections.editor.noPicks') : tCount('collections.editor.pickedSoFar', picked.length)}</Text>
      {picked.map((id) => row(id, names[id] ?? '', ''))}
      <TextField label={t('collections.editor.search')} value={query} onChangeText={setQuery} placeholder={t('collections.editor.search')} returnKeyType="search" />
      <View style={[styles.list, { borderColor: colors.border, borderRadius: radii.button }]}>
        {found.status === 'loading' ? <ActivityIndicator color={colors.muted} style={styles.busy} /> : null}
        {found.status === 'failed' ? (
          <Text accessibilityRole="alert" style={[styles.note, { color: colors.danger }]}>
            {t('collections.editor.searchFailed')}
          </Text>
        ) : null}
        {found.status === 'ready' && found.data.length === 0 ? <Text style={[styles.note, { color: colors.muted }]}>{t('collections.editor.noProducts', { query: query.trim() })}</Text> : null}
        {found.status === 'ready' ? found.data.filter((p) => !picked.includes(p.id)).map((p) => row(p.id, p.name, p.approval === 'pending' ? t('collections.editor.statusWaiting') : p.visible ? '' : t('collections.editor.statusHidden'))) : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  block: { gap: 10 },
  sub: { fontSize: 13, lineHeight: 19 },
  list: { borderWidth: 1, overflow: 'hidden' },
  busy: { padding: 14 },
  note: { fontSize: 13, padding: 12 },
  pick: { minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderBottomWidth: 1 },
  box: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  mark: { fontSize: 12, fontWeight: '800' },
  name: { flex: 1, fontSize: 14 },
  status: { fontSize: 12 },
})
