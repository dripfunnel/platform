import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import type { CollectionSummary } from '../../api/collections'
import { loadMenu, saveMenu, type Menu } from '../../api/menu'
import { isApiError } from '../../graphql'
import { formatList } from '../../format'
import { locale, t } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { tCount } from '../../messages/plural'
import { sessionClient } from '../../session'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Caret } from '../common/Caret'
import { SectionCard } from '../common/SectionCard'
import { useLoad } from '../common/useLoad'
import { useFeedback, type MenuItem as SheetItem } from '../shell/Feedback'
import { Icon } from '../shell/Icon'
import { Skeleton } from '../states/StateView'
import { collectionRow, menuInput, menuPreview, moved, removed, rowsOfMenu, toggledDepth, type MenuRow } from './menuRows'

type Props = { collections: readonly CollectionSummary[]; canEdit: boolean }

// CatCollections › Menus: the main menu is read here, and the editor under it is rebuilt when a newer one arrives.
export function MenusTab({ collections, canEdit }: Props) {
  const client = sessionClient()
  const menu = useLoad(() => loadMenu(client), [client])
  if (menu.state.status === 'loading') return <Skeleton />
  if (menu.state.status === 'error') {
    return (
      <SectionCard title={t('collections.menus.loadFailed.title')} sub={t('collections.menus.loadFailed.body')}>
        <Button kind="secondary" label={t('common.tryAgain')} onPress={menu.reload} />
      </SectionCard>
    )
  }
  return <MenuEditor key={menu.state.data?.revision ?? 'none'} menu={menu.state.data} collections={collections} canEdit={canEdit} onStale={menu.reload} />
}

type EditorProps = Props & { menu: Menu | null; onStale: () => void }

function MenuEditor({ menu, collections, canEdit, onStale }: EditorProps) {
  const { colors, radii } = useTheme()
  const feedback = useFeedback()
  const client = sessionClient()
  const [rows, setRows] = useState<MenuRow[]>(() => rowsOfMenu(menu))
  const [revision, setRevision] = useState<number | null>(menu?.revision ?? null)
  const [busy, setBusy] = useState(false)

  const named = (r: MenuRow) => (r.kind === 'collection' ? (collections.find((c) => c.id === r.collectionId)?.name ?? t('collections.menus.gone')) : r.label)
  const shown = (r: MenuRow) => r.kind !== 'collection' || collections.some((c) => c.id === r.collectionId && c.visible)

  // Every change saves at once at the revision read, as the prototype's menu does; the rows move back if it's refused.
  const apply = async (next: MenuRow[], toast: string) => {
    const before = rows
    setRows(next)
    setBusy(true)
    try {
      setRevision(await saveMenu(client, menuInput(next, collections), menu?.name ?? null, revision))
      feedback.toast({ message: toast })
    } catch (error) {
      setRows(before)
      feedback.toast({ message: errorMessage(error, 'menus') })
      if (isApiError(error, 'STALE_REVISION')) onStale()
    } finally {
      setBusy(false)
    }
  }

  const nest = (r: MenuRow) => {
    const next = toggledDepth(rows, r.key)
    if (next === 'FIRST') return feedback.toast({ message: t('collections.menus.firstNest') })
    if (next === 'HAS_KIDS') return feedback.toast({ message: t('collections.menus.nestHasKids') })
    if (next) void apply(next, t('collections.menus.saved'))
  }

  const remove = (r: MenuRow) =>
    feedback.sheet({
      title: t('collections.menus.removeTitle', { label: named(r) }),
      body: t('collections.menus.removeBody'),
      confirm: t('collections.menus.removeConfirm'),
      danger: true,
      saves: true,
      onConfirm: () => apply(removed(rows, r.key), t('collections.menus.removed')),
    })

  const act = (r: MenuRow) => {
    const up = moved(rows, r.key, -1)
    const down = moved(rows, r.key, 1)
    const items: SheetItem[] = [
      ...(up ? [{ key: 'up', label: t('collections.menus.up'), onPress: () => void apply(up, t('collections.menus.saved')) }] : []),
      ...(down ? [{ key: 'down', label: t('collections.menus.down'), onPress: () => void apply(down, t('collections.menus.saved')) }] : []),
      { key: 'nest', label: t(r.depth ? 'collections.menus.unnest' : 'collections.menus.nest'), onPress: () => nest(r) },
      { key: 'remove', label: t('collections.menus.remove'), danger: true, onPress: () => remove(r) },
    ]
    feedback.menu({ title: named(r), sub: t('collections.menus.actionsSub'), items })
  }

  const addable = collections.filter((c) => !rows.some((r) => r.collectionId === c.id))
  const add = () =>
    feedback.menu({
      title: t('collections.menus.addLabel'),
      items: addable.map((c) => ({ key: c.id, label: c.name, onPress: () => void apply([...rows, collectionRow(c)], t('collections.menus.added')) })),
    })

  const tops = menuPreview(rows, collections)

  return (
    <View style={styles.list}>
      <View style={styles.head}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
          {t('collections.menus.title')}
        </Text>
        <Text style={[styles.sub, { color: colors.muted }]}>{canEdit ? t('collections.menus.note') : t('collections.menus.viewOnly')}</Text>
      </View>
      {canEdit ? <Button label={t('collections.menus.add')} onPress={add} disabled={busy || addable.length === 0} saves /> : null}
      {busy ? (
        <Text accessibilityLiveRegion="polite" style={[styles.sub, { color: colors.muted }]}>
          {t('collections.menus.saving')}
        </Text>
      ) : null}
      {rows.length === 0 ? <Text style={[styles.sub, { color: colors.muted }]}>{t('collections.menus.empty')}</Text> : null}
      {rows.map((r) => {
        const c = collections.find((x) => x.id === r.collectionId)
        const note = r.kind !== 'collection' ? t('collections.menus.link', { url: r.url ?? '' }) : !c ? '' : c.visible ? tCount('collections.menus.products', c.products) : t('collections.menus.hiddenNote')
        return (
          <Pressable
            key={r.key}
            accessibilityRole="button"
            accessibilityLabel={`${named(r)}${note ? `, ${note}` : ''}`}
            disabled={!canEdit || busy}
            onPress={() => act(r)}
            style={[styles.row, { marginLeft: r.depth * 24, backgroundColor: shown(r) ? colors.surface : colors.page, borderColor: colors.border, borderRadius: radii.button }]}
          >
            <Text style={[styles.label, { color: shown(r) ? colors.text : colors.muted }]}>{named(r)}</Text>
            <Text style={[styles.note, { color: colors.muted }]}>{note}</Text>
          </Pressable>
        )
      })}
      <SectionCard title={t('collections.menus.desktop')}>
        <View style={styles.desktopRow}>
          {tops.map((top) => (
            <Text key={top.key} style={[styles.label, { color: colors.text }]}>
              {top.label}
              {top.kids.length > 0 ? <Caret color={colors.text} /> : null}
            </Text>
          ))}
        </View>
        {tops.some((top) => top.kids.length > 0) ? <Text style={[styles.sub, { color: colors.muted }]}>{formatList(tops.flatMap((top) => top.kids.map((k) => k.label)), locale)}</Text> : null}
      </SectionCard>
      <SectionCard title={t('collections.menus.phone')}>
        <View accessibilityLabel={t('collections.menus.phone')} style={[styles.phone, { borderColor: colors.border }]}>
          {tops.flatMap((top) => [
            <View key={top.key} style={[styles.phoneRow, { borderColor: colors.border }]}>
              <Text style={[styles.sub, { color: colors.text }]}>{top.label}</Text>
              <Icon name="chevron" size={14} color={colors.muted} />
            </View>,
            ...top.kids.map((k) => (
              <View key={k.key} style={[styles.phoneRow, styles.phoneKid, { borderColor: colors.border }]}>
                <Text style={[styles.sub, { color: colors.text }]}>{k.label}</Text>
                <Icon name="chevron" size={14} color={colors.muted} />
              </View>
            )),
          ])}
        </View>
      </SectionCard>
    </View>
  )
}

const styles = StyleSheet.create({
  list: { gap: 10 },
  head: { gap: 4 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  row: { minHeight: 56, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10, justifyContent: 'center', gap: 2 },
  label: { fontSize: 15, fontWeight: '600' },
  note: { fontSize: 12 },
  desktopRow: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4 },
  phone: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  phoneRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 14, minHeight: 44, alignItems: 'center', borderBottomWidth: 1 },
  phoneKid: { paddingLeft: 30 },
})
