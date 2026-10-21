import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { loadShopifyProducts, type ShopifyProduct } from '../../api/imports'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { tCount } from '../../messages/plural'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Notice } from '../common/Notice'
import { SectionCard } from '../common/SectionCard'
import { Skeleton } from '../states/StateView'

/** The most startShopifyImport takes by id; more comes in as "all". */
export const maxPicked = 250

type Pick = { kind: 'some'; ids: ReadonlySet<string> } | { kind: 'all' }

type Props = { client: ApiClient; shop: string; checking: boolean; onBack: () => void; onCheck: (ids: string[] | null) => void }

/** Connected: the shop's products a page at a time, ticked one by one or all of them, then checked like a file (K7). */
export function ShopifyPicker({ client, shop, checking, onBack, onCheck }: Props) {
  const { colors, radii } = useTheme()
  const [rows, setRows] = useState<ShopifyProduct[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [view, setView] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pick, setPick] = useState<Pick>({ kind: 'some', ids: new Set() })
  const [note, setNote] = useState<string | null>(null)
  const [more, setMore] = useState<'idle' | 'loading' | 'failed'>('idle')

  const page = useCallback(
    (after: string | null) => {
      if (after !== null) setMore('loading')
      loadShopifyProducts(client, after).then(
        (found) => {
          // The first page comes ticked, as CatImport opens the picker; the person unticks what stays behind.
          if (after === null) setPick({ kind: 'some', ids: new Set(found.nodes.slice(0, maxPicked).map((row) => row.id)) })
          setRows((current) => (after === null ? found.nodes : [...current, ...found.nodes]))
          setNext(found.next)
          setView('ready')
          setMore('idle')
        },
        // A later page failing keeps the rows and the ticks; only the first page's failure is the picker's.
        () => (after === null ? setView('error') : setMore('failed')),
      )
    },
    [client],
  )
  useEffect(() => page(null), [page])

  const toggle = (id: string) => {
    // "All" can't leave out what isn't loaded yet: the API takes picked ids or every product, nothing between.
    if (pick.kind === 'all' && next !== null) return setNote(t('imports.pick.loadAll'))
    const ids = new Set(pick.kind === 'some' ? pick.ids : rows.map((row) => row.id))
    if (!ids.delete(id)) ids.add(id)
    if (ids.size > maxPicked) return setNote(t('imports.pick.max'))
    setNote(null)
    setPick({ kind: 'some', ids })
  }

  const all = pick.kind === 'all'
  const count = pick.kind === 'some' ? pick.ids.size : null
  const check = () => {
    if (count === 0) return setNote(t('imports.pick.none'))
    onCheck(pick.kind === 'all' ? null : [...pick.ids])
  }

  if (view === 'loading') return <Skeleton />
  if (view === 'error')
    return (
      <SectionCard title={t('imports.pick.failed')} sub={t('imports.pick.failedBody')}>
        <Button label={t('common.tryAgain')} onPress={() => page(null)} />
        <Button kind="secondary" label={t('imports.pick.back')} onPress={onBack} />
      </SectionCard>
    )

  return (
    <SectionCard title={t('imports.pick.title', { shop })}>
      <Pressable accessibilityRole="button" onPress={() => setPick(all ? { kind: 'some', ids: new Set() } : { kind: 'all' })} style={styles.selectAll}>
        <Text style={[styles.selectAllText, { color: colors.link }]}>{all ? t('imports.pick.clearAll') : t('imports.pick.selectAll')}</Text>
      </Pressable>
      {all ? <Notice text={t('imports.pick.allChosen')} /> : null}
      <View style={styles.rows}>
        {rows.map((row) => {
          const on = all || (pick.kind === 'some' && pick.ids.has(row.id))
          const versions = tCount('imports.pick.versions', row.versions)
          const meta = row.status === 'DRAFT' ? t('imports.pick.metaDraft', { versions }) : row.status === 'ARCHIVED' ? t('imports.pick.metaArchived', { versions }) : versions
          return (
            <Pressable
              key={row.id}
              accessibilityRole="checkbox"
              accessibilityLabel={row.title}
              accessibilityState={{ checked: on }}
              onPress={() => toggle(row.id)}
              style={[styles.row, { borderColor: on ? colors.focus : colors.border, borderRadius: radii.button, backgroundColor: colors.surface }]}
            >
              <View style={[styles.box, { borderColor: on ? colors.focus : colors.muted, backgroundColor: on ? colors.focus : 'transparent' }]}>{on ? <Text style={[styles.tick, { color: colors.surface }]}>✓</Text> : null}</View>
              <View style={styles.rowText}>
                <Text style={[styles.name, { color: colors.text }]}>{row.title}</Text>
                <Text style={[styles.meta, { color: colors.muted }]}>{meta}</Text>
              </View>
            </Pressable>
          )
        })}
      </View>
      {next ? more === 'loading' ? <ActivityIndicator color={colors.muted} /> : <Button kind="secondary" label={t('imports.pick.more')} onPress={() => page(next)} /> : null}
      {more === 'failed' ? <Notice kind="error" text={t('imports.pick.moreFailed')} /> : null}
      {note ? <Notice kind="error" text={note} /> : null}
      {checking ? <Notice text={t('imports.checking.shopify')} /> : null}
      <Button
        label={count === null ? t('imports.pick.checkAll') : tCount('imports.pick.check', count)}
        onPress={check}
        busy={checking}
        saves
      />
      <Button kind="secondary" label={t('imports.pick.back')} onPress={onBack} />
    </SectionCard>
  )
}

const styles = StyleSheet.create({
  selectAll: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
  selectAllText: { fontSize: 14, fontWeight: '700' },
  rows: { gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 56, borderWidth: 1 },
  box: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  tick: { fontSize: 14, fontWeight: '800', lineHeight: 16 },
  rowText: { flex: 1, gap: 2 },
  name: { fontSize: 14, fontWeight: '700' },
  meta: { fontSize: 12 },
})
