import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { loadProducts, type ProductRow } from '../../../api/products'
import type { ApiClient } from '../../../graphql'
import { t } from '../../../messages'
import { errorMessage } from '../../../messages/errorMessage'
import { useTheme } from '../../../theme'
import { Button } from '../../common/Button'
import { SheetFrame } from '../../shell/BottomSheet'

type Props = {
  client: ApiClient
  title: string
  /** How many may be chosen; 1 closes on the first tap. */
  max: number
  /** Not offered (the product being edited). */
  exclude: readonly string[]
  /** Already chosen, so they show ticked. */
  chosen?: readonly string[]
  onPick: (picked: { id: string; name: string }[]) => void
  onClose: () => void
}

const searchDelayMs = 350

// Finds products by name (the API's own list, so a supplier sees only its own) for a comparison or "Copy from another product".
export function ProductPicker({ client, title, max, exclude, chosen = [], onPick, onClose }: Props) {
  const { colors, radii } = useTheme()
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<ProductRow[] | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([])

  const hidden = exclude.join(',').split(',')
  useEffect(() => {
    let current = true
    const find = () => {
      setRows(null)
      loadProducts(client, { filter: 'all', search, sort: 'name' }).then(
        (page) => {
          if (!current) return
          setRows(page.rows.filter((row) => !hidden.includes(row.id)))
          setProblem(null)
        },
        (error: unknown) => current && setProblem(errorMessage(error, 'products')),
      )
    }
    // The first list comes at once; typing waits for a pause.
    const timer = search === '' ? null : setTimeout(find, searchDelayMs)
    if (timer === null) find()
    return () => {
      current = false
      if (timer !== null) clearTimeout(timer)
    }
  }, [client, search, hidden.join(',')])

  const toggle = (row: ProductRow) => {
    const item = { id: row.id, name: row.name }
    if (max === 1) return onPick([item])
    setPicked((now) => (now.some((p) => p.id === row.id) ? now.filter((p) => p.id !== row.id) : now.length + chosen.length < max ? [...now, item] : now))
  }

  return (
    <SheetFrame onClose={onClose}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
        {title}
      </Text>
      <TextInput
        accessibilityLabel={t('products.search.label')}
        value={search}
        onChangeText={setSearch}
        placeholder={t('products.search.placeholder')}
        placeholderTextColor={colors.muted}
        autoCapitalize="none"
        autoCorrect={false}
        style={[styles.search, { color: colors.text, borderColor: colors.fieldBorder, borderRadius: radii.button }]}
      />
      {rows === null && !problem ? <ActivityIndicator color={colors.muted} /> : null}
      {problem ? <Text style={{ color: colors.danger, fontSize: 13 }}>{problem}</Text> : null}
      {rows?.length === 0 ? <Text style={{ color: colors.muted, fontSize: 14 }}>{t('products.story.pickNone')}</Text> : null}
      {rows?.map((row) => {
        const on = picked.some((p) => p.id === row.id) || chosen.includes(row.id)
        return (
          <Pressable
            key={row.id}
            accessibilityRole={max === 1 ? 'button' : 'checkbox'}
            accessibilityState={{ checked: on }}
            disabled={chosen.includes(row.id)}
            onPress={() => toggle(row)}
            style={[styles.row, { borderColor: on ? colors.focus : colors.fieldBorder, borderWidth: on ? 2 : 1, borderRadius: radii.button, backgroundColor: colors.surface }]}
          >
            <Text style={[styles.name, { color: colors.text }]}>{`${on ? '✓ ' : ''}${row.name}`}</Text>
          </Pressable>
        )
      })}
      {max > 1 ? (
        <View style={styles.buttons}>
          <Button label={t('products.story.pickDone')} onPress={() => onPick(picked)} disabled={picked.length === 0} />
        </View>
      ) : null}
    </SheetFrame>
  )
}

const styles = StyleSheet.create({
  title: { fontSize: 19, fontWeight: '800' },
  search: { minHeight: 50, borderWidth: 1.5, paddingHorizontal: 14, fontSize: 16 },
  row: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14 },
  name: { fontSize: 15 },
  buttons: { paddingTop: 4 },
})
